'use strict';
// Platform features around the chat app: API gateway keys and proxy, signed webhooks, folder connector,
// document workflows with an approval gate, saved prompts. Loaded by server.js.
const crypto = require('crypto'), fs = require('fs'), path = require('path');

module.exports = function install(ctx) {
  const { db, on, err, uid, now, audit, save, isAdmin, GW, A, byId, needGpt, SYSTEM } = ctx, SAMPLE = require('./sample');
  const sha = s => crypto.createHash('sha256').update(s).digest('hex');

  // ---------- webhooks: signed, retried three times, every attempt logged
  const EVENTS = ['app.deploy.finished', 'document.added', 'answer.not_helpful', 'workflow.needs_approval', 'workflow.completed', 'invoice.reconciled', 'rfq.quote_received'];
  async function deliver(h, event, payload, attempt = 1, did = uid('dl')) {
    const body = JSON.stringify({ id: did, event, at: now(), tenant: db.tenant.slug, data: payload });
    let code = 0, ok = false;
    if (h.url.startsWith('sample://')) { code = 200; ok = true; } // the sample receiver accepts everything
    else try {
      const r = await fetch(h.url, { method: 'POST', body, signal: AbortSignal.timeout(5000), headers: { 'Content-Type': 'application/json', 'X-Vanik-Event': event, 'X-Vanik-Delivery': did, 'X-Vanik-Signature': 'sha256=' + crypto.createHmac('sha256', h.secret).update(body).digest('hex') } });
      code = r.status; ok = r.ok;
    } catch { /* unreachable */ }
    let d = db.deliveries.find(x => x.id === did);
    if (!d) { d = { id: did, webhookId: h.id, url: h.url, event, at: now() }; db.deliveries.unshift(d); if (db.deliveries.length > 200) db.deliveries.length = 200; }
    Object.assign(d, { attempts: attempt, code, status: ok ? 'delivered' : attempt >= 3 ? 'failed' : 'retrying', lastAt: now() }); save();
    if (!ok && attempt < 3) setTimeout(() => deliver(h, event, payload, attempt + 1, did), attempt * 1200).unref();
  }
  const emit = (event, payload) => db.webhooks.filter(h => h.active && h.events.includes(event)).forEach(h => deliver(h, event, payload));
  const hookView = h => ({ id: h.id, url: h.url, events: h.events, active: h.active, createdAt: h.createdAt, createdBy: h.createdBy });
  on('POST', '/api/webhooks', ({ u, body }) => {
    const url = String(body.url || '').trim(), events = (body.events || []).filter(e => EVENTS.includes(e));
    if (!/^(https?|sample):\/\/[^\s]+$/i.test(url)) throw err(400, 'Enter a full address that starts with http:// or https://.');
    if (!events.length) throw err(400, 'Pick at least one event.');
    const h = { id: uid('wh'), url, events, active: true, secret: 'whsec_' + crypto.randomBytes(18).toString('base64url'), createdAt: now(), createdBy: u.name };
    db.webhooks.unshift(h); audit(u, 'Added a webhook', url, events.join(', '));
    return { ...hookView(h), secret: h.secret };
  }, A);
  on('PATCH', '/api/webhooks/:id', ({ u, p, body }) => { const h = byId(db.webhooks, p.id, 'Webhook'); h.active = !!body.active; audit(u, h.active ? 'Turned a webhook on' : 'Turned a webhook off', h.url); return hookView(h); }, A);
  on('DELETE', '/api/webhooks/:id', ({ u, p }) => { const h = byId(db.webhooks, p.id, 'Webhook'); db.webhooks = db.webhooks.filter(x => x.id !== h.id); audit(u, 'Removed a webhook', h.url); return { ok: true }; }, A);
  on('POST', '/api/webhooks/:id/test', ({ p }) => { const h = byId(db.webhooks, p.id, 'Webhook'); deliver(h, 'webhook.test', { message: 'Test delivery from Vanik OS.' }); return { ok: true }; }, A);

  // ---------- API gateway: keys shown once, stored hashed; OpenAI-compatible proxy with a per-key limit
  const keyView = k => ({ id: k.id, name: k.name, last4: k.last4, createdBy: k.createdBy, createdAt: k.createdAt, lastUsedAt: k.lastUsedAt, revokedAt: k.revokedAt || null, system: !!k.system, requests: k.requests || 0, tokens: k.tokens || 0, knowledge: k.knowledge || 'none' });
  function issueKey(name, by, system) {
    const raw = 'sk-vnk-' + crypto.randomBytes(18).toString('base64url');
    const k = { id: uid('key'), name, hash: sha(raw), last4: raw.slice(-4), createdBy: by, createdAt: now(), lastUsedAt: null, system: !!system, requests: 0, tokens: 0 };
    db.keys.unshift(k); return { k, raw };
  }
  const revokeSystemKeys = name => db.keys.forEach(k => { if (k.system && k.name === name && !k.revokedAt) k.revokedAt = now(); });
  on('POST', '/api/gateway/keys', ({ u, body }) => { const name = String(body.name || '').trim().slice(0, 40); if (!name) throw err(400, 'Give the key a name.'); const { k, raw } = issueKey(name, u.name); k.knowledge = body.knowledge === 'all' ? 'all' : Array.isArray(body.knowledge) ? body.knowledge.filter(id => db.collections.some(c => c.id === id)) : 'none'; audit(u, 'Created an API key', name, k.knowledge === 'none' ? 'Models only' : 'Models and knowledge'); return { ...keyView(k), key: raw }; }, A);
  on('DELETE', '/api/gateway/keys/:id', ({ u, p }) => { const k = byId(db.keys, p.id, 'Key'); if (!k.revokedAt) { k.revokedAt = now(); audit(u, 'Revoked an API key', k.name); } return keyView(k); }, A);

  const RATE = new Map();
  const gwFail = (res, status, code, message) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { message, type: status === 429 ? 'rate_limit_error' : status === 401 ? 'authentication_error' : 'invalid_request_error', code } })); };
  function gwAuth(req, res) {
    const h = req.headers.authorization || '';
    if (h.startsWith('Bearer ')) {
      const k = db.keys.find(x => x.hash === sha(h.slice(7)) && !x.revokedAt);
      if (!k) return gwFail(res, 401, 'invalid_api_key', 'That API key is not valid or was revoked.'), false;
      const t = Date.now(), hits = (RATE.get(k.id) || []).filter(x => t - x < 60000);
      if (hits.length >= 60) return gwFail(res, 429, 'rate_limit_exceeded', 'This key is limited to 60 requests a minute.'), false;
      hits.push(t); RATE.set(k.id, hits); k.requests = (k.requests || 0) + 1; k.lastUsedAt = now(); save();
      return k;
    }
    const u = db.users.find(x => x.id === req.headers['x-user']);
    if (u && isAdmin(u)) return { console: true };
    return gwFail(res, 401, 'missing_api_key', 'Send an API key as "Authorization: Bearer sk-vnk-...".'), false;
  }
  const serving = id => db.models.find(m => m.id === id && m.status === 'serving');
  on('GET', '/gateway/v1/models', ({ req, res }) => { if (!gwAuth(req, res)) return; return { object: 'list', data: db.models.filter(m => m.status === 'serving').map(m => ({ id: m.id, object: 'model', owned_by: 'vanik', kind: m.kind })) }; }, { open: true });
  // Knowledge a key may read: none, all, or chosen collections. A console session reads all.
  const keyDocs = k => { const sc = k.console ? 'all' : (k.knowledge || 'none'); return sc === 'none' ? null : db.documents.filter(d => !d.collectionId.startsWith('chat:') && (sc === 'all' || sc.includes(d.collectionId)) && (!d.expiresOn || d.expiresOn >= now().slice(0, 10)) && !(d.restrict || []).length); };
  const chunkOut = h => ({ object: 'context.chunk', score: h.score, matched_by: h.via, text: h.text, document: { id: h.docId, name: h.docName, page: h.page, collection: (db.collections.find(c => c.id === h.collectionId) || {}).name || '' } });
  on('GET', '/gateway/health', () => ({ status: 'ok', appliance: db.device.online ? 'online' : 'offline', models_serving: db.models.filter(m => m.status === 'serving').length, model_server: GW.ok ? 'reachable' : 'not reachable' }), { open: true });
  on('POST', '/gateway/v1/chunks', async ({ req, res, body }) => {
    const k = gwAuth(req, res); if (!k) return; const docs = keyDocs(k);
    if (!docs) return gwFail(res, 403, 'knowledge_not_allowed', 'This key cannot read the knowledge base. Create a key with knowledge access.');
    return { object: 'list', data: (await ctx.search(String(body.text || body.query || ''), docs, Math.max(1, Math.min(20, +body.limit || 5)))).map(chunkOut) };
  }, { open: true });
  on('POST', '/gateway/v1/count_tokens', ({ req, res, body }) => { if (!gwAuth(req, res)) return; return { input_tokens: ctx.estTok(body.text !== undefined ? body.text : JSON.stringify(body.messages || '')), method: 'estimate (characters / 4)' }; }, { open: true });
  on('POST', '/gateway/v1/summarize', async ({ req, res, body }) => {
    const k = gwAuth(req, res); if (!k) return; const text = String(body.text || '').trim();
    if (text.length < 40) return gwFail(res, 400, 'text_too_short', 'Send the text to summarise in "text".');
    const model = db.models.find(m => m.kind === 'chat' && m.status === 'serving');
    if (GW.url && model) { try { let out = ''; await ctx.streamModel(model.id, [{ role: 'system', content: 'Summarise the text in at most six plain bullets. Keep numbers, dates and names exact.' }, { role: 'user', content: text.slice(0, 60000) }], t => { out += t; }, AbortSignal.timeout(60000)); if (out.trim()) return { summary: out.trim(), by: 'model', model: model.id }; } catch { /* fall through */ } }
    const sents = (text.match(/[^.!?\n]+[.!?]+/g) || [text]).map(x => x.trim()).filter(x => x.length > 25), freq = {};
    text.toLowerCase().match(/[a-z]{4,}/g).forEach(w => { freq[w] = (freq[w] || 0) + 1; });
    const top = sents.map((x, i) => ({ x, i, sc: (x.toLowerCase().match(/[a-z]{4,}/g) || []).reduce((a, w) => a + freq[w], 0) / Math.sqrt(x.length) })).sort((a, b) => b.sc - a.sc).slice(0, 5).sort((a, b) => a.i - b.i);
    return { summary: top.map(t => '- ' + t.x).join('\n'), by: 'extract', note: 'No model was reachable, so these are the most central sentences, in their original order.' };
  }, { open: true });
  async function proxy(kind, { req, res, body }) {
    const k = gwAuth(req, res); if (!k) return;
    if (kind === 'chat/completions' && body.use_context) {
      const docs = keyDocs(k); if (!docs) return gwFail(res, 403, 'knowledge_not_allowed', 'This key cannot read the knowledge base. Create a key with knowledge access.');
      const q = [...(body.messages || [])].reverse().find(m => m.role === 'user'), hits = q ? await ctx.search(String(q.content), docs, 5) : [];
      if (hits.length) body.messages = [{ role: 'system', content: 'Answer from the sources below and cite them inline like [1]. If they do not contain the answer, say so.\n\nSources:\n' + hits.map(h => `[${h.n}] ${h.docName}${h.page ? ' (page ' + h.page + ')' : ''}\n${h.text}`).join('\n\n') }, ...body.messages];
      res.setHeader('X-Vanik-Sources', JSON.stringify(hits.map(h => ({ n: h.n, document: h.docName, page: h.page }))).slice(0, 3000));
    }
    delete body.use_context; delete body.include_sources;
    if (!db.device.online) return gwFail(res, 503, 'appliance_offline', 'The Vanik Appliance is offline.');
    if (!serving(body.model)) return gwFail(res, 404, 'model_not_found', `The model "${body.model || ''}" is not serving. Call /gateway/v1/models to see what is.`);
    if (!GW.url && ctx.DEMO) { // sample workspace with no model server: answer from the passages, or say plainly that this is a sample reply
      if (kind === 'embeddings') { const inp = [].concat(body.input || ''); return { object: 'list', model: body.model, sample: true, data: inp.map((t, index) => ({ object: 'embedding', index, embedding: Array.from({ length: 16 }, (_, i) => +(((parseInt(sha(String(t) + i).slice(0, 6), 16) / 0xffffff) * 2 - 1).toFixed(4))) })), usage: { prompt_tokens: ctx.estTok(inp.join(' ')), total_tokens: ctx.estTok(inp.join(' ')) } }; }
      const sys = (body.messages || []).find(m => m.role === 'system' && /^Answer from the sources below/.test(m.content)), q = [...(body.messages || [])].reverse().find(m => m.role === 'user');
      const hits = sys && q ? await ctx.search(String(q.content), keyDocs(k) || [], 5) : [];
      const content = hits.length ? ctx.passageAnswer(String(q.content), hits, 4) : 'Sample reply: no model server is connected to this gateway, so this line stands in for the model. Turn on "Use the knowledge base" to get an answer built from your documents.';
      const usage = { prompt_tokens: ctx.estTok(JSON.stringify(body.messages || '')), completion_tokens: ctx.estTok(content) }; usage.total_tokens = usage.prompt_tokens + usage.completion_tokens;
      if (k.id) { k.tokens = (k.tokens || 0) + usage.total_tokens; save(); }
      const id = 'chatcmpl-' + uid('s');
      if (body.stream) { res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' }); for (const part of content.match(/\S+\s*/g) || []) { res.write('data: ' + JSON.stringify({ id, object: 'chat.completion.chunk', model: body.model, choices: [{ index: 0, delta: { content: part } }] }) + '\n\n'); await new Promise(r => setTimeout(r, 18)); } res.write('data: [DONE]\n\n'); return res.end(); }
      return { id, object: 'chat.completion', model: body.model, sample: true, choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }], usage };
    }
    if (!GW.url) return gwFail(res, 503, 'model_unreachable', 'No model server is reachable from this gateway right now.');
    let up;
    try { up = await fetch(GW.url + '/' + kind, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + GW.key }, body: JSON.stringify({ ...body, model: (kind === 'embeddings' ? process.env.VANIK_GATEWAY_EMBED_MODEL : GW.model) || body.model }), signal: AbortSignal.timeout(120000) }); }
    catch { return gwFail(res, 503, 'model_unreachable', 'No model server is reachable from this gateway right now.'); }
    const count = n => { if (k.id) { k.tokens = (k.tokens || 0) + n; save(); } };
    if (body.stream && up.ok && up.body) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      let chars = 0; const dec = new TextDecoder();
      for await (const part of up.body) { res.write(part); for (const m of dec.decode(part, { stream: true }).matchAll(/"content":"((?:[^"\\]|\\.)*)"/g)) chars += m[1].length; }
      count(Math.ceil((JSON.stringify(body.messages || '').length + chars) / 4)); return res.end();
    }
    const text = await up.text(); let j = null; try { j = JSON.parse(text); } catch { /* not json */ }
    count(j && j.usage && j.usage.total_tokens ? j.usage.total_tokens : Math.ceil((JSON.stringify(body).length + text.length) / 4));
    res.writeHead(up.status, { 'Content-Type': 'application/json' }); res.end(text);
  }
  on('POST', '/gateway/v1/chat/completions', c => proxy('chat/completions', c), { open: true });
  on('POST', '/gateway/v1/embeddings', c => proxy('embeddings', c), { open: true });

  // ---------- folder connector: copies readable files from a folder on the appliance into a collection and keeps them in step
  const TEXT_EXT = new Set(['.txt', '.md', '.csv', '.html', '.htm', '.json', '.log', '.tsv', '.sql', '.py', '.js', '.ts', '.java', '.go', '.rs', '.c', '.cpp', '.cs', '.sh', '.yaml', '.yml', '.xml', '.toml', '.ini', '.css']);
  function listFiles(root) { const out = []; const walk = (d, n) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (n > 0 && !e.name.startsWith('.')) walk(p, n - 1); } else out.push(p); } }; walk(root, 3); return out; }
  function syncConnector(c, by) {
    c.lastSyncAt = now(); c.error = '';
    const col = db.collections.find(x => x.id === c.collectionId);
    if (!col) { c.error = 'Its collection was deleted.'; c.active = false; return; }
    const sample = c.path.startsWith('sample://') ? SAMPLE.shareFiles(c.path) : null;
    let files; try { files = sample ? sample.map(f => c.path + '/' + f.name) : listFiles(c.path); } catch { c.error = 'The folder cannot be read.'; return; }
    const mine = db.documents.filter(d => d.source && d.source.connectorId === c.id), seen = new Set();
    let added = 0, updated = 0, removed = 0, skipped = 0;
    for (const f of files) {
      const ext = path.extname(f).toLowerCase(); let st;
      const sf = sample && sample.find(x => c.path + '/' + x.name === f);
      try { st = sf ? { size: sf.text.length, mtimeMs: sf.mtime } : fs.statSync(f); } catch { continue; }
      if (!TEXT_EXT.has(ext) || st.size > 5e6) { skipped++; continue; }
      seen.add(f);
      const old = mine.find(d => d.source.path === f);
      if (old && old.source.mtime === st.mtimeMs) continue;
      let text = sf ? sf.text : fs.readFileSync(f, 'utf8');
      if (ext === '.html' || ext === '.htm') text = text.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ');
      try {
        const d = ctx.addDocument(by, col.id, { name: sf ? sf.name : path.relative(c.path, f).replace(/\\/g, '/'), size: st.size, type: ext.slice(1), pages: [text] }, true);
        d.source = { connectorId: c.id, path: f, mtime: st.mtimeMs };
        if (old) { db.documents.splice(db.documents.indexOf(old), 1); updated++; } else added++;
      } catch { skipped++; }
    }
    for (const d of mine) if (!seen.has(d.source.path) && db.documents.includes(d)) { db.documents.splice(db.documents.indexOf(d), 1); removed++; }
    c.stats = { files: seen.size, added, updated, removed, skipped }; col.updatedAt = now(); save();
    if (added || updated || removed) audit(by, 'Synced a folder', c.path, `${added} added, ${updated} updated, ${removed} removed`);
  }
  setInterval(() => { for (const c of db.connectors) if (c.active && Date.now() - new Date(c.lastSyncAt || 0) >= c.everyMinutes * 60000) syncConnector(c, SYSTEM); }, 10000).unref();
  on('POST', '/api/connectors', ({ u, body }) => {
    const typed = String(body.path || '').trim(), isSample = SAMPLE.shareFiles(typed).length > 0, dir = isSample ? typed : path.resolve(typed), col = byId(db.collections, body.collectionId, 'Collection');
    if (!isSample && (!typed || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory())) throw err(400, 'That folder does not exist on the appliance. To try it without one, use sample://finance-share.');
    if (db.connectors.some(c => c.path === dir && c.collectionId === col.id)) throw err(409, 'That folder is already connected to this collection.');
    const c = { id: uid('cn'), type: 'folder', path: dir, collectionId: col.id, everyMinutes: Math.max(1, Math.min(1440, +body.everyMinutes || 15)), active: true, createdAt: now(), createdBy: u.name, lastSyncAt: null, stats: null, error: '' };
    db.connectors.unshift(c); audit(u, 'Connected a folder', dir, col.name); syncConnector(c, u); return c;
  }, A);
  on('POST', '/api/connectors/:id/sync', ({ u, p }) => { const c = byId(db.connectors, p.id, 'Connector'); syncConnector(c, u); return c; }, A);
  on('DELETE', '/api/connectors/:id', ({ u, p }) => { const c = byId(db.connectors, p.id, 'Connector'); db.connectors = db.connectors.filter(x => x.id !== c.id); db.documents.forEach(d => { if (d.source && d.source.connectorId === c.id) delete d.source; }); audit(u, 'Disconnected a folder', c.path, 'Documents already copied were kept'); return { ok: true }; }, A);

  // ---------- saved prompts
  on('POST', '/api/prompts', ({ u, body }) => { const title = String(body.title || '').trim().slice(0, 60), text = String(body.text || '').trim().slice(0, 4000); if (!title || !text) throw err(400, 'A saved prompt needs a name and some text.'); const p = { id: uid('pr'), userId: u.id, byName: u.name, title, text, command: String(body.command || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 30), tags: (body.tags || []).map(t => String(t).trim().slice(0, 24)).filter(Boolean).slice(0, 6), shared: isAdmin(u) && !!body.shared, createdAt: now() }; db.prompts.unshift(p); return p; });
  on('DELETE', '/api/prompts/:id', ({ u, p }) => { const x = byId(db.prompts, p.id, 'Prompt'); if (x.userId !== u.id && !isAdmin(u)) throw err(403, 'You can only remove prompts you saved.'); db.prompts = db.prompts.filter(i => i.id !== x.id); return { ok: true }; });

  // ---------- workflows: read tables from documents, check them with fixed rules, stop for a person when something is off
  const num = v => { const n = parseFloat(String(v ?? '').replace(/[,\s₹]|rs\.?|inr/gi, '')); return Number.isFinite(n) ? n : null; };
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  function parseCsv(text) {
    const first = text.split(/\r?\n/).find(l => l.trim()) || '', delim = ['\t', ';', '|', ','].sort((a, b) => first.split(b).length - first.split(a).length)[0];
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; }
      else if (ch === '"') q = true;
      else if (ch === delim) { row.push(cell.trim()); cell = ''; }
      else if (ch === '\n') { row.push(cell.trim()); rows.push(row); row = []; cell = ''; }
      else if (ch !== '\r') cell += ch;
    }
    if (cell || row.length) { row.push(cell.trim()); rows.push(row); }
    return rows;
  }
  const COLS = { item: /^(item|items|description|item description|material|product|particulars|name)$/, qty: /^(qty|quantity|units|received|received qty|qty received|ordered qty|order qty)$/, rate: /^(rate|price|unit price|unit rate|basic rate)$/, amount: /^(amount|total|value|line total|net amount|taxable value)$/, tax: /^(gst|gst %|tax|tax %|gst rate|igst|igst %)$/, hsn: /^(hsn|hsn code|hsn sac|sac)$/ };
  const C36 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const gstinOk = g => { let s = 0; for (let i = 0; i < 14; i++) { const p = C36.indexOf(g[i]) * (i % 2 ? 2 : 1); s += Math.floor(p / 36) + p % 36; } return C36[(36 - s % 36) % 36] === g[14] && +g.slice(0, 2) >= 1 && +g.slice(0, 2) <= 38; };
  const RX = { gstin: /\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/g, pan: /\b[A-Z]{5}\d{4}[A-Z]\b/g, ifsc: /\b[A-Z]{4}0[A-Z0-9]{6}\b/g, aadhaar: /\b[2-9]\d{3}[\s-]?\d{4}[\s-]?\d{4}\b/g };
  // Turns one document into header fields and line items. Works on CSV-like text; falls back to "name qty rate amount" lines.
  function readDoc(inp) {
    const text = String(inp.text || ''), rows = parseCsv(text), fields = {}, lines = [];
    let head = -1, map = null;
    for (let i = 0; i < rows.length && head < 0; i++) { const m = {}; rows[i].forEach((c, j) => { for (const k in COLS) if (COLS[k].test(norm(c)) && !(k in m)) m[k] = j; }); if ('item' in m && Object.keys(m).length >= 2) { head = i; map = m; } }
    const kv = (a, b) => { if (a && b && a.length < 40) fields[norm(a)] = b; };
    for (const r of rows.slice(0, head < 0 ? rows.length : head)) { if (r.length >= 2) kv(r[0], r[1]); else { const m = (r[0] || '').match(/^([^:]{2,40}):\s*(.+)$/); if (m) kv(m[1], m[2]); } }
    if (head >= 0) for (const r of rows.slice(head + 1)) {
      const item = r[map.item] || '';
      if (!r.some(Boolean)) continue;
      if (/^(grand )?(sub ?)?total|^taxable|^gst|^igst|^cgst|^sgst|^round/i.test(item) || !item) { const v = r.map(num).filter(x => x !== null).pop(); if (item && v !== null) fields[norm(item)] = String(v); continue; }
      lines.push({ item, key: norm(item), qty: num(r[map.qty]), rate: num(r[map.rate]), amount: num(r[map.amount]), tax: num(r[map.tax]), hsn: map.hsn !== undefined ? r[map.hsn] : '' });
    }
    else for (const l of text.split(/\r?\n/)) { const m = l.match(/^(.+?)\s+(\d+(?:\.\d+)?)\s+([\d,]+(?:\.\d+)?)\s+([\d,]+(?:\.\d+)?)\s*$/); if (m) lines.push({ item: m[1].trim(), key: norm(m[1]), qty: num(m[2]), rate: num(m[3]), amount: num(m[4]), tax: null, hsn: '' }); }
    const pick = (...names) => { for (const n of names) for (const k in fields) if (k === n || k.startsWith(n)) return fields[k]; return ''; };
    return { name: inp.name, fields, lines, text, gstins: [...new Set(text.match(RX.gstin) || [])], invoiceNo: pick('invoice no', 'invoice number', 'invoice'), poNo: pick('po no', 'po number', 'purchase order'), date: pick('invoice date', 'date'), supplier: pick('supplier', 'vendor', 'seller', 'from'), total: num(pick('grand total', 'total')) };
  }
  const similar = (a, b) => { const x = new Set(a.split(' ')), y = new Set(b.split(' ')); const i = [...x].filter(t => y.has(t)).length; return i / (x.size + y.size - i || 1); };
  const findLine = (lines, key) => lines.find(l => l.key === key) || lines.map(l => ({ l, s: similar(l.key, key) })).filter(x => x.s >= 0.6).sort((a, b) => b.s - a.s).map(x => x.l)[0];
  const money = n => n === null || n === undefined ? '' : Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });

  function threeWay(inputs, opt) {
    const get = r => inputs.find(i => i.role === r); const missing = ['po', 'grn', 'invoice'].filter(r => !get(r));
    if (missing.length) throw err(400, 'Add all three documents: purchase order, goods receipt and invoice.');
    const po = readDoc(get('po')), grn = readDoc(get('grn')), inv = readDoc(get('invoice')), tol = Math.max(0, Math.min(20, +opt.tolerance || 1));
    for (const [d, n] of [[po, 'purchase order'], [grn, 'goods receipt'], [inv, 'invoice']]) if (!d.lines.length) throw err(400, `No line items could be read from the ${n} "${d.name}". Use a table with item, quantity, rate and amount columns.`);
    const findings = [], lines = []; let variance = 0;
    for (const l of inv.lines) {
      const p = findLine(po.lines, l.key), g = findLine(grn.lines, l.key), flags = [];
      if (l.qty !== null && l.rate !== null && l.amount !== null && Math.abs(l.qty * l.rate - l.amount) > 0.5) flags.push(`Amount ${money(l.amount)} is not quantity × rate (${money(l.qty * l.rate)})`);
      if (!p) flags.push('Not on the purchase order');
      else { if (p.rate && l.rate !== null && Math.abs(l.rate - p.rate) / p.rate * 100 > tol) flags.push(`Rate ${money(l.rate)} against ${money(p.rate)} ordered`); if (p.qty !== null && l.qty > p.qty) flags.push(`Billed ${l.qty}, ordered ${p.qty}`); }
      if (!g) flags.push('Not on the goods receipt'); else if (g.qty !== null && l.qty > g.qty) flags.push(`Billed ${l.qty}, received ${g.qty}`);
      const fair = p && g ? Math.min(l.qty ?? 0, g.qty ?? l.qty, p.qty ?? l.qty) * (p.rate ?? l.rate ?? 0) : 0;
      if (flags.length) variance += Math.abs((l.amount ?? 0) - fair);
      lines.push({ item: l.item, poQty: p ? p.qty : null, poRate: p ? p.rate : null, grnQty: g ? g.qty : null, invQty: l.qty, invRate: l.rate, invAmount: l.amount, flags });
    }
    for (const p of po.lines) if (!findLine(inv.lines, p.key)) findings.push({ level: 'info', text: `"${p.item}" was ordered but is not on this invoice.` });
    const sum = inv.lines.reduce((a, l) => a + (l.amount || 0), 0), taxable = num(inv.fields['taxable value'] ?? inv.fields['sub total'] ?? inv.fields.subtotal);
    if (taxable !== null && Math.abs(taxable - sum) > 1) { findings.push({ level: 'warn', text: `Line amounts add up to ${money(sum)} but the invoice states ${money(taxable)}.` }); variance += Math.abs(taxable - sum); }
    else findings.push({ level: 'ok', text: `Line amounts add up to ${money(sum)}.` });
    const gst = inv.gstins[0] || '';
    if (!gst) findings.push({ level: 'warn', text: 'No GSTIN found on the invoice.' });
    for (const g of inv.gstins) findings.push(gstinOk(g) ? { level: 'ok', text: `GSTIN ${g} is well formed and its check character is right.` } : { level: 'warn', text: `GSTIN ${g} fails its check character.` });
    findings.push({ level: 'info', text: 'GSTIN filing status and e-invoice IRN were not checked: this appliance has no connection to the GST portal.' });
    const bad = lines.filter(l => l.flags.length).length + findings.filter(f => f.level === 'warn').length;
    const fy = (() => { const m = String(inv.date).match(/(\d{4})/); const y = m ? +m[1] : new Date().getFullYear(); return `FY${y}`; })();
    return { key: [gst || 'no-gstin', inv.invoiceNo || inv.name, fy].join('|'), title: `Invoice ${inv.invoiceNo || inv.name}`, needsApproval: bad > 0, amount: sum, outcome: bad ? 'Discrepancy' : 'Matched',
      result: { kind: 'three_way', summary: [['Invoice', inv.invoiceNo || inv.name], ['Supplier GSTIN', gst || 'Not found'], ['Purchase order total', money(po.lines.reduce((a, l) => a + (l.amount || 0), 0))], ['Invoice total', money(sum)], ['Value in question', money(variance)], ['Tolerance on rate', tol + '%']], lines, findings },
      events: [['invoice.reconciled', { invoiceNo: inv.invoiceNo || inv.name, status: bad ? 'DISCREPANCY' : 'MATCHED', lines: lines.length, flagged: lines.filter(l => l.flags.length).length, variance: +variance.toFixed(2) }]] };
  }
  const verhoeff = ctx.verhoeff;
  function kyc(inputs) {
    if (!inputs.length) throw err(400, 'Add at least one vendor document.');
    const text = inputs.map(i => i.text).join('\n'), gstins = [...new Set(text.match(RX.gstin) || [])];
    const pans = [...new Set((text.replace(RX.gstin, ' ').match(RX.pan) || []))], ifsc = [...new Set((text.replace(RX.gstin, ' ').match(RX.ifsc) || []))];
    const aad = [...new Set((text.match(RX.aadhaar) || []).map(a => a.replace(/\D/g, '')).filter(verhoeff))];
    const g = gstins[0], pan = pans[0] || (g ? g.slice(2, 12) : '');
    const checks = [
      ['PAN is present and well formed', pans.length > 0, 25], ['GSTIN is present and its check character is right', gstins.length > 0 && gstins.every(gstinOk), 25],
      ['The PAN inside the GSTIN matches the PAN supplied', !!(g && pans.length && g.slice(2, 12) === pans[0]), 15], ['Bank IFSC is present and well formed', ifsc.length > 0, 15],
      ['An identity number with a valid checksum is present', aad.length > 0, 10], ['At least three documents were supplied', inputs.length >= 3, 10]];
    const score = checks.reduce((a, c) => a + (c[1] ? c[2] : 0), 0);
    const findings = checks.map(c => ({ level: c[1] ? 'ok' : 'warn', text: c[0] + (c[1] ? '.' : ': not met.') }));
    ['PAN was not verified with the income tax database: no connection from this appliance.', 'The bank account was not verified by a test transfer: no connection from this appliance.', 'Scans were not checked for tampering: that needs a vision model.'].forEach(t => findings.push({ level: 'info', text: t }));
    return { key: pan || g || sha(text).slice(0, 12), title: `Vendor ${pan || g || inputs[0].name}`, needsApproval: score < 70, amount: 0, outcome: score >= 70 ? 'Verified' : 'Needs review',
      result: { kind: 'kyc', score, summary: [['Risk score', score + ' of 100'], ['PAN', pan || 'Not found'], ['GSTIN', gstins.join(', ') || 'Not found'], ['IFSC', ifsc.join(', ') || 'Not found'], ['Identity number', aad.map(a => 'XXXX XXXX ' + a.slice(8)).join(', ') || 'Not found'], ['Documents', String(inputs.length)]], findings }, events: [] };
  }
  function quotes(inputs) {
    if (inputs.length < 2) throw err(400, 'Add quotes from at least two suppliers.');
    const docs = inputs.map(readDoc).map((d, i) => ({ ...d, supplier: d.supplier || inputs[i].name.replace(/\.[^.]+$/, '') }));
    for (const d of docs) if (!d.lines.length) throw err(400, `No line items could be read from "${d.name}". Use a table with item, quantity and rate columns.`);
    const items = []; docs.forEach(d => d.lines.forEach(l => { if (!items.some(k => k.key === l.key || similar(k.key, l.key) >= 0.6)) items.push({ key: l.key, item: l.item }); }));
    const findings = [], lines = items.map(it => {
      const cells = docs.map(d => { const l = findLine(d.lines, it.key); return l ? { rate: l.rate, amount: l.amount ?? (l.qty !== null && l.rate !== null ? l.qty * l.rate : null) } : null; });
      const rates = cells.map(c => c && c.rate !== null ? c.rate : Infinity), best = Math.min(...rates);
      return { item: it.item, cells, best: best === Infinity ? -1 : rates.indexOf(best) };
    });
    const totals = docs.map((d, i) => ({ supplier: d.supplier, total: lines.reduce((a, l) => a + ((l.cells[i] && l.cells[i].amount) || 0), 0), quoted: lines.filter(l => l.cells[i]).length }));
    totals.forEach(t => { if (t.quoted < lines.length) findings.push({ level: 'warn', text: `${t.supplier} quoted ${t.quoted} of ${lines.length} items.` }); });
    const full = totals.filter(t => t.quoted === lines.length), pool = full.length ? full : totals.filter(t => t.quoted === Math.max(...totals.map(x => x.quoted)));
    const rec = pool.sort((a, b) => a.total - b.total)[0];
    findings.push({ level: 'ok', text: `${rec.supplier} has the lowest total, ${money(rec.total)}, among suppliers that quoted ${full.length ? 'every item' : 'the most items'}.` });
    findings.push({ level: 'info', text: 'Quotes were read from the files you added. Collecting quotes from supplier portals is not part of this build.' });
    return { key: sha(inputs.map(i => i.name + i.text).sort().join('|')).slice(0, 16), title: `Quotes from ${docs.length} suppliers`, needsApproval: true, amount: rec.total, outcome: 'Recommendation ready',
      result: { kind: 'quotes', suppliers: totals, recommended: rec.supplier, summary: [['Suppliers', String(docs.length)], ['Items', String(lines.length)], ['Recommended', rec.supplier], ['Recommended total', money(rec.total)]], lines, findings },
      events: [['rfq.quote_received', { suppliers: totals, recommended: rec.supplier }]] };
  }
  // ---------- custom workflows: a person lists the documents and the rules; the rules are exact, not guesses
  const RULES = {
    present: { fields: { gstin: ['A GSTIN', d => d.gstins[0]], pan: ['A PAN', d => (d.text.replace(RX.gstin, ' ').match(RX.pan) || [])[0]], ifsc: ['An IFSC', d => (d.text.match(RX.ifsc) || [])[0]], 'invoice no': ['An invoice number', d => d.invoiceNo], 'po no': ['A purchase order number', d => d.poNo], date: ['A date', d => d.date || (d.text.match(/\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}\b/) || [])[0]], total: ['A total', d => d.total] } },
  };
  const cleanRule = (r, roles) => {
    const doc = roles.includes(r.doc) ? r.doc : 'any', n = v => Math.max(0, +v || 0);
    if (r.type === 'present' && RULES.present.fields[r.field]) return { type: 'present', field: r.field, doc };
    if (r.type === 'valid_ids') return { type: 'valid_ids' };
    if (r.type === 'same_value' && ['gstin', 'po no', 'invoice no'].includes(r.field)) return { type: 'same_value', field: r.field };
    if (r.type === 'totals_match' && roles.includes(r.a) && roles.includes(r.b) && r.a !== r.b) return { type: 'totals_match', a: r.a, b: r.b, tolerance: Math.min(50, n(r.tolerance)) };
    if (r.type === 'phrase' && String(r.text || '').trim()) return { type: 'phrase', doc, text: String(r.text).trim().slice(0, 120), must: r.must !== false };
    if (r.type === 'max_total' && n(r.amount) > 0) return { type: 'max_total', doc, amount: n(r.amount) };
    return null;
  };
  function cleanType(b, prev = {}) {
    const name = String(b.name || '').trim().slice(0, 60); if (!name) throw err(400, 'Give the workflow a name.');
    const docs = (b.docs || []).map((d, i) => ({ role: String(d.role || 'doc' + (i + 1)).replace(/[^a-z0-9]/gi, '').slice(0, 20) || 'doc' + (i + 1), label: String(d.label || '').trim().slice(0, 40) })).filter(d => d.label).slice(0, 6);
    if (!docs.length) throw err(400, 'Add at least one document the workflow reads.');
    const roles = docs.map(d => d.role), rules = (b.rules || []).map(r => cleanRule(r || {}, roles)).filter(Boolean).slice(0, 20);
    if (!rules.length) throw err(400, 'Add at least one rule to check.');
    return { ...prev, name, description: String(b.description || '').trim().slice(0, 200), icon: /^[a-z_]{2,30}$/.test(b.icon || '') ? b.icon : 'rule', docs, rules, approval: ['fail', 'always', 'never'].includes(b.approval) ? b.approval : 'fail' };
  }
  function customRun(def, inputs) {
    const docs = inputs.map(i => ({ ...readDoc(i), role: i.role })), label = r => (def.docs.find(d => d.role === r) || { label: 'any document' }).label, pool = r => r === 'any' ? docs : docs.filter(d => d.role === r);
    const total = d => d.total !== null && d.total !== undefined ? d.total : (d.lines.length ? d.lines.reduce((a, l) => a + (l.amount || 0), 0) : num((d.text.match(/total[^\d\n]{0,12}([\d,]+(?:\.\d+)?)/i) || [])[1]));
    const findings = [], add = (ok, text) => findings.push({ level: ok ? 'ok' : 'warn', text });
    const missing = def.docs.filter(d => !docs.some(x => x.role === d.role)); missing.forEach(d => add(false, `${d.label} was not given.`));
    for (const r of def.rules) {
      if (r.type === 'present') { const f = RULES.present.fields[r.field], hit = pool(r.doc).map(d => f[1](d)).find(Boolean); add(!!hit, hit ? `${f[0]} is in ${r.doc === 'any' ? 'the documents' : 'the ' + label(r.doc).toLowerCase()}: ${hit}.` : `${f[0]} is missing from ${r.doc === 'any' ? 'the documents' : 'the ' + label(r.doc).toLowerCase()}.`); }
      if (r.type === 'valid_ids') { const text = docs.map(d => d.text).join('\n'), g = [...new Set(text.match(RX.gstin) || [])], bad = g.filter(x => !gstinOk(x)); add(!bad.length, g.length ? (bad.length ? `These GSTINs fail the checksum: ${bad.join(', ')}.` : `Every GSTIN passes the checksum (${g.length} checked).`) : 'No GSTIN was found to check.'); }
      if (r.type === 'same_value') { const get = d => r.field === 'gstin' ? d.gstins[0] : r.field === 'po no' ? d.poNo : d.invoiceNo, vals = docs.map(get).filter(Boolean), same = new Set(vals.map(v => norm(v))).size <= 1; const nm = { gstin: 'GSTIN', 'po no': 'purchase order number', 'invoice no': 'invoice number' }[r.field]; add(vals.length > 1 && same, vals.length < 2 ? `The ${nm} could not be compared: it is in fewer than two documents.` : same ? `The ${nm} is the same in every document: ${vals[0]}.` : `The ${nm} differs between documents: ${[...new Set(vals)].join(' and ')}.`); }
      if (r.type === 'totals_match') { const a = pool(r.a)[0], b = pool(r.b)[0], ta = a && total(a), tb = b && total(b); if (ta == null || tb == null) add(false, `The totals of the ${label(r.a).toLowerCase()} and the ${label(r.b).toLowerCase()} could not both be read.`); else { const gap = ta ? Math.abs(ta - tb) / ta * 100 : (tb ? 100 : 0); add(gap <= r.tolerance, `${label(r.a)} total ${money(ta)} and ${label(r.b).toLowerCase()} total ${money(tb)} ${gap <= r.tolerance ? 'agree' : 'differ by ' + gap.toFixed(1) + '%'}${r.tolerance ? ` (allowed ${r.tolerance}%)` : ''}.`); } }
      if (r.type === 'phrase') { const has = pool(r.doc).some(d => norm(d.text).includes(norm(r.text))); add(has === r.must, `"${r.text}" ${has ? 'is' : 'is not'} in ${r.doc === 'any' ? 'the documents' : 'the ' + label(r.doc).toLowerCase()}${has === r.must ? '.' : r.must ? ', and it has to be.' : ', and it must not be.'}`); }
      if (r.type === 'max_total') { const ts = pool(r.doc).map(total).filter(v => v != null), top = ts.length ? Math.max(...ts) : null; add(top !== null && top <= r.amount, top === null ? 'No total could be read to compare with the limit.' : `Total ${money(top)} is ${top <= r.amount ? 'within' : 'above'} the limit of ${money(r.amount)}.`); }
    }
    const bad = findings.filter(f => f.level === 'warn').length, amount = Math.max(0, ...docs.map(total).filter(v => v != null));
    return { key: def.id + '|' + sha(inputs.map(i => i.role + i.name + i.text).sort().join('|')).slice(0, 16), title: `${def.name}: ${(docs.find(d => d.invoiceNo) || {}).invoiceNo || (docs.find(d => d.poNo) || {}).poNo || inputs[0].name}`, needsApproval: def.approval === 'always' || (def.approval === 'fail' && bad > 0), amount, outcome: bad ? `${bad} ${bad === 1 ? 'rule' : 'rules'} not met` : 'All rules met',
      result: { kind: 'custom', summary: [['Workflow', def.name], ['Documents', inputs.map(i => i.name).join(', ')], ['Rules checked', String(def.rules.length)], ['Rules met', String(findings.length - bad - 0)], ['Highest total', amount ? money(amount) : 'None read']], findings }, events: [] };
  }
  const typeView = t => ({ id: t.id, name: t.name, description: t.description, icon: t.icon, docs: t.docs, rules: t.rules, approval: t.approval, access: t.access || null, createdBy: t.createdBy, createdByName: t.createdByName, updatedAt: t.updatedAt });
  const ownType = (u, id) => { const t = byId(db.flowTypes, id, 'Workflow'); if (!(isAdmin(u) || t.createdBy === u.id)) throw err(403, 'You can only change workflows you made.'); return t; };
  const canRun = (u, t) => isAdmin(u) || t.createdBy === u.id || ctx.allowed(t.access, u);
  on('GET', '/api/workflow-types', ({ u }) => { needGpt(u); return db.flowTypes.filter(t => canRun(u, t)).map(typeView); });
  on('POST', '/api/workflow-types', ({ u, body }) => { needGpt(u); const t = { id: uid('ft'), ...cleanType(body), createdBy: u.id, createdByName: u.name, createdAt: now(), updatedAt: now() }; db.flowTypes.push(t); audit(u, 'Created a workflow', t.name, t.rules.length + ' rules'); return typeView(t); });
  on('PUT', '/api/workflow-types/:id', ({ u, p, body }) => { const t = ownType(u, p.id); Object.assign(t, cleanType(body, t), { updatedAt: now() }); audit(u, 'Changed a workflow', t.name); return typeView(t); });
  on('DELETE', '/api/workflow-types/:id', ({ u, p }) => { const t = ownType(u, p.id); db.flowTypes = db.flowTypes.filter(x => x.id !== t.id); audit(u, 'Deleted a workflow', t.name); return { ok: true }; });

  const TYPES = { three_way: ['Three-way match', threeWay], kyc: ['Vendor KYC check', kyc], quotes: ['Quote comparison', quotes] };
  const typeOf = id => { if (TYPES[id]) return TYPES[id]; const d = String(id || '').startsWith('custom:') && db.flowTypes.find(t => 'custom:' + t.id === id); return d ? [d.name, inputs => customRun(d, inputs)] : null; };
  const wfRow = w => ({ id: w.id, type: w.type, typeName: w.typeName || (TYPES[w.type] || ['Workflow'])[0], title: w.title, status: w.status, outcome: w.outcome, amount: w.amount, createdAt: w.createdAt, createdByName: w.createdByName, decidedAt: w.decision ? w.decision.at : null });
  const canSee = (u, w) => isAdmin(u) || w.createdBy === u.id;
  on('GET', '/api/workflows', ({ u }) => { needGpt(u); return db.workflows.filter(w => canSee(u, w)).map(wfRow); });
  on('GET', '/api/workflows/:id', ({ u, p }) => { const w = byId(db.workflows, p.id, 'Run'); if (!canSee(u, w)) throw err(404, 'Run not found'); return { ...wfRow(w), key: w.key, steps: w.steps, result: w.result, inputs: w.inputs.map(i => ({ role: i.role, name: i.name })), decision: w.decision || null, canDecide: isAdmin(u) && w.status === 'needs_approval' }; });
  on('POST', '/api/workflows', ({ u, body }) => {
    needGpt(u);
    const t = typeOf(body.type); if (!t) throw err(400, 'Pick what to check.');
    const own = db.flowTypes.find(x => 'custom:' + x.id === body.type); if (own && !canRun(u, own)) throw err(403, 'You do not have access to this workflow.');
    if (!(body.inputs || []).some(i => String(i.text || '').trim())) throw err(400, 'Add the documents to check.');
    const inputs = (body.inputs || []).map(i => ({ role: String(i.role || 'doc'), name: String(i.name || 'file').slice(0, 200), text: String(i.text || '') })).filter(i => i.text.trim());
    const out = t[1](inputs, body.options || {});
    const dup = db.workflows.find(w => w.type === body.type && w.key === out.key && w.status !== 'rejected');
    if (dup && !body.again) throw Object.assign(err(409, 'This was already checked. Open the earlier run, or run it again on purpose.'), { extra: { existing: dup.id } });
    const w = { id: uid('wf'), type: body.type, typeName: t[0], key: out.key, title: out.title, createdBy: u.id, createdByName: u.name, createdAt: now(), inputs, result: out.result, amount: out.amount, outcome: out.outcome, status: out.needsApproval ? 'needs_approval' : 'completed', decision: null,
      steps: [['Read the documents', `${inputs.length} read`], ['Run the checks', `${out.result.findings.length} findings`], [out.needsApproval ? 'Waiting for a person to decide' : 'No approval needed', out.outcome]].map(s => ({ label: s[0], detail: s[1] })) };
    db.workflows.unshift(w); audit(u, 'Ran a workflow', t[0], out.outcome);
    out.events.forEach(e => emit(e[0], { runId: w.id, ...e[1] }));
    emit(out.needsApproval ? 'workflow.needs_approval' : 'workflow.completed', { runId: w.id, type: w.type, title: w.title, outcome: w.outcome });
    return wfRow(w);
  });
  on('POST', '/api/workflows/:id/decision', ({ u, p, body }) => {
    const w = byId(db.workflows, p.id, 'Run');
    if (w.status !== 'needs_approval') throw err(409, 'This run is not waiting for a decision.');
    if (w.amount > 1000000 && body.approve && body.confirm !== 'APPROVE') throw err(400, 'This is above 10 lakh rupees. Type APPROVE to confirm.');
    w.decision = { approve: !!body.approve, by: u.name, at: now(), note: String(body.note || '').trim().slice(0, 500) };
    w.status = body.approve ? 'completed' : 'rejected'; w.outcome = body.approve ? 'Approved' : 'Rejected';
    w.steps[2] = { label: body.approve ? 'Approved by ' + u.name : 'Rejected by ' + u.name, detail: w.decision.note };
    audit(u, body.approve ? 'Approved a workflow run' : 'Rejected a workflow run', w.title, w.decision.note);
    emit('workflow.completed', { runId: w.id, type: w.type, title: w.title, outcome: w.outcome, decidedBy: u.name });
    return wfRow(w);
  }, A);

  on('GET', '/api/platform', () => ({
    keys: db.keys.map(keyView), webhooks: db.webhooks.map(hookView), deliveries: db.deliveries.slice(0, 40), events: EVENTS,
    connectors: db.connectors.map(c => ({ ...c, collectionName: (db.collections.find(x => x.id === c.collectionId) || { name: 'Deleted collection' }).name })),
    commands: ctx.commandViews(), probes: ctx.probes(), gatewayUrl: '/gateway/v1',
  }), A);

  return { emit, issueKey, revokeSystemKeys, pendingApprovals: () => db.workflows.filter(w => w.status === 'needs_approval').length, failedDeliveries: () => db.deliveries.filter(d => d.status === 'failed' && Date.now() - new Date(d.at) < 864e5).length };
};
