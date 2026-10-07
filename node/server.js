'use strict';
// VanikGPT prototype server. Zero dependencies. Node 18+.
// Serves the UI, keeps state in data/db.json, runs retrieval, and proxies chat to an
// OpenAI-compatible gateway when VANIK_GATEWAY_URL / VANIK_GATEWAY_KEY are set in .env.
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');

const ROOT = __dirname, PUB = path.join(ROOT, 'public'), DATA = path.join(ROOT, 'data');
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) for (const l of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const PORT = +process.env.PORT || 4320;
const GW = { url: (process.env.VANIK_GATEWAY_URL || '').replace(/\/+$/, ''), key: process.env.VANIK_GATEWAY_KEY || '', model: process.env.VANIK_GATEWAY_MODEL || '', ok: false, checkedAt: null };
const DEMO = process.env.VANIK_DEMO === '1' || (process.argv || []).includes('--demo'); // start with the sample workspace
const DBF = process.env.VANIK_DB || path.join(DATA, 'db.json');

const uid = p => p + '_' + crypto.randomBytes(5).toString('hex');
const now = () => new Date().toISOString();
const err = (status, message) => Object.assign(new Error(message), { status });
const isAdmin = u => u.role === 'owner' || u.role === 'admin';
const allowed = (acc, u) => isAdmin(u) || !acc || (!(acc.deny || []).includes(u.id) && (acc.mode === 'everyone' || (acc.users || []).includes(u.id) || (u.teams || []).some(t => (acc.teams || []).includes(t))));
const cleanAccess = a => { const L = v => [...new Set(v || [])].map(String), deny = L(a && a.deny); return (!a || a.mode !== 'restricted') ? { mode: 'everyone', teams: [], users: [], ...(deny.length ? { deny } : {}) } : { mode: 'restricted', teams: L(a.teams), users: L(a.users), ...(deny.length ? { deny } : {}) }; };

// ---------- state
const defaultConfig = () => ({
  models: [], defaultModel: null, instructions: '', collections: 'all', access: { mode: 'everyone', teams: [], users: [] },
  safety: { pii: 'mask', retentionDays: 0, uploads: true, blockedTopics: [], maskDocuments: false, dailyLimit: 0, voice: false },
  tools: { enabled: ['calculator', 'gst', 'tables', 'browser', 'screen'], browserMode: 'allowed', sites: [], signins: [] },
  advanced: { port: 9016, offline: true, telemetry: false, corsOrigin: '' },
});
const freshApp = () => ({ status: 'not_installed', port: 9016, image: 'vanik-gpt:v0.11.4-vanik.2', needsGb: 1.6, installedAt: null, installedBy: null, config: defaultConfig(), versions: [], deployedVersion: null, deploys: [] });
function seed() {
  const t = now(), M = (id, kind, memGb, context, extra = {}) => ({ id, kind, memGb, context, status: 'available', port: null, ...extra });
  return {
    tenant: { name: 'Demo tenant', slug: 'demo' },
    device: { id: 'dev_1', name: 'Edge 001', ip: '10.0.0.10', memGb: 121.6, diskTb: 3.6, slots: 6, online: true, agent: '0.3.18' },
    users: [{ id: 'u_owner', name: 'Demo Owner', email: 'owner@example.com', role: 'owner', teams: [], status: 'active', joinedAt: t, lastActiveAt: t }],
    models: [
      M('qwen3.5-0.8b', 'chat', 3, 262144, { status: 'serving', port: 9002 }),
      M('rumik-oss-1', 'chat', 9, null, { note: 'Indic languages' }),
      M('olmoe-1b-7b-0924-instruct', 'chat', 19, null),
      M('gpt-oss-20b', 'chat', 30, 131072),
      M('qwen3.8-27b-fp8', 'chat', 36, 262144),
      M('qwen3-30b-a3b-instruct-2507-fp8', 'chat', 41, null),
      M('qwen3.8-27b', 'chat', 71, 262144),
      M('qwen3-embedding-0.6b', 'embedding', 2, 32768),
      M('qwen3-embedding-4b', 'embedding', 11, 40960),
    ],
    collections: [], documents: [], app: freshApp(), assistants: [], chats: [], audit: [], feedback: [],
    keys: [], webhooks: [], deliveries: [], connectors: [], workflows: [], prompts: [], commands: [],
  };
}
let db = fs.existsSync(DBF) ? JSON.parse(fs.readFileSync(DBF, 'utf8')) : seed();
for (const k of ['keys', 'webhooks', 'deliveries', 'connectors', 'workflows', 'prompts', 'commands', 'mcp', 'flowTypes']) db[k] = db[k] || [];
db.app.config.safety = { ...defaultConfig().safety, ...db.app.config.safety };
db.app.config.tools = { ...defaultConfig().tools, ...(db.app.config.tools || {}) };
const AG = { PLUGINS: [], TEMPLATES: [], endSession() {}, mcpViews: () => [] };
const WK = { canWrite: () => false, openTasks: () => 0 };
const MO = { memoryFor: () => [] };
const SYSTEM = { id: 'system', name: 'Vanik OS', role: 'owner', teams: [] };
const FX = { emit() {}, issueKey() {}, revokeSystemKeys() {}, pendingApprovals: () => 0, failedDeliveries: () => 0 };
let saveT;
const save = () => { clearTimeout(saveT); saveT = setTimeout(() => { fs.mkdirSync(path.dirname(DBF), { recursive: true }); fs.writeFileSync(DBF, JSON.stringify(db)); }, 120); };
// Audit entries are chained: each one carries a hash of the one before, so a changed or removed entry shows up on verify.
const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
const auditHash = e => sha256(e.prev + JSON.stringify([e.seq, e.at, e.userId, e.action, e.target, e.detail]));
const audit = (u, action, target, detail) => {
  const last = db.audit[0];
  const e = { id: uid('a'), seq: last && last.seq ? last.seq + 1 : 1, at: now(), userId: u.id, userName: u.name, action, target: target || '', detail: detail || '', prev: last && last.hash ? last.hash : 'genesis' };
  e.hash = auditHash(e); db.audit.unshift(e); if (db.audit.length > 5000) db.audit.length = 5000; save();
};
const byId = (list, id, what) => { const x = list.find(i => i.id === id); if (!x) throw err(404, what + ' not found'); return x; };

// ---------- capacity
const usedGb = () => +(db.models.filter(m => m.status === 'serving' || m.status === 'starting').reduce((a, m) => a + m.memGb, 0) + (db.app.status !== 'not_installed' ? db.app.needsGb : 0)).toFixed(1);
const freeGb = () => +(db.device.memGb - usedGb()).toFixed(1);

// ---------- text, retrieval, PII
const STOP = new Set('a an the is are was were be been of in on at to for from by with and or not this that these those it its as do does did what which who whom how when where why can could should would will shall may i we you they he she our your their me my us about into than then there here have has had if but so'.split(' '));
const stem = w => w.length > 3 ? w.replace(/ies$/, 'y').replace(/s$/, '') : w;
const tok = s => (String(s).toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter(w => w.length > 1 && !STOP.has(w)).map(stem);
const TK = new Map();
const chunkTok = (d, c) => { const k = d.id + ':' + c.id; let t = TK.get(k); if (!t) TK.set(k, t = tok(c.text)); return t; };

function chunkPages(pages) {
  const out = [];
  pages.forEach((text, pi) => {
    let buf = '';
    const push = () => { if (buf.trim()) out.push({ id: 'k' + out.length, page: pi + 1, text: buf.trim() }); buf = ''; };
    const paras = String(text).replace(/\r/g, '').split(/\n\s*\n/).map(p => p.replace(/[ \t]+/g, ' ').trim()).filter(Boolean);
    for (const p of paras) {
      if (p.length <= 700) { if ((buf + '\n' + p).length > 600) push(); buf += (buf ? '\n' : '') + p; continue; }
      push();
      for (let s of (p.match(/[^.!?\n]+[.!?]*\s*/g) || [p])) {
        while (s.length > 600) { push(); buf = s.slice(0, 600); push(); s = s.slice(600); }
        if ((buf + s).length > 600) push();
        buf += s;
      }
      push();
    }
    push();
  });
  return out;
}

function retrieve(query, docs, k = 5) {
  const q = [...new Set(tok(query))];
  if (!q.length) return [];
  const rows = [];
  docs.forEach(d => d.chunks.forEach(c => rows.push({ d, c, t: chunkTok(d, c) })));
  const N = rows.length;
  if (!N) return [];
  const avg = rows.reduce((a, x) => a + x.t.length, 0) / N || 1, df = {};
  q.forEach(w => df[w] = 0);
  rows.forEach(x => { const s = new Set(x.t); q.forEach(w => { if (s.has(w)) df[w]++; }); });
  return rows.map(x => {
    const tf = {}; let sc = 0;
    x.t.forEach(w => { if (w in df) tf[w] = (tf[w] || 0) + 1; });
    for (const w of q) if (tf[w]) sc += Math.log(1 + (N - df[w] + .5) / (df[w] + .5)) * tf[w] * 2.2 / (tf[w] + 1.2 * (.25 + .75 * x.t.length / avg));
    return { ...x, sc };
  }).filter(x => x.sc > 0).sort((a, b) => b.sc - a.sc).slice(0, k).map((x, i) => ({
    n: i + 1, docId: x.d.id, docName: x.d.name, collectionId: x.d.collectionId, page: x.d.paged ? x.c.page : null, chunkId: x.c.id, text: x.c.text, score: +x.sc.toFixed(2),
  }));
}

// Builds an answer straight from the matching passages. Used when no model can be reached.
function passageAnswer(query, hits, max = 4) {
  const qt = new Set(tok(query)), sents = [];
  hits.forEach(h => (h.text.match(/(?:[^.!?\n]|\.(?=\d))+[.!?]*/g) || [h.text]).forEach(s => {
    const t = tok(s);
    if (t.length < 4) return;
    const sc = t.filter(w => qt.has(w)).length / Math.sqrt(t.length);
    if (sc > 0) sents.push({ s: s.trim(), n: h.n, sc });
  }));
  sents.sort((a, b) => b.sc - a.sc);
  const picks = [];
  for (const s of sents) { if (s.sc < sents[0].sc * 0.6) break; if (!picks.some(p => p.s === s.s)) picks.push(s); if (picks.length === max) break; }
  if (!picks.length) return hits.slice(0, 2).map(h => `- ${h.text.slice(0, 260).trim()}${h.text.length > 260 ? '…' : ''} [${h.n}]`).join('\n');
  return picks.map(p => `- ${p.s} [${p.n}]`).join('\n');
}

const VD = [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5], [2, 3, 4, 0, 1, 7, 8, 9, 5, 6], [3, 4, 0, 1, 2, 8, 9, 5, 6, 7], [4, 0, 1, 2, 3, 9, 5, 6, 7, 8], [5, 9, 8, 7, 6, 0, 4, 3, 2, 1], [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3], [8, 7, 6, 5, 9, 3, 2, 1, 0, 4], [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]];
const VP = [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4], [5, 8, 0, 3, 7, 9, 6, 1, 4, 2], [8, 9, 1, 6, 0, 4, 3, 5, 2, 7], [9, 4, 5, 3, 1, 2, 6, 8, 7, 0], [4, 2, 8, 6, 5, 7, 3, 9, 0, 1], [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8]];
const verhoeff = s => { let c = 0; s.split('').reverse().forEach((ch, i) => { c = VD[c][VP[i % 8][+ch]]; }); return c === 0; };
const PII = [
  ['Aadhaar', /\b[2-9]\d{3}[\s-]?\d{4}[\s-]?\d{4}\b/g, m => verhoeff(m.replace(/\D/g, ''))],
  ['GSTIN', /\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/g],
  ['PAN', /\b[A-Z]{5}\d{4}[A-Z]\b/g],
  ['IFSC', /\b[A-Z]{4}0[A-Z0-9]{6}\b/g],
  ['Phone', /(?<!\d)(?:\+91[\s-]?|0)?[6-9]\d{9}(?!\d)/g],
  ['Email', /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g],
];
function scanPii(text, mask) {
  const found = new Set();
  let out = text;
  for (const [name, re, check] of PII) out = out.replace(re, m => { if (check && !check(m)) return m; found.add(name); return mask ? `[${name}]` : m; });
  return { text: out, found: [...found] };
}

// ---------- gateway
async function checkGateway() {
  GW.checkedAt = now();
  if (!GW.url) return GW.ok = false;
  try { const r = await fetch(GW.url + '/models', { headers: { Authorization: 'Bearer ' + GW.key }, signal: AbortSignal.timeout(4000) }); GW.ok = r.ok; }
  catch { GW.ok = false; }
  return GW.ok;
}
async function streamModel(model, messages, onDelta, signal, opts = {}) {
  const r = await fetch(GW.url + '/chat/completions', {
    method: 'POST', signal, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + GW.key },
    body: JSON.stringify({ model: GW.model || model, messages, stream: true, temperature: 0.2, ...(opts.max ? { max_tokens: opts.max } : {}) }),
  });
  if (!r.ok || !r.body) throw new Error('gateway ' + r.status);
  const dec = new TextDecoder(); let buf = '', usage = null;
  for await (const part of r.body) {
    buf += dec.decode(part, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line.startsWith('data:')) continue;
      const d = line.slice(5).trim();
      if (d === '[DONE]') return usage;
      try { const j = JSON.parse(d); if (j.usage) usage = j.usage; const t = j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content; if (t) onDelta(t); } catch { /* partial line */ }
    }
  }
  return usage;
}

// ---------- meaning-based search on top of keyword search (needs a serving embedding model and a reachable gateway)
async function embed(texts) {
  const m = db.models.find(x => x.kind === 'embedding' && x.status === 'serving');
  if (!GW.url || !m) return null;
  try {
    const r = await fetch(GW.url + '/embeddings', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + GW.key }, body: JSON.stringify({ model: process.env.VANIK_GATEWAY_EMBED_MODEL || m.id, input: texts }), signal: AbortSignal.timeout(20000) });
    if (!r.ok) return null;
    return (await r.json()).data.map(d => d.embedding);
  } catch { return null; }
}
async function embedDoc(d) {
  const todo = d.chunks.filter(c => !c.v);
  for (let i = 0; i < todo.length; i += 32) {
    const part = todo.slice(i, i + 32), v = await embed(part.map(c => c.text));
    if (!v) return false;
    part.forEach((c, k) => { c.v = v[k].map(x => +x.toFixed(4)); });
  }
  save(); return true;
}
const cos = (a, b) => { let s = 0, x = 0, y = 0; for (let i = 0; i < a.length; i++) { s += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; } return s / (Math.sqrt(x * y) || 1); };
// Reciprocal rank fusion of the keyword list and the meaning list. Falls back to keyword only.
async function search(query, docs, k = 5) {
  const kw = retrieve(query, docs, 20), rows = [];
  docs.forEach(d => d.chunks.forEach(c => { if (c.v) rows.push({ d, c }); }));
  let sem = [];
  if (rows.length) { const q = await embed([query]); if (q) sem = rows.map(x => ({ ...x, s: cos(q[0], x.c.v) })).filter(x => x.s > 0.2).sort((a, b) => b.s - a.s).slice(0, 20); }
  if (!sem.length) return kw.slice(0, k).map(h => ({ ...h, via: 'keyword' }));
  const score = new Map(), meta = new Map();
  kw.forEach((h, i) => { const id = h.docId + ':' + h.chunkId; score.set(id, 1 / (60 + i)); meta.set(id, { ...h, via: 'keyword' }); });
  sem.forEach((x, i) => {
    const id = x.d.id + ':' + x.c.id; score.set(id, (score.get(id) || 0) + 1 / (60 + i));
    if (meta.has(id)) meta.get(id).via = 'both';
    else meta.set(id, { docId: x.d.id, docName: x.d.name, collectionId: x.d.collectionId, page: x.d.paged ? x.c.page : null, chunkId: x.c.id, text: x.c.text, score: +x.s.toFixed(2), via: 'meaning' });
  });
  return [...score.entries()].sort((a, b) => b[1] - a[1]).slice(0, k).map(([id], i) => ({ ...meta.get(id), n: i + 1 }));
}
const usableDoc = (u, d) => (!d.expiresOn || d.expiresOn >= now().slice(0, 10)) && (!(d.restrict || []).length || isAdmin(u) || (u.teams || []).some(t => d.restrict.includes(t)));

// ---------- deploy lifecycle (the device agent is simulated by elapsed time)
const STEPS = [['queue', 'Waiting for the device', 1200], ['pull', 'Getting the app image', 2500], ['start', 'Starting the app', 1800], ['model', 'Connecting to your model', 1200], ['health', 'Health check', 1200]];
function endDeploy(d, result, reason) {
  d.result = result; d.endedAt = now(); d.reason = reason || '';
  const a = db.app;
  if (result === 'ok') { a.status = 'running'; a.deployedVersion = d.v; }
  else a.status = a.deployedVersion && d.wasRunning ? 'running' : (a.deployedVersion ? 'stopped' : 'needs_setup');
  if (result === 'failed') a.lastFailure = { at: d.endedAt, reason };
  if (result !== 'cancelled') FX.emit('app.deploy.finished', { version: d.v, result, reason: d.reason });
  save();
}
function tick() {
  const d = db.app.deploys[0];
  if (!d || d.result) return;
  if (!db.device.online) {
    d.t0 = null; d.step = 0;
    if (Date.now() - new Date(d.startedAt) > 20000) endDeploy(d, 'failed', 'The device did not pick this up. Check that the Vanik Appliance is online, then deploy again.');
    return;
  }
  if (!d.t0) { d.t0 = now(); save(); }
  const el = Date.now() - new Date(d.t0);
  let acc = 0, done = 0;
  for (const s of STEPS) { acc += s[2]; if (el >= acc) done++; else break; }
  if (done >= 4 && !d.modelOk) {
    const cfg = db.app.versions.find(v => v.v === d.v).config;
    if (!cfg.models.some(id => db.models.some(m => m.id === id && m.status === 'serving'))) { d.step = 3; return endDeploy(d, 'failed', 'None of the chosen models is serving. Serve one in Model Hub, then deploy again.'); }
    d.modelOk = true;
  }
  d.step = Math.min(done, STEPS.length - 1);
  if (done >= STEPS.length) endDeploy(d, 'ok');
}
// Model serve and park run as device commands with steps, like a deploy.
const CMD = { fetch: [['Waiting for the device', 400], ['Getting the model files', 900], ['Checking the file fingerprint', 400], ['Starting the model server', 700], ['Test question', 400]], start: [['Waiting for the device', 400], ['Starting the model server', 700], ['Test question', 400]], park: [['Stopped the model server', 0]] };
function tickCommands() {
  for (const c of db.commands) {
    if (c.result) continue;
    const m = db.models.find(x => x.id === c.target);
    const fail = why => { c.result = 'failed'; c.reason = why; c.endedAt = now(); if (m && m.status === 'starting') m.status = m.prev || 'available'; save(); };
    if (!m) { fail('The model is no longer in the catalog.'); continue; }
    if (!db.device.online) { c.t0 = null; if (Date.now() - new Date(c.startedAt) > 20000) fail('The device did not pick this up.'); continue; }
    if (!c.t0) c.t0 = now();
    const el = Date.now() - new Date(c.t0), steps = CMD[c.kind]; let acc = 0, done = 0;
    for (const st of steps) { acc += st[1]; if (el >= acc) done++; else break; }
    c.step = Math.min(done, steps.length - 1);
    if (done >= steps.length) { c.result = 'ok'; c.endedAt = now(); m.status = 'serving'; m.port = m.kind === 'embedding' ? 9002 : 9000; m.testedAt = now(); delete m.prev; save(); }
  }
}
setInterval(() => { tick(); tickCommands(); }, 300).unref();
const deployView = d => d && ({
  id: d.id, v: d.v, by: d.by, startedAt: d.startedAt, endedAt: d.endedAt || null, result: d.result || null, reason: d.reason || '', note: d.note || '',
  steps: STEPS.map((s, i) => ({ label: s[1], state: d.result === 'ok' ? 'done' : i < (d.step || 0) ? 'done' : i === (d.step || 0) ? (d.result === 'failed' ? 'failed' : d.result === 'cancelled' ? 'cancelled' : 'active') : 'pending' })),
});
function startDeploy(u, note) {
  const a = db.app, cfg = a.config;
  if (a.status === 'not_installed') throw err(400, 'Install VanikGPT first.');
  if (a.status === 'deploying') throw err(409, 'A deploy is already running.');
  if (!cfg.models.length) throw err(400, 'Pick at least one model before you deploy.');
  if (!a.versions.length) throw err(400, 'Save your setup before you deploy.');
  const v = a.versions[0].v;
  a.deploys.unshift({ id: uid('d'), v, by: u.name, startedAt: now(), step: 0, t0: null, note: note || '', wasRunning: a.status === 'running' });
  a.status = 'deploying';
  audit(u, 'Deployed VanikGPT', 'config v' + v, note);
}

// ---------- views
const collectionView = c => { const docs = db.documents.filter(d => d.collectionId === c.id); return { ...c, docCount: docs.length, bytes: docs.reduce((a, d) => a + d.size, 0), passages: docs.reduce((a, d) => a + d.chunks.length, 0), embedded: docs.reduce((a, d) => a + d.chunks.filter(k => k.v).length, 0) }; };
const docView = d => ({ id: d.id, collectionId: d.collectionId, name: d.name, size: d.size, type: d.type, pages: d.pageCount, paged: d.paged, chunks: d.chunks.length, uploadedBy: d.uploadedBy, uploadedAt: d.uploadedAt, purpose: d.purpose || '', expiresOn: d.expiresOn || '', restrict: d.restrict || [], pii: d.pii || [], ocr: !!d.ocr, embedded: d.chunks.filter(c => c.v).length, synced: !!d.source, waiting: !!d.waiting, note: !!d.note, transcribed: !!d.transcribed });
const canUseGpt = u => db.app.status === 'running' && db.device.online && allowed(db.app.config.access, u);
const gptCollections = u => { const sel = db.app.config.collections; return db.collections.filter(c => allowed(c.access, u) && (sel === 'all' || sel.includes(c.id))); };
const canSeeAssistant = (u, a) => a.createdBy === u.id || (a.shared && allowed(a.access, u));
const chatRow = c => ({ id: c.id, title: c.title, pinned: !!c.pinned, shared: !!c.shared, assistantId: c.assistantId || null, updatedAt: c.updatedAt, createdAt: c.createdAt });
function attention() {
  const a = db.app, out = [], add = (text, action, href) => out.push({ text, action, href });
  if (!db.device.online) add('The Vanik Appliance is offline. Apps and models are stopped.', 'Settings', '#/os/settings');
  if (a.status === 'needs_setup') add('VanikGPT is installed but not set up.', 'Finish setup', '#/os/apps/vanikgpt/setup');
  if (a.status === 'stopped') add('VanikGPT is stopped.', 'Open', '#/os/apps/vanikgpt/overview');
  const d = a.deploys[0];
  if (d && d.result === 'failed' && a.deployedVersion !== d.v) add('The last VanikGPT deploy did not finish.', 'See why', '#/os/apps/vanikgpt/overview');
  if (a.status !== 'not_installed' && a.config.models.length && !a.config.models.some(id => db.models.some(m => m.id === id && m.status === 'serving'))) add('None of the models chosen for VanikGPT is serving.', 'Model Hub', '#/os/models');
  if (a.status === 'running' && !GW.ok) add('The model gateway cannot be reached. Answers are built from documents only.', 'Check', '#/os/apps/vanikgpt/overview');
  const n = FX.pendingApprovals(); if (n) add(`${n} workflow ${n === 1 ? 'run is' : 'runs are'} waiting for a decision.`, 'Review', '#/gpt/flows');
  const f = FX.failedDeliveries(); if (f) add(`${f} webhook ${f === 1 ? 'delivery' : 'deliveries'} failed in the last day.`, 'API gateway', '#/os/api-gateway/webhooks');
  db.connectors.filter(c => c.error).forEach(c => add(`Folder ${c.path}: ${c.error}`, 'Connectors', '#/os/connectors'));
  return out;
}
const commandViews = () => [...db.commands.slice(0, 20).map(c => ({ id: c.id, type: c.type, target: c.target, by: c.by, startedAt: c.startedAt, endedAt: c.endedAt || null, result: c.result || null, reason: c.reason || '', steps: CMD[c.kind].map((st, i) => ({ label: st[0], state: c.result === 'ok' ? 'done' : i < (c.step || 0) ? 'done' : i === (c.step || 0) ? (c.result === 'failed' ? 'failed' : 'active') : 'pending' })) })),
  ...db.app.deploys.slice(0, 10).map(d => ({ ...deployView(d), type: 'Deploy app', target: 'VanikGPT config v' + d.v }))].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
const probes = () => {
  const pass = db.documents.reduce((a, d) => a + d.chunks.length, 0), emb = db.documents.reduce((a, d) => a + d.chunks.filter(c => c.v).length, 0), up = db.device.online;
  return [
    { name: 'Console', state: 'ok', detail: 'Serving this page' },
    { name: 'Device agent', state: up ? 'ok' : 'down', detail: up ? 'Agent ' + db.device.agent + ' is checking in' : 'Offline' },
    { name: 'Inference', state: up && db.models.some(m => m.status === 'serving') ? 'ok' : 'idle', detail: db.models.filter(m => m.status === 'serving').length + ' serving' },
    { name: 'Model gateway', state: GW.ok ? 'ok' : GW.url ? 'down' : 'idle', detail: GW.ok ? 'Reachable' : GW.url ? 'Not reachable' : 'No model server connected' },
    { name: 'App runtime', state: up && db.app.status === 'running' ? 'ok' : 'idle', detail: db.app.status === 'running' ? 'VanikGPT running' : 'No app running' },
    { name: 'Knowledge index', state: pass ? 'ok' : 'idle', detail: `${pass} ${pass === 1 ? 'passage' : 'passages'}, ${emb} with meaning-based search` },
    { name: 'Connectors', state: db.connectors.some(c => c.error) ? 'down' : db.connectors.length ? 'ok' : 'idle', detail: db.connectors.length + (db.connectors.length === 1 ? ' folder' : ' folders') },
    { name: 'Webhooks', state: FX.failedDeliveries() ? 'down' : db.webhooks.length ? 'ok' : 'idle', detail: db.webhooks.length + ' set up' },
  ];
};
function bootstrap(u) {
  tick(); tickCommands();
  const a = db.app, admin = isAdmin(u);
  return {
    tenant: db.tenant, me: u, admin,
    device: { ...db.device, usedGb: usedGb(), freeGb: freeGb(), serving: db.models.filter(m => m.status === 'serving').length },
    models: db.models,
    app: { status: a.status, port: a.port, image: a.image, needsGb: a.needsGb, installedAt: a.installedAt, installedBy: a.installedBy, config: a.config, deployedVersion: a.deployedVersion, latestVersion: a.versions[0] ? a.versions[0].v : null, lastFailure: a.lastFailure || null,
      versions: admin ? a.versions.map(v => ({ v: v.v, at: v.at, by: v.by, note: v.note, config: v.config })) : [], deploys: admin ? a.deploys.slice(0, 30).map(deployView) : [], deploy: deployView(a.deploys[0]) },
    gateway: { configured: !!GW.url, ok: GW.ok, checkedAt: GW.checkedAt },
    canUseGpt: canUseGpt(u),
    collections: (admin ? db.collections : db.collections.filter(c => allowed(c.access, u))).map(c => ({ ...collectionView(c), canWrite: WK.canWrite(u, c) })),
    gptCollectionIds: gptCollections(u).map(c => c.id),
    assistants: db.assistants.filter(x => canSeeAssistant(u, x)),
    chats: db.chats.filter(c => c.userId === u.id && !c.temp).sort((x, y) => y.updatedAt.localeCompare(x.updatedAt)).map(chatRow),
    users: admin ? db.users : db.users.map(x => ({ id: x.id, name: x.name })),
    teams: [...new Set(db.users.flatMap(x => x.teams || []))].sort(),
    prompts: db.prompts.filter(q => q.shared || q.userId === u.id), attention: admin ? attention() : [],
    plugins: admin ? AG.PLUGINS : AG.PLUGINS.filter(p => allowed(db.pluginAccess[p.id], u)), toolConnectors: AG.mcpViews().filter(m => admin || allowed((db.mcp.find(x => x.id === m.id) || {}).access, u)), sample: !!db.sample, openTasks: WK.openTasks(u),
    embeddingReady: !!(GW.ok && db.models.some(m => m.kind === 'embedding' && m.status === 'serving')),
  };
}
function usage() {
  const days = [...Array(7)].map((_, i) => { const d = new Date(Date.now() - (6 - i) * 864e5); return { day: d.toISOString().slice(0, 10), questions: 0, tokens: 0 }; });
  const byDay = Object.fromEntries(days.map(d => [d.day, d])), per = {}, modes = { model: 0, documents: 0, unavailable: 0, blocked: 0, tool: 0 }, cited = {};
  let q = 0, tokens = 0, ms = 0, answers = 0, up = 0, down = 0;
  for (const c of db.chats) for (const m of c.messages) {
    const day = byDay[m.at.slice(0, 10)];
    if (m.role === 'user') { q++; if (day) day.questions++; const p = per[c.userId] || (per[c.userId] = { questions: 0, last: m.at }); p.questions++; if (m.at > p.last) p.last = m.at; continue; }
    answers++; ms += m.ms || 0; const t = (m.tokensIn || 0) + (m.tokensOut || 0); tokens += t; if (day) day.tokens += t;
    modes[m.mode] = (modes[m.mode] || 0) + 1;
    if (m.feedback === 'up') up++; if (m.feedback === 'down') down++;
    const used = new Set([...m.content.matchAll(/\[(\d{1,2})\]/g)].map(x => +x[1]));
    (m.citations || []).filter(x => !used.size || used.has(x.n)).forEach(x => { cited[x.collectionId] = (cited[x.collectionId] || 0) + 1; });
  }
  const reasons = {};
  db.feedback.forEach(f => { reasons[f.reason] = (reasons[f.reason] || 0) + 1; });
  return {
    days, questions: q, tokens, avgMs: answers ? Math.round(ms / answers) : 0, activeUsers: Object.keys(per).length, chats: db.chats.length, modes, up, down, reasons,
    notes: db.feedback.filter(f => f.note).slice(0, 20).map(f => ({ at: f.at, reason: f.reason, note: f.note, userName: f.userName })),
    people: Object.entries(per).map(([id, p]) => ({ name: (db.users.find(x => x.id === id) || { name: 'Removed user' }).name, ...p })).sort((a, b) => b.questions - a.questions),
    collections: Object.entries(cited).map(([id, n]) => ({ name: id.startsWith('chat:') ? 'Files attached in chats' : (db.collections.find(c => c.id === id) || { name: 'Deleted collection' }).name, n })).sort((a, b) => b.n - a.n),
  };
}
function purge() {
  const stale = db.chats.filter(c => c.temp && Date.now() - new Date(c.updatedAt) > 72e5).map(c => c.id);
  if (stale.length) { db.chats = db.chats.filter(c => !stale.includes(c.id)); db.documents = db.documents.filter(d => !stale.some(id => d.collectionId === 'chat:' + id)); }
  const today = now().slice(0, 10), exp = db.documents.filter(x => x.expiresOn && x.expiresOn < today);
  if (exp.length) { db.documents = db.documents.filter(x => !exp.includes(x)); audit(SYSTEM, 'Removed expired documents', exp.length + ' documents', 'Past their keep-until date'); }
  const d = db.app.config.safety.retentionDays;
  if (!d) return;
  const cut = new Date(Date.now() - d * 864e5).toISOString(), before = db.chats.length;
  const gone = db.chats.filter(c => c.updatedAt < cut).map(c => c.id);
  if (!gone.length) return;
  db.chats = db.chats.filter(c => !gone.includes(c.id));
  db.documents = db.documents.filter(x => !gone.some(id => x.collectionId === 'chat:' + id));
  audit(SYSTEM, 'Removed old chats', (before - db.chats.length) + ' chats', 'Older than ' + d + ' days');
  save();
}
setInterval(purge, 3600e3).unref(); purge();

function addDocument(u, collectionId, b, quiet) {
  let pages = (Array.isArray(b.pages) ? b.pages : []).map(p => String(p || ''));
  if (b.audio && b.name && !pages.join('').trim()) { // a recording with no transcript yet: kept, and searchable once it has one
    const d = { id: uid('doc'), collectionId, name: String(b.name).slice(0, 200), size: +b.size || 0, type: String(b.type || 'audio').slice(0, 20), pageCount: 0, paged: false, chunks: [], uploadedBy: u.name, uploadedAt: now(), purpose: String(b.purpose || '').slice(0, 120), expiresOn: '', restrict: [], pii: [], ocr: false, waiting: true };
    db.documents.push(d); return d;
  }
  if (!b.name || !pages.join('').trim()) throw err(400, 'No readable text found in "' + (b.name || 'file') + '".');
  const found = new Set();
  if (db.app.config.safety.maskDocuments) pages = pages.map(p => { const r = scanPii(p, true); r.found.forEach(x => found.add(x)); return r.text; });
  const chunks = chunkPages(pages);
  const d = { id: uid('doc'), collectionId, name: String(b.name).slice(0, 200), size: +b.size || pages.join('').length, type: String(b.type || 'text').slice(0, 20), pageCount: pages.length, paged: !!b.paged, chunks, uploadedBy: u.name, uploadedAt: now(),
    purpose: String(b.purpose || '').slice(0, 120), expiresOn: /^\d{4}-\d{2}-\d{2}$/.test(b.expiresOn || '') ? b.expiresOn : '', restrict: [], pii: [...found], ocr: !!b.ocr };
  if (['csv', 'tsv', 'xlsx', 'xls'].includes(d.type)) d.table = pages.join('\n').slice(0, 2e6);
  db.documents.push(d);
  embedDoc(d);
  if (!quiet) FX.emit('document.added', { documentId: d.id, name: d.name, collectionId, passages: chunks.length });
  return d;
}

// ---------- routes
const routes = [];
const on = (m, p, fn, o = {}) => routes.push({ m, re: new RegExp('^' + p.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), fn, ...o });
const A = { admin: true };

on('GET', '/api/accounts', () => db.users.map(u => ({ id: u.id, name: u.name, email: u.email, role: u.role, status: u.status })), { open: true });
on('POST', '/api/signin', ({ body }) => { const u = byId(db.users, body.userId, 'Account'); if (u.status === 'invited') { u.status = 'active'; u.joinedAt = now(); } u.lastActiveAt = now(); audit(u, 'Signed in'); return { id: u.id }; }, { open: true });
on('GET', '/api/bootstrap', ({ u }) => bootstrap(u));

// people
on('POST', '/api/users', ({ u, body }) => {
  const email = String(body.email || '').trim().toLowerCase(), name = String(body.name || '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw err(400, 'Enter a valid email.');
  if (!name) throw err(400, 'Enter a name.');
  if (db.users.some(x => x.email === email)) throw err(409, 'That email is already on this tenant.');
  const role = body.role === 'admin' ? 'admin' : 'user';
  const nu = { id: uid('u'), name, email, role, teams: (body.teams || []).map(t => String(t).trim()).filter(Boolean), status: 'invited', joinedAt: null, lastActiveAt: null, invitedAt: now() };
  db.users.push(nu); audit(u, 'Invited a person', email, role === 'admin' ? 'Admin' : 'App user');
  return nu;
}, A);
on('PATCH', '/api/users/:id', ({ u, p, body }) => {
  const x = byId(db.users, p.id, 'Person');
  if (x.role === 'owner' && body.role && body.role !== 'owner') throw err(400, 'The owner role cannot be changed.');
  if (body.role && x.role !== 'owner') { x.role = body.role === 'admin' ? 'admin' : 'user'; audit(u, 'Changed a role', x.email, x.role === 'admin' ? 'Admin' : 'App user'); }
  if (Array.isArray(body.teams)) { x.teams = [...new Set(body.teams.map(t => String(t).trim()).filter(Boolean))]; audit(u, 'Changed teams', x.email, x.teams.join(', ') || 'None'); }
  save(); return x;
}, A);
on('DELETE', '/api/users/:id', ({ u, p }) => {
  const x = byId(db.users, p.id, 'Person');
  if (x.role === 'owner') throw err(400, 'The owner account cannot be removed.');
  db.users = db.users.filter(i => i.id !== x.id);
  db.chats = db.chats.filter(c => c.userId !== x.id);
  audit(u, 'Removed a person', x.email); return { ok: true };
}, A);
on('POST', '/api/users/:id/erase', ({ u, p }) => {
  const x = byId(db.users, p.id, 'Person'), chats = db.chats.filter(c => c.userId === x.id), ids = chats.map(c => 'chat:' + c.id), mids = new Set(chats.flatMap(c => c.messages.map(m => m.id)));
  const files = db.documents.filter(d => ids.includes(d.collectionId)).length, prompts = db.prompts.filter(q => q.userId === x.id).length;
  db.chats = db.chats.filter(c => c.userId !== x.id); db.documents = db.documents.filter(d => !ids.includes(d.collectionId));
  db.prompts = db.prompts.filter(q => q.userId !== x.id); db.feedback = db.feedback.filter(f => !mids.has(f.messageId));
  db.assistants = db.assistants.filter(a => !(a.createdBy === x.id && !a.shared));
  audit(u, "Erased a person's data", x.email, `${chats.length} chats, ${files} files, ${prompts} prompts`);
  return { chats: chats.length, files, prompts };
}, A);

// models
on('POST', '/api/models/:id/serve', ({ u, p }) => {
  const m = byId(db.models, p.id, 'Model');
  if (m.status === 'serving' || m.status === 'starting') return m;
  if (!db.device.online) throw err(409, 'The Vanik Appliance is offline.');
  if (db.models.filter(x => x.status === 'serving' || x.status === 'starting').length >= db.device.slots) throw err(409, 'All ' + db.device.slots + ' model slots are in use. Park a model first.');
  if (m.memGb > freeGb()) throw err(409, `Not enough memory. ${m.id} needs ${m.memGb} GB and ${freeGb()} GB is free. Park a model first.`);
  db.commands.unshift({ id: uid('cmd'), type: 'Serve model', target: m.id, by: u.name, startedAt: now(), kind: m.status === 'available' ? 'fetch' : 'start', step: 0 });
  if (db.commands.length > 60) db.commands.length = 60;
  m.prev = m.status; m.status = 'starting';
  audit(u, 'Started serving a model', m.id, m.memGb + ' GB'); return m;
}, A);
on('POST', '/api/models/:id/park', ({ u, p }) => { const m = byId(db.models, p.id, 'Model'); if (m.status === 'starting') { const c = db.commands.find(x => x.target === m.id && !x.result); if (c) { c.result = 'failed'; c.reason = 'Cancelled'; c.endedAt = now(); } m.status = m.prev || 'available'; audit(u, 'Cancelled serving a model', m.id); } if (m.status === 'serving') { m.status = 'parked'; m.port = null; db.commands.unshift({ id: uid('cmd'), type: 'Park model', target: m.id, by: u.name, startedAt: now(), endedAt: now(), kind: 'park', result: 'ok' }); audit(u, 'Parked a model', m.id); } return m; }, A);

// device
on('POST', '/api/device/online', ({ u, body }) => { db.device.online = !!body.online; audit(u, db.device.online ? 'Brought the appliance online' : 'Took the appliance offline', db.device.name); return db.device; }, A);

// knowledge
on('POST', '/api/collections', ({ u, body }) => {
  const name = String(body.name || '').trim();
  if (!name) throw err(400, 'Give the collection a name.');
  if (db.collections.some(c => c.name.toLowerCase() === name.toLowerCase())) throw err(409, 'A collection with that name already exists.');
  const c = { id: uid('col'), name, description: String(body.description || '').trim(), access: cleanAccess(body.access), createdBy: u.name, createdAt: now(), updatedAt: now() };
  db.collections.push(c); audit(u, 'Created a collection', name); return collectionView(c);
}, A);
on('PATCH', '/api/collections/:id', ({ u, p, body }) => {
  const c = byId(db.collections, p.id, 'Collection');
  if (body.name !== undefined) { const n = String(body.name).trim(); if (!n) throw err(400, 'Give the collection a name.'); c.name = n; }
  if (body.description !== undefined) c.description = String(body.description).trim();
  if (body.access) { c.access = cleanAccess(body.access); audit(u, 'Changed who can use a collection', c.name, c.access.mode === 'everyone' ? 'Everyone' : 'Chosen people'); }
  c.updatedAt = now(); save(); return collectionView(c);
}, A);
on('DELETE', '/api/collections/:id', ({ u, p }) => {
  const c = byId(db.collections, p.id, 'Collection');
  db.collections = db.collections.filter(x => x.id !== c.id); db.documents = db.documents.filter(d => d.collectionId !== c.id);
  if (Array.isArray(db.app.config.collections)) db.app.config.collections = db.app.config.collections.filter(i => i !== c.id);
  db.assistants.forEach(a => { if (Array.isArray(a.collections)) a.collections = a.collections.filter(i => i !== c.id); });
  audit(u, 'Deleted a collection', c.name); return { ok: true };
}, A);
on('GET', '/api/collections/:id/documents', ({ u, p }) => { const c = byId(db.collections, p.id, 'Collection'); if (!allowed(c.access, u)) throw err(403, 'You do not have access to this collection.'); return db.documents.filter(d => d.collectionId === c.id).map(docView); });
on('POST', '/api/collections/:id/documents', ({ u, p, body }) => { const c = byId(db.collections, p.id, 'Collection'); if (!WK.canWrite(u, c)) throw err(403, 'You cannot add to this collection. Ask an admin to let you.'); const d = addDocument(u, c.id, body); c.updatedAt = now(); audit(u, 'Added a document', d.name, c.name); return docView(d); });
on('DELETE', '/api/documents/:id', ({ u, p }) => {
  const d = byId(db.documents, p.id, 'Document');
  if (d.collectionId.startsWith('chat:')) { const c = db.chats.find(x => 'chat:' + x.id === d.collectionId); if (!c || c.userId !== u.id) throw err(403, 'Not your file.'); }
  else if (!isAdmin(u)) throw err(403, 'Only admins can remove documents.');
  db.documents = db.documents.filter(x => x.id !== d.id); audit(u, 'Removed a document', d.name); return { ok: true };
});
const canReadDoc = (u, d) => d.collectionId.startsWith('chat:') ? db.chats.some(c => 'chat:' + c.id === d.collectionId && c.userId === u.id) : (() => { const c = db.collections.find(x => x.id === d.collectionId); return !!c && allowed(c.access, u) && usableDoc(u, d); })();
on('GET', '/api/documents/:id', ({ u, p }) => { const d = byId(db.documents, p.id, 'Document'); if (!canReadDoc(u, d)) throw err(403, 'You do not have access to this document.'); return { ...docView(d), collectionName: (db.collections.find(c => c.id === d.collectionId) || { name: 'Attached in chat' }).name, chunkList: d.chunks.map(k => ({ id: k.id, page: k.page, text: k.text })) }; });
on('PATCH', '/api/documents/:id', ({ u, p, body }) => {
  const d = byId(db.documents, p.id, 'Document');
  if (body.purpose !== undefined) d.purpose = String(body.purpose).slice(0, 120);
  if (body.expiresOn !== undefined) d.expiresOn = /^\d{4}-\d{2}-\d{2}$/.test(body.expiresOn) ? body.expiresOn : '';
  if (Array.isArray(body.restrict)) d.restrict = [...new Set(body.restrict.map(String).filter(Boolean))];
  audit(u, 'Changed a document', d.name, [d.purpose && 'purpose: ' + d.purpose, d.expiresOn && 'keep until ' + d.expiresOn, d.restrict.length && 'teams: ' + d.restrict.join(', ')].filter(Boolean).join('; '));
  return docView(d);
}, A);
on('POST', '/api/collections/:id/reindex', async ({ u, p }) => {
  const c = byId(db.collections, p.id, 'Collection'), docs = db.documents.filter(d => d.collectionId === c.id); let n = 0;
  for (const d of docs) if (await embedDoc(d)) n++;
  if (docs.length && !n) throw err(409, 'Meaning-based search needs a serving embedding model and a reachable model gateway.');
  audit(u, 'Rebuilt meaning-based search', c.name, n + ' documents'); return collectionView(c);
}, A);
on('POST', '/api/search', async ({ u, body }) => {
  const cols = db.collections.filter(c => allowed(c.access, u) && (!body.collectionId || c.id === body.collectionId)).map(c => c.id);
  return search(String(body.q || ''), db.documents.filter(d => cols.includes(d.collectionId) && usableDoc(u, d)), 6);
});

// app lifecycle
on('POST', '/api/app/install', ({ u }) => {
  const a = db.app;
  if (a.status !== 'not_installed') throw err(409, 'VanikGPT is already installed.');
  if (!db.device.online) throw err(409, 'The Vanik Appliance is offline.');
  if (a.needsGb > freeGb()) throw err(409, `Not enough memory. VanikGPT needs ${a.needsGb} GB and ${freeGb()} GB is free.`);
  Object.assign(a, freshApp(), { status: 'needs_setup', installedAt: now(), installedBy: u.name });
  const serving = db.models.filter(m => m.kind === 'chat' && m.status === 'serving').map(m => m.id);
  a.config.models = serving; a.config.defaultModel = serving[0] || null;
  FX.issueKey('VanikGPT', 'Vanik OS', true);
  audit(u, 'Installed VanikGPT', db.device.name); return { ok: true };
}, A);
on('PUT', '/api/app/config', ({ u, body }) => {
  const a = db.app, c = body.config || {}, d = defaultConfig();
  if (a.status === 'not_installed') throw err(400, 'Install VanikGPT first.');
  const models = (c.models || []).filter(id => db.models.some(m => m.id === id && m.kind === 'chat'));
  const cfg = {
    models, defaultModel: models.includes(c.defaultModel) ? c.defaultModel : (models[0] || null), instructions: String(c.instructions || '').trim().slice(0, 4000),
    collections: c.collections === 'all' || !Array.isArray(c.collections) ? 'all' : c.collections.filter(id => db.collections.some(x => x.id === id)),
    access: cleanAccess(c.access),
    safety: { pii: ['off', 'flag', 'mask'].includes(c.safety && c.safety.pii) ? c.safety.pii : d.safety.pii, retentionDays: Math.max(0, Math.min(3650, +(c.safety && c.safety.retentionDays) || 0)), uploads: !(c.safety && c.safety.uploads === false),
      blockedTopics: [...new Set(((c.safety && c.safety.blockedTopics) || []).map(t => String(t).trim().toLowerCase()).filter(Boolean))].slice(0, 30), maskDocuments: !!(c.safety && c.safety.maskDocuments), dailyLimit: Math.max(0, Math.min(10000, Math.round(+(c.safety && c.safety.dailyLimit) || 0))), voice: !!(c.safety && c.safety.voice) },
    tools: !c.tools ? d.tools : { enabled: (c.tools.enabled || []).filter(x => ['calculator', 'gst', 'tables', 'browser', 'screen'].includes(x)), browserMode: c.tools.browserMode === 'any' ? 'any' : 'allowed', sites: [...new Set((c.tools.sites || []).map(x => String(x).toLowerCase().trim().replace(/^https?:\/\//, '').split('/')[0]).filter(x => /^[a-z0-9.-]+$/.test(x)))].slice(0, 100),
      signins: (c.tools.signins || []).map(x => ({ host: String(x.host || '').toLowerCase().trim().replace(/^https?:\/\//, '').split('/')[0], kind: x.kind === 'sso' ? 'sso' : 'vault', account: String(x.account || '').trim().slice(0, 80) })).filter(x => /^[a-z0-9.-]+$/.test(x.host)).slice(0, 50) },
    advanced: { port: Math.max(1024, Math.min(65535, +(c.advanced && c.advanced.port) || 9016)), offline: !(c.advanced && c.advanced.offline === false), telemetry: !!(c.advanced && c.advanced.telemetry), corsOrigin: String((c.advanced && c.advanced.corsOrigin) || '').trim() },
  };
  if (a.versions[0] && JSON.stringify(a.versions[0].config) === JSON.stringify(cfg)) return { v: a.versions[0].v, unchanged: true };
  const v = (a.versions[0] ? a.versions[0].v : 0) + 1;
  a.versions.unshift({ v, at: now(), by: u.name, note: String(body.note || ''), config: cfg });
  a.config = cfg; a.port = cfg.advanced.port;
  audit(u, 'Saved VanikGPT setup', 'config v' + v, body.note); purge();
  if (body.deploy) startDeploy(u);
  return { v };
}, A);
on('POST', '/api/app/deploy', ({ u }) => { startDeploy(u); return { ok: true }; }, A);
on('POST', '/api/app/deploy/cancel', ({ u }) => { const d = db.app.deploys[0]; if (!d || d.result) throw err(409, 'Nothing is deploying.'); endDeploy(d, 'cancelled', 'Cancelled by ' + u.name); audit(u, 'Cancelled a deploy', 'config v' + d.v); return { ok: true }; }, A);
on('POST', '/api/app/rollback', ({ u, body }) => {
  const a = db.app, old = a.versions.find(v => v.v === +body.v);
  if (!old) throw err(404, 'Version not found.');
  if (a.status === 'deploying') throw err(409, 'A deploy is already running.');
  const v = a.versions[0].v + 1;
  a.versions.unshift({ v, at: now(), by: u.name, note: 'Rolled back to v' + old.v, config: JSON.parse(JSON.stringify(old.config)) });
  a.config = a.versions[0].config; audit(u, 'Rolled back VanikGPT', 'to config v' + old.v); startDeploy(u, 'Rollback to v' + old.v); return { v };
}, A);
on('POST', '/api/app/stop', ({ u }) => { if (db.app.status !== 'running') throw err(409, 'VanikGPT is not running.'); db.app.status = 'stopped'; audit(u, 'Stopped VanikGPT'); return { ok: true }; }, A);
on('POST', '/api/app/start', ({ u }) => { if (db.app.status !== 'stopped') throw err(409, 'VanikGPT is not stopped.'); startDeploy(u, 'Start'); return { ok: true }; }, A);
on('DELETE', '/api/app', ({ u }) => { if (db.app.status === 'not_installed') throw err(409, 'VanikGPT is not installed.'); db.app = freshApp(); FX.revokeSystemKeys('VanikGPT'); audit(u, 'Uninstalled VanikGPT', db.device.name, 'Chats and agents kept'); return { ok: true }; }, A);
on('POST', '/api/app/check', async () => ({ ok: await checkGateway(), configured: !!GW.url }), A);
on('GET', '/api/admin/usage', () => usage(), A);
on('GET', '/api/admin/audit', () => db.audit.slice(0, 400), A);
on('GET', '/api/admin/audit/verify', () => {
  let prev = null, checked = 0;
  for (const e of [...db.audit].reverse()) { if (!e.hash) continue; if ((prev && e.prev !== prev) || auditHash(e) !== e.hash) return { ok: false, brokenAt: e.seq, checked }; prev = e.hash; checked++; }
  return { ok: true, checked, head: prev };
}, A);
on('GET', '/api/admin/audit/export', () => ({ name: 'audit-log', csv: ['seq,when,who,what,on,detail,hash', ...[...db.audit].reverse().map(e => [e.seq, e.at, e.userName, e.action, e.target, e.detail, e.hash].map(v => '"' + String(v === undefined ? '' : v).replace(/"/g, '""') + '"').join(','))].join('\n') }), A);

// assistants
const cleanAssistant = (b, u, prev = {}) => {
  const name = String(b.name || '').trim();
  if (!name) throw err(400, 'Give the agent a name.');
  if (!String(b.instructions || '').trim()) throw err(400, 'Tell the agent what to do.');
  const shared = isAdmin(u) && b.shared !== false && (b.shared || prev.shared);
  return { name: name.slice(0, 60), description: String(b.description || '').trim().slice(0, 140), instructions: String(b.instructions).trim().slice(0, 6000),
    model: db.app.config.models.includes(b.model) ? b.model : null,
    collections: b.collections === 'all' || !Array.isArray(b.collections) ? 'all' : b.collections.filter(id => db.collections.some(c => c.id === id)),
    starters: (b.starters || []).map(s => String(s).trim()).filter(Boolean).slice(0, 4), shared: !!shared,
    tools: (b.tools || []).filter(x => ['calculator', 'gst', 'tables', 'browser', 'screen'].includes(x)), effort: ['quick', 'balanced', 'thorough'].includes(b.effort) ? b.effort : 'balanced', workflow: ['three_way', 'kyc', 'quotes'].includes(b.workflow) ? b.workflow : null, icon: /^[a-z_]{2,30}$/.test(b.icon || '') ? b.icon : 'smart_toy', access: shared ? cleanAccess(b.access) : { mode: 'restricted', teams: [], users: [] } };
};
const ownAssistant = (u, id) => { const a = byId(db.assistants, id, 'Agent'); if (!(isAdmin(u) || a.createdBy === u.id)) throw err(403, 'You can only change agents you made.'); return a; };
on('POST', '/api/assistants', ({ u, body }) => { const a = { id: uid('as'), ...cleanAssistant(body, u), createdBy: u.id, createdByName: u.name, createdAt: now(), updatedAt: now() }; db.assistants.push(a); audit(u, 'Created an agent', a.name, a.shared ? 'Shared' : 'Private'); return a; });
on('PUT', '/api/assistants/:id', ({ u, p, body }) => { const a = ownAssistant(u, p.id); Object.assign(a, cleanAssistant(body, u, a), { updatedAt: now() }); audit(u, 'Changed an agent', a.name); return a; });
on('DELETE', '/api/assistants/:id', ({ u, p }) => { const a = ownAssistant(u, p.id); db.assistants = db.assistants.filter(x => x.id !== a.id); db.chats.forEach(c => { if (c.assistantId === a.id) c.assistantId = null; }); audit(u, 'Deleted an agent', a.name); return { ok: true }; });

// chats
const needGpt = u => { if (db.app.status !== 'running') throw err(503, 'VanikGPT is not running.'); if (!db.device.online) throw err(503, 'The Vanik Appliance is offline.'); if (!allowed(db.app.config.access, u)) throw err(403, 'You have not been given VanikGPT.'); };
const myChat = (u, id) => { const c = byId(db.chats, id, 'Chat'); if (c.userId !== u.id) throw err(404, 'Chat not found'); return c; };
const chatFull = c => ({ ...c, pending: c.pending ? { id: c.pending.id, reason: c.pending.reason, detail: c.pending.detail } : null, files: db.documents.filter(d => d.collectionId === 'chat:' + c.id).map(docView) });
on('POST', '/api/chats', ({ u, body }) => {
  needGpt(u);
  const as = body.assistantId ? db.assistants.find(a => a.id === body.assistantId && canSeeAssistant(u, a)) : null;
  const cfg = db.app.config;
  const c = { id: uid('c'), userId: u.id, title: 'New chat', pinned: false, assistantId: as ? as.id : null, model: (as && as.model) || (cfg.models.includes(body.model) ? body.model : cfg.defaultModel), sources: as ? as.collections : (body.sources === 'none' || Array.isArray(body.sources) ? body.sources : 'all'), createdAt: now(), updatedAt: now(), messages: [] };
  if (body.temp) c.temp = true;
  c.effort = (as && as.effort) || (['quick', 'balanced', 'thorough'].includes(body.effort) ? body.effort : 'balanced');
  if (Array.isArray(body.plugins)) c.plugins = body.plugins.map(String);
  if (Array.isArray(body.connectors)) c.connectors = body.connectors.map(String);
  db.chats.push(c); save(); return chatFull(c);
});
on('GET', '/api/chats/:id', ({ u, p }) => chatFull(myChat(u, p.id)));
on('PATCH', '/api/chats/:id', ({ u, p, body }) => {
  const c = myChat(u, p.id);
  if (body.title !== undefined) c.title = String(body.title).trim().slice(0, 120) || c.title;
  if (body.pinned !== undefined) c.pinned = !!body.pinned;
  if (body.shared !== undefined) { c.shared = !!body.shared; audit(u, c.shared ? 'Shared a chat' : 'Stopped sharing a chat'); }
  if (body.model && db.app.config.models.includes(body.model)) c.model = body.model;
  if (['quick', 'balanced', 'thorough'].includes(body.effort)) c.effort = body.effort;
  if (Array.isArray(body.plugins)) c.plugins = body.plugins.map(String);
  if (Array.isArray(body.connectors)) c.connectors = body.connectors.map(String);
  if (body.sources !== undefined) c.sources = body.sources === 'all' || body.sources === 'none' ? body.sources : (Array.isArray(body.sources) ? body.sources.map(String) : c.sources);
  save(); return chatFull(c);
});
on('GET', '/api/shared/:id', ({ u, p }) => {
  needGpt(u);
  const c = db.chats.find(x => x.id === p.id && x.shared);
  if (!c) throw err(404, 'This chat is not shared, or no longer exists.');
  return { id: c.id, title: c.title, mine: c.userId === u.id, ownerName: (db.users.find(x => x.id === c.userId) || { name: 'Removed user' }).name, messages: c.messages.map(m => ({ id: m.id, role: m.role, content: m.content, at: m.at, citations: m.citations || [], mode: m.mode, notice: m.notice, model: m.model, pii: m.pii, piiMode: m.piiMode })) };
});
on('DELETE', '/api/chats/:id', ({ u, p }) => { const c = myChat(u, p.id); db.chats = db.chats.filter(x => x.id !== c.id); db.documents = db.documents.filter(d => d.collectionId !== 'chat:' + c.id); audit(u, 'Deleted a chat'); return { ok: true }; });
on('POST', '/api/chats/:id/files', ({ u, p, body }) => { needGpt(u); const c = myChat(u, p.id); if (!db.app.config.safety.uploads) throw err(403, 'Your admin has turned off file uploads in chat.'); const d = addDocument(u, 'chat:' + c.id, body); c.updatedAt = now(); audit(u, 'Attached a file in chat', d.name); return docView(d); });
on('GET', '/api/chats/:id/export', ({ u, p }) => {
  const c = myChat(u, p.id); audit(u, 'Exported a chat');
  return { name: c.title.replace(/[^\w\- ]+/g, '').trim().slice(0, 60) || 'chat', markdown: `# ${c.title}\n\n` + c.messages.map(m => `**${m.role === 'user' ? u.name : 'VanikGPT'}** · ${m.at.slice(0, 16).replace('T', ' ')}\n\n${m.content}` + ((m.citations || []).length ? '\n\nSources:\n' + m.citations.map(x => `- [${x.n}] ${x.docName}${x.page ? ', page ' + x.page : ''}`).join('\n') : '')).join('\n\n---\n\n') + '\n' };
});
on('POST', '/api/chats/:id/messages/:mid/feedback', ({ u, p, body }) => {
  const c = myChat(u, p.id), m = byId(c.messages, p.mid, 'Message');
  m.feedback = body.value === 'up' || body.value === 'down' ? body.value : null;
  db.feedback = db.feedback.filter(f => f.messageId !== m.id);
  if (m.feedback === 'down') db.feedback.unshift({ messageId: m.id, at: now(), userName: u.name, reason: String(body.reason || 'Other').slice(0, 40), note: String(body.note || '').trim().slice(0, 500) });
  if (m.feedback === 'down') FX.emit('answer.not_helpful', { reason: String(body.reason || 'Other'), hasNote: !!String(body.note || '').trim(), model: m.model });
  save(); return { ok: true };
});
on('GET', '/api/search/chats', ({ u, q }) => {
  const s = String(q.get('q') || '').toLowerCase().trim();
  if (!s) return [];
  return db.chats.filter(c => c.userId === u.id).map(c => { const m = c.title.toLowerCase().includes(s) ? null : c.messages.find(x => x.content.toLowerCase().includes(s)); return (m || c.title.toLowerCase().includes(s)) ? { ...chatRow(c), match: m ? m.content.slice(Math.max(0, m.content.toLowerCase().indexOf(s) - 30), m.content.toLowerCase().indexOf(s) + 70) : '' } : null; }).filter(Boolean).slice(0, 30);
});

// One answer. Emits: meta, activity* (plugin steps), delta*, done. Used by the chat routes and by the AG-UI stream.
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const estTok = s => Math.ceil(String(s || '').length / 4);
// Working memory: older turns are folded into a short summary so long chats stay inside the model's context.
const summarize = msgs => msgs.filter(m => m.content).map(m => (m.role === 'user' ? 'Asked: ' : 'Answered: ') + m.content.replace(/\s+/g, ' ').slice(0, m.role === 'user' ? 140 : 200)).join('\n').slice(-1600);
// Effort: how many passages, how much history and how long an answer.
const EFFORT = { quick: { k: 3, hist: 6, sent: 2, out: 0.5 }, balanced: { k: 5, hist: 10, sent: 4, out: 1 }, thorough: { k: 8, hist: 16, sent: 6, out: 1.5 } };
async function answer(u, c, body, send, ctl, script) {
  needGpt(u);
  const cfg = db.app.config, t0 = Date.now();
  let userMsg, resume = null, refused = false, typed = null;
  if (body.resume) {
    const pend = c.pending;
    if (!pend) throw err(409, 'Nothing is waiting for a go-ahead in this chat.');
    c.pending = null;
    const held = c.messages[c.messages.length - 1]; if (held && held.role === 'assistant' && body.allow) body.before = (held.activity || []).filter(a => a.state === 'done');
    while (c.messages.length && c.messages[c.messages.length - 1].role === 'assistant') c.messages.pop();
    userMsg = c.messages[c.messages.length - 1];
    if (body.allow) { resume = { ...pend, code: String(body.code || '').trim().slice(0, 12) }; audit(u, 'Allowed an agent step', pend.reason); } else { refused = true; AG.endSession(c.id); audit(u, 'Refused an agent step', pend.reason); }
  } else if (body.regenerate) {
    while (c.messages.length && c.messages[c.messages.length - 1].role === 'assistant') c.messages.pop();
    userMsg = c.messages[c.messages.length - 1];
    if (!userMsg) throw err(400, 'Nothing to answer again.');
  } else {
    const raw = String(body.content || '').trim();
    if (!raw) throw err(400, 'Type a question first.');
    if (cfg.safety.dailyLimit) {
      const day = now().slice(0, 10), n = db.chats.reduce((a, x) => a + (x.userId === u.id ? x.messages.filter(m => m.role === 'user' && m.at.slice(0, 10) === day).length : 0), 0);
      if (n >= cfg.safety.dailyLimit) throw err(429, `You have reached today's limit of ${cfg.safety.dailyLimit} questions. It resets at midnight.`);
    }
    if (body.editOf) {
      const i = c.messages.findIndex(m => m.id === body.editOf && m.role === 'user');
      if (i < 0) throw err(404, 'That message is no longer in this chat.');
      c.messages.length = i; if (!i) c.title = 'New chat';
    }
    const pii = cfg.safety.pii === 'off' ? { text: raw, found: [] } : scanPii(raw, cfg.safety.pii === 'mask');
    userMsg = { id: uid('m'), role: 'user', content: pii.text, at: now(), pii: pii.found, piiMode: pii.found.length ? cfg.safety.pii : null };
    typed = raw; c.messages.push(userMsg); c.pending = null;
    if (c.title === 'New chat') c.title = pii.text.replace(/^\/\w+\s*/, '').replace(/\s+/g, ' ').slice(0, 52) + (pii.text.length > 52 ? '…' : '');
  }
  const as = c.assistantId && db.assistants.find(a => a.id === c.assistantId);
  const effort = EFFORT[c.effort] ? c.effort : 'balanced', eff = EFFORT[effort];
  const model = cfg.models.includes(c.model) ? c.model : cfg.defaultModel, mObj = db.models.find(m => m.id === model), serving = !!mObj && mObj.status === 'serving';
  const msg = { id: uid('m'), role: 'assistant', content: '', at: now(), citations: [], mode: 'model', model, notice: null, feedback: null, effort, activity: body.before || [] };
  const act = row => { const i = msg.activity.findIndex(x => x.id === row.id); if (i < 0) msg.activity.push(row); else msg.activity[i] = row; send('activity', row); };
  const finish = usageOut => {
    msg.stopped = ctl.closed(); msg.ms = Date.now() - t0;
    msg.tokensIn = usageOut ? usageOut.prompt_tokens : (msg.budget ? msg.budget.system + msg.budget.passages + msg.budget.history : 0) + estTok(userMsg.content);
    msg.tokensOut = usageOut ? usageOut.completion_tokens : estTok(msg.content);
    const shots = msg.activity.filter(a => a.shot); shots.slice(0, -1).forEach(a => { if (!a.shot.startsWith('data:image/svg')) delete a.shot; }); // real screenshots are large: keep only the last one on disk
    if (!msg.activity.length) delete msg.activity;
    if (msg.content || !ctl.closed()) c.messages.push(msg);
    c.updatedAt = now(); u.lastActiveAt = now(); save();
    send('done', { message: msg });
  };
  send('meta', { userMessage: userMsg, title: c.title, id: msg.id, citations: [], model });
  if (refused) { msg.mode = 'tool'; msg.model = null; msg.content = 'Stopped. That step was not taken and the browser was closed.'; return finish(); }

  const topic = resume ? null : (cfg.safety.blockedTopics || []).find(t => new RegExp('(^|[^\\p{L}\\p{N}])' + escRe(t) + '($|[^\\p{L}\\p{N}])', 'iu').test(userMsg.content));
  if (topic) { msg.mode = 'blocked'; msg.notice = 'blocked_topic'; msg.model = null; audit(u, 'Blocked a question', topic, 'Matches a blocked topic'); return finish(); }

  const py = (typed || userMsg.content).match(/^\/py\s+([\s\S]+)/i);
  if (py && !resume) { msg.mode = 'tool'; msg.model = null; msg.content = '```python\n' + py[1].trim() + '\n```'; act({ id: uid('act'), kind: 'tool', tool: 'code', label: 'Python', state: 'done', result: 'Press Run. It runs in your browser, not on the appliance.' }); send('delta', { t: msg.content }); return finish(); }
  // Plugins first: exact tools and the sandboxed browser.
  const on = (cfg.tools.enabled || []).filter(t => (as ? (as.tools || []).includes(t) : !Array.isArray(c.plugins) || c.plugins.includes(t))).filter(t => allowed(db.pluginAccess[t], u));
  // Plugins work on the text as typed, on the device. In mask mode the IDs are shortened in everything that is stored or sent on.
  const shorten = cfg.safety.pii === 'mask' ? t => PII.reduce((x, [, re, check]) => x.replace(re, m => (check && !check(m)) || m.length < 8 || /^https?:/.test(m) ? m : m.slice(0, 2) + '…' + m.slice(-3)), String(t)) : null;
  const T = await AG.runTools(c, typed || userMsg.content, on, null, act, resume, shorten);
  if (T.ask) { msg.mode = 'tool'; msg.model = null; msg.ask = T.ask; msg.content = T.ask.question; send('delta', { t: msg.content }); return finish(); }
  if (T.interrupt) { c.pending = T.interrupt; msg.mode = 'tool'; msg.model = null; msg.interrupt = { id: T.interrupt.id, reason: T.interrupt.reason, detail: T.interrupt.detail, kind: T.interrupt.kind || 'step' }; audit(u, 'Agent asked for a go-ahead', T.interrupt.reason); return finish(); }
  if (T.stopped) { msg.toolError = T.stopped; if (T.blockedHost) msg.blockedHost = T.blockedHost; }
  const usedTools = T.context.length > 0 || T.direct.length > 0 || !!T.stopped;

  const question = userMsg.content.replace(/^\/\w+\s*/, '');
  const src = as ? as.collections : c.sources;
  const cols = src === 'none' ? [] : gptCollections(u).filter(x => src === 'all' || src.includes(x.id)).map(x => x.id);
  const docs = db.documents.filter(d => (cols.includes(d.collectionId) || d.collectionId === 'chat:' + c.id) && usableDoc(u, d));
  const cmd = ((userMsg.content.match(/^\/(search|summari[sz]e)\b/i) || [])[1] || '').toLowerCase().replace('z', 's');
  let hits = usedTools || cmd === 'summarise' ? [] : await search(question, docs, cmd === 'search' ? 8 : eff.k);
  if (cmd === 'search') { // passages only, no answer written
    msg.mode = 'search'; msg.model = null;
    msg.citations = hits.map(h => ({ n: h.n, docId: h.docId, docName: h.docName, collectionId: h.collectionId, page: h.page, chunkId: h.chunkId, snippet: h.text.slice(0, 240), via: h.via, strength: 'Good' }));
    msg.content = hits.length ? hits.map(h => `**[${h.n}] ${h.docName}${h.page ? ', page ' + h.page : ''}**\n${h.text.replace(/\s+/g, ' ').slice(0, 420)}${h.text.length > 420 ? '…' : ''}`).join('\n\n') : 'Nothing in your documents matches that.';
    send('delta', { t: msg.content }); return finish();
  }
  let sumText = '';
  if (cmd === 'summarise') { // works on the files attached to this chat
    const files = db.documents.filter(d => d.collectionId === 'chat:' + c.id);
    if (!files.length) { msg.mode = 'tool'; msg.model = null; msg.content = 'Attach a file to this chat first, then ask for a summary.'; send('delta', { t: msg.content }); return finish(); }
    sumText = files.map(d => `File: ${d.name}\n` + d.chunks.map(k => k.text).join('\n')).join('\n\n').slice(0, 60000);
    msg.citations = files.slice(0, 8).map((d, i) => ({ n: i + 1, docId: d.id, docName: d.name, collectionId: d.collectionId, page: null, chunkId: d.chunks[0].id, snippet: d.chunks[0].text.slice(0, 240), via: 'keyword', strength: 'Strong' }));
  }
  // Token budget for the model's context: 15% instructions, 50% passages, 25% history, 10% answer.
  const ctxTok = Math.min((mObj && mObj.context) || 8192, 32768), cap = { passages: ctxTok * 0.5, history: ctxTok * 0.25, output: Math.round(ctxTok * 0.1 * eff.out) };
  let used = 0; hits = hits.filter(h => (used += estTok(h.text)) <= cap.passages || h.n === 1);
  const prior = c.messages.slice(0, c.messages.indexOf(userMsg)).filter(m => m.content), older = prior.slice(0, -eff.hist);
  if (older.length) c.summary = summarize(older);
  let recent = prior.slice(-eff.hist);
  while (recent.length && recent.reduce((a, m) => a + estTok(m.content), 0) > cap.history) recent = recent.slice(1);
  const top = hits.length ? hits[0] : null;
  const strength = h => { const r = h.via === top.via && top.score ? h.score / top.score : 0.6; return r >= 0.8 ? 'Strong' : r >= 0.45 ? 'Good' : 'Weak'; };
  msg.citations = hits.map(h => ({ n: h.n, docId: h.docId, docName: h.docName, collectionId: h.collectionId, page: h.page, chunkId: h.chunkId, snippet: h.text.slice(0, 240), via: h.via, strength: strength(h) }));
  const mem = MO.memoryFor(u); if (mem.length) msg.memories = mem.length; if (cfg.instructions) msg.rules = true;
  const sysBase = 'You are VanikGPT, a private assistant running on the company\'s own Vanik Appliance. Be direct and accurate. If you are not sure, say so.'
    + (cfg.instructions ? '\n\nHouse rules from the admin, which always apply:\n' + cfg.instructions : '') + (mem.length ? '\n\nWhat this person asked you to remember:\n- ' + mem.join('\n- ') : '')
    + (as ? '\n\n' + as.instructions : '') + (older.length ? '\n\nEarlier in this chat:\n' + c.summary : '');
  const passText = (hits.length ? '\n\nAnswer from the sources below and cite them inline like [1]. If the sources do not contain the answer, say that plainly.\n\nSources:\n' + hits.map(h => `[${h.n}] ${h.docName}${h.page ? ' (page ' + h.page + ')' : ''}\n${h.text}`).join('\n\n') : '')
    + (sumText ? '\n\nSummarise the text below in at most seven plain bullets. Keep numbers, dates and names exact.\n\n' + sumText.slice(0, cap.passages * 4) : '')
    + (T.context.length ? '\n\nResults from tools, which are exact. Use them as they are and do not redo them:\n' + T.context.join('\n\n').slice(0, cap.passages * 4) : '');
  msg.budget = { context: ctxTok, system: estTok(sysBase), passages: estTok(passText), history: recent.reduce((a, m) => a + estTok(m.content), 0), output: cap.output, summarized: older.length };

  let usageOut = null;
  if (script) msg.content = script.replace(/ ?\[\[(.+?)\]\]/g, (_, d) => { const h = hits.find(x => x.docName === d); return h ? ` [${h.n}]` : ''; }); // sample workspace: the written answer is given, the passages and tools are real
  else if (GW.url && serving && !(T.stopped && !T.context.length)) {
    try { usageOut = await streamModel(model, [{ role: 'system', content: sysBase + passText }, ...recent.map(m => ({ role: m.role, content: m.content })), { role: 'user', content: question }], t => { msg.content += t; send('delta', { t }); }, ctl.signal, { max: cap.output }); GW.ok = true; }
    catch (e) { if (!ctl.closed()) { GW.ok = false; GW.checkedAt = now(); msg.content = ''; msg.notice = 'model_unreachable'; } }
  } else if (!usedTools) msg.notice = serving ? 'model_unreachable' : 'model_parked';

  if (!ctl.closed() && !msg.content) {
    let text = '';
    if (usedTools) { msg.mode = 'tool'; msg.notice = null; msg.model = null; text = T.direct.join('\n\n'); }
    else if (sumText) { msg.mode = 'documents'; text = central(sumText, eff.sent + 2); }
    else { msg.mode = hits.length ? 'documents' : 'unavailable'; if (hits.length) text = passageAnswer(question, hits, eff.sent); }
    for (const part of text.match(/\S+\s*/g) || []) { if (ctl.closed()) break; msg.content += part; send('delta', { t: part }); if (!usedTools) await new Promise(r => setTimeout(r, 12)); }
  }
  finish(usageOut);
}
// The most central sentences of a text, in their original order. Used for summaries when no model can be reached.
function central(text, n) {
  const sents = (text.match(/(?:[^.!?\n]|\.(?=\d))+[.!?]+/g) || [text]).map(x => x.trim()).filter(x => x.length > 25 && !/^File: /.test(x)), freq = {};
  tok(text).forEach(w => { freq[w] = (freq[w] || 0) + 1; });
  return sents.map((x, i) => ({ x, i, sc: tok(x).reduce((a, w) => a + freq[w], 0) / Math.sqrt(x.length) })).sort((a, b) => b.sc - a.sc).slice(0, n).sort((a, b) => a.i - b.i).map(t => '- ' + t.x).join('\n') || text.slice(0, 600);
}
// Stream wrapper: headers go out with the first event, so a refused request still gets a plain JSON error.
const streamRoute = run => async ({ u, p, body, res }) => {
  const c = myChat(u, p.id), ac = new AbortController(); let started = false, closed = false;
  const send = (ev, data) => { if (!started) { res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' }); started = true; } if (!res.writableEnded) res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`); };
  res.on('close', () => { if (!res.writableEnded) { closed = true; ac.abort(); } });
  await run(u, c, body, send, { signal: ac.signal, closed: () => closed });
  if (started) res.end();
};
on('POST', '/api/chats/:id/messages', streamRoute(answer));
on('POST', '/api/chats/:id/resume', streamRoute((u, c, body, send, ctl) => answer(u, c, { resume: true, allow: !!body.allow, code: body.code }, send, ctl)));

// What the browser plugin keeps from a page: the passages that match the question, or the top of the page.
function readPage(question, snap) {
  const chunks = chunkPages([snap.text]), hits = question ? retrieve(question, [{ id: 'page', name: snap.title, collectionId: 'web', paged: false, chunks }], 4) : [];
  if (hits.length) return { text: passageAnswer(question, hits, 5).replace(/ \[\d\]/g, ''), summary: `${hits.length} matching ${hits.length === 1 ? 'part' : 'parts'} of the page` };
  return { text: snap.text.slice(0, 1400).trim() + (snap.text.length > 1400 ? '…' : ''), summary: question ? 'Nothing on the page matches; kept the top of the page' : `Read ${snap.text.length.toLocaleString()} characters` };
}

Object.assign(FX, require('./features')({ DEMO, db, on, err, uid, now, audit, save, isAdmin, GW, A, byId, needGpt, SYSTEM, addDocument, verhoeff, commandViews, probes, search, allowed, estTok, streamModel, passageAnswer }));
Object.assign(AG, require('./agent')({ allowed, DEMO, db, on, err, uid, now, audit, save, isAdmin, GW, A, byId, needGpt, verhoeff, answer, streamModel, readPage, chatTables: c => db.documents.filter(d => d.collectionId === 'chat:' + c.id && d.table).map(d => ({ name: d.name, table: d.table })) }));
Object.assign(WK, require('./work')({ db, on, err, uid, now, audit, isAdmin, A, byId, needGpt, allowed, cleanAccess, addDocument, canReadDoc, plugins: () => AG.PLUGINS }));
Object.assign(MO, require('./more')({ db, on, err, uid, now, audit, isAdmin, A, byId, needGpt, save, call: (...a) => call(...a), ask: (u, c, body) => answer(u, c, body, () => {}, quiet) }));

// The sample workspace is built through the same routes a person uses, once, when the server starts with --demo.
const call = async (u, m, p, body) => { let match; const r = routes.find(x => x.m === m && (match = p.match(x.re))); if (!r) throw err(404, 'Not found: ' + p); return r.fn({ u, body: body || {}, p: match.groups || {}, q: new URLSearchParams(), req: { headers: {} }, res: { headersSent: false, setHeader() {}, writeHead() {}, end() {} } }); };
const quiet = { signal: new AbortController().signal, closed: () => false };
let ready = Promise.resolve();
if (DEMO && !db.sample) ready = require('./sample').seed({ db, call, audit, uid, ask: (u, c, body, script) => answer(u, c, body, () => {}, quiet, script), attach: (u, c, b) => addDocument(u, 'chat:' + c.id, b),
  fastDeploy: () => { const d = db.app.deploys[0]; if (d && !d.result) { d.t0 = new Date(Date.now() - 120000).toISOString(); tick(); } } }).then(save, e => { console.error('Sample workspace:', e); });

// ---------- http
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon' };
function serveStatic(req, res, pathname) {
  let f = path.normalize(path.join(PUB, pathname === '/' ? 'index.html' : pathname));
  if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(PUB, 'index.html');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(f).pipe(res);
}
const readBody = req => new Promise((ok, no) => { const parts = []; let n = 0; req.on('data', d => { n += d.length; if (n > 40e6) { no(err(413, 'That file is too large for this build (40 MB of text).')); req.destroy(); } else parts.push(d); }); req.on('end', () => { try { ok(parts.length ? JSON.parse(Buffer.concat(parts).toString('utf8')) : {}); } catch { no(err(400, 'Bad request body.')); } }); req.on('error', no); });

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (!url.pathname.startsWith('/api/') && !url.pathname.startsWith('/gateway/')) return serveStatic(req, res, decodeURIComponent(url.pathname));
  try {
    await ready;
    let match, route;
    for (const r of routes) if (r.m === req.method && (match = url.pathname.match(r.re))) { route = r; break; }
    if (!route) throw err(404, 'Not found');
    const u = db.users.find(x => x.id === req.headers['x-user']);
    if (!route.open && !u) throw err(401, 'Sign in first.');
    if (route.admin && !isAdmin(u)) throw err(403, 'Only owners and admins can do this.');
    const body = req.method === 'GET' ? {} : await readBody(req);
    const out = await route.fn({ u, body, p: match.groups || {}, q: url.searchParams, req, res });
    if (res.headersSent) return;
    save();
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(out === undefined ? { ok: true } : out));
  } catch (e) {
    if (res.headersSent) return res.end();
    if (!e.status) console.error(e);
    res.writeHead(e.status || 500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: e.status ? e.message : 'Something went wrong on the server.', ...(e.extra || {}) }));
  }
}).listen(PORT, '127.0.0.1', () => { console.log(`VanikGPT prototype on http://127.0.0.1:${PORT}  gateway: ${GW.url || 'not set (answers come from documents only)'}`); checkGateway(); });
