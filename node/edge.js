'use strict';
// Running the appliance: how it is reached, who is in the directory, what fills the disk, how it has behaved over time,
// updates, power, and time-limited help from the vendor. Also models from outside the network, switched on one by one,
// and a person's own API keys. Ideas taken from a review of Locai One (Oct 2026). Loaded by server.js.
module.exports = function install(ctx) {
  const { db, on, err, uid, now, audit, isAdmin, A, byId, needGpt, save } = ctx;
  const E = db.edge = db.edge || {};
  E.network = E.network || { link: 'Ethernet', local: 'vanik-' + (db.device.id || 'dev').replace(/[^a-z0-9]/gi, '') + '.local', publicOn: false, domain: '', ca: Array.from({ length: 32 }, (_, i) => ((i * 37 + 11) % 256).toString(16).padStart(2, '0')).join('') };
  E.updates = E.updates || { version: db.device.agent, previous: [db.device.agent.replace(/(\d+)$/, n => Math.max(0, n - 1))], checkedAt: null, latest: db.device.agent };
  E.support = E.support || []; E.outside = E.outside || {}; E.directory = E.directory || null;
  E.limits = E.limits || { calls: 10 }; E.retention = E.retention || { logsDays: 30 };
  if (E.userKeys === undefined) E.userKeys = false; if (E.outsideDocs === undefined) E.outsideDocs = false;

  // ---------- models outside the network. A key stays on the appliance and is never returned.
  const PROVIDERS = {
    openrouter: { name: 'OpenRouter', base: 'https://openrouter.ai/api/v1', models: [['anthropic/claude-opus-5.5', ['Images', 'PDFs']], ['openai/gpt-6-astra', ['Images', 'PDFs']], ['deepseek/deepseek-v4-flash', ['Text only']], ['qwen/qwen3.7-flash', ['Images', 'Video']]] },
    openai: { name: 'OpenAI', base: 'https://api.openai.com/v1', models: [['gpt-6-astra', ['Images', 'PDFs']]] },
    anthropic: { name: 'Anthropic', base: '', models: [['claude-opus-5-5', ['Images', 'PDFs']], ['claude-sonnet-5-5', ['Images', 'PDFs']]] },
    google: { name: 'Google', base: '', models: [['gemini-3-pro', ['Images', 'Video', 'Audio']]] },
    azure: { name: 'Azure OpenAI', base: '', models: [] },
    custom: { name: 'Custom', base: '', models: [] },
  };
  const provView = id => { const p = PROVIDERS[id], s = E.outside[id] || {}; return { id, name: p.name, connected: !!s.key, last4: s.key ? s.key.slice(-4) : '', base: s.base || p.base, catalog: p.models.map(m => ({ id: m[0], tags: m[1] })), models: (s.models || []) }; };
  const outsideOn = () => Object.keys(PROVIDERS).flatMap(id => ((E.outside[id] || {}).key ? (E.outside[id].models || []) : []).map(m => ({ id: `out:${id}/${m.id}`, name: m.id, provider: PROVIDERS[id].name, tags: m.tags })));
  on('PUT', '/api/edge/outside/:id', ({ u, p, body }) => {
    if (!PROVIDERS[p.id]) throw err(404, 'Unknown provider'); const s = E.outside[p.id] = E.outside[p.id] || { models: [] };
    if (body.remove) { delete E.outside[p.id]; audit(u, 'Removed an outside model provider', PROVIDERS[p.id].name); return view(); }
    const key = String(body.key || '').trim(); if (key) { if (key.length < 6) throw err(400, 'That key looks too short.'); s.key = key; audit(u, 'Connected an outside model provider', PROVIDERS[p.id].name, 'Requests to it leave the appliance'); }
    if (body.base !== undefined) s.base = /^https:\/\//.test(body.base) ? String(body.base).replace(/\/+$/, '').slice(0, 200) : '';
    return view();
  }, A);
  on('POST', '/api/edge/outside/:id/models', ({ u, p, body }) => {
    const s = E.outside[p.id]; if (!s || !s.key) throw err(400, 'Add the key first.');
    const id = String(body.id || '').trim().slice(0, 80); if (!/^[\w.:\/-]{2,80}$/.test(id)) throw err(400, 'Enter the model id as the provider writes it.');
    s.models = (s.models || []).filter(m => m.id !== id);
    if (body.on !== false) { s.models.push({ id, tags: (PROVIDERS[p.id].models.find(m => m[0] === id) || [0, ['Text only']])[1] }); audit(u, 'Turned on an outside model', id, PROVIDERS[p.id].name); } else audit(u, 'Turned off an outside model', id, PROVIDERS[p.id].name);
    return view();
  }, A);
  // Asks an outside model. Sample keys get a stand-in reply; real keys work for providers that speak the OpenAI format.
  async function askOutside(modelId, messages, onDelta, signal) {
    const [, pid, name] = modelId.match(/^out:([a-z]+)\/(.+)$/) || [], s = E.outside[pid];
    if (!s || !s.key || !(s.models || []).some(m => m.id === name)) throw new Error('That outside model is turned off.');
    if (s.key.startsWith('sample')) { const t = `Sample reply. In this build no request is sent to ${PROVIDERS[pid].name}; with a real key the answer from ${name} would appear here. Your question would leave the appliance. Your documents would not, unless an admin allows it.`; for (const w of t.match(/\S+\s*/g)) { onDelta(w); await new Promise(r => setTimeout(r, 14)); } return; }
    const base = s.base || PROVIDERS[pid].base; if (!base) throw new Error(`${PROVIDERS[pid].name} needs its own connector, which this build does not have.`);
    const r = await fetch(base + '/chat/completions', { method: 'POST', signal, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + s.key }, body: JSON.stringify({ model: name, messages }) });
    if (!r.ok) throw new Error(`${PROVIDERS[pid].name} answered ${r.status}.`);
    onDelta((((await r.json()).choices || [])[0] || { message: { content: '' } }).message.content || '');
  }

  // ---------- storage, hardware, history
  const gb = n => Math.round(n / 1e7) / 100;
  function storage() {
    const docs = db.documents.filter(d => !d.collectionId.startsWith('chat:')).reduce((a, d) => a + d.size, 0), chatFiles = db.documents.filter(d => d.collectionId.startsWith('chat:')).reduce((a, d) => a + d.size, 0);
    const models = db.models.filter(m => m.status !== 'available').reduce((a, m) => a + m.memGb * 0.6, 0), chats = JSON.stringify(db.chats).length, logs = JSON.stringify(db.audit).length + JSON.stringify(db.deliveries || []).length;
    const rows = [['System and apps', 'Vanik OS, installed apps and their databases', 29 + (db.app.status === 'not_installed' ? 0 : db.app.needsGb)], ['Model files', 'Models kept on this device', +models.toFixed(1)], ['Knowledge', 'Documents in collections', gb(docs)], ['Chats', 'Conversations and files attached to them', gb(chats + chatFiles)], ['Logs', `Audit log and delivery records. Kept ${E.retention.logsDays} days`, gb(logs)]];
    const used = rows.reduce((a, r) => a + r[2], 0), total = Math.round((db.device.diskTb || 3.6) * 1000);
    return { total, used: +used.toFixed(1), rows: rows.map(r => ({ name: r[0], what: r[1], gb: r[2] })) };
  }
  // Readings for the last 24 hours. This build has no sensors, so the shape is drawn from what the appliance is doing now.
  function history() {
    const serving = db.models.filter(m => m.status === 'serving').reduce((a, m) => a + m.memGb, 0), up = db.device.online, pts = 24, out = {}, wave = (base, amp, k) => Array.from({ length: pts }, (_, i) => up ? +(base + amp * Math.sin((i + k) / 3) + amp * 0.4 * Math.sin((i * 7 + k) / 5)).toFixed(1) : 0);
    out.gpuMemory = { unit: 'GB', max: db.device.memGb, points: wave(serving, 0.3, 1) }; out.gpuUse = { unit: '%', max: 100, points: wave(18, 14, 4).map(v => Math.max(0, v)) };
    out.gpuHeat = { unit: '°C', max: 90, points: wave(41, 5, 2) }; out.cpu = { unit: '%', max: 100, points: wave(9, 6, 7).map(v => Math.max(0, v)) }; out.memory = { unit: 'GB', max: 512, points: wave(74, 3, 5) };
    return out;
  }
  const view = () => ({ network: E.network, directory: E.directory, updates: E.updates, support: E.support.slice(0, 20).map(s => ({ ...s, status: s.status === 'open' && new Date(s.endsAt) < new Date() ? 'ended' : s.status })), outside: Object.keys(PROVIDERS).map(provView), outsideDocs: E.outsideDocs, userKeys: E.userKeys, limits: E.limits, retention: E.retention, storage: storage(), history: history(),
    about: { name: db.device.name, ip: db.device.ip, gpuMemory: db.device.memGb + ' GB', disk: (db.device.diskTb || 3.6) + ' TB', agent: db.device.agent, os: E.updates.version, slots: db.device.slots } });
  on('GET', '/api/edge', () => view(), A);
  on('PUT', '/api/edge/settings', ({ u, body }) => {
    if (body.outsideDocs !== undefined) { E.outsideDocs = !!body.outsideDocs; audit(u, E.outsideDocs ? 'Allowed documents to be sent to outside models' : 'Stopped documents going to outside models'); }
    if (body.userKeys !== undefined) { E.userKeys = !!body.userKeys; audit(u, E.userKeys ? 'Let people create their own API keys' : 'Stopped people creating API keys'); }
    if (body.calls !== undefined) E.limits.calls = Math.max(1, Math.min(50, +body.calls || 10));
    if (body.logsDays !== undefined) E.retention.logsDays = [7, 14, 30, 90, 365].includes(+body.logsDays) ? +body.logsDays : 30;
    return view();
  }, A);

  // ---------- network: a name for the office, and optionally a name on the internet
  on('PUT', '/api/edge/network', ({ u, body }) => {
    if (body.domain !== undefined) { const d = String(body.domain).trim().toLowerCase(); if (d && !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d)) throw err(400, 'Enter a name such as ai.yourcompany.com.'); E.network.domain = d; }
    if (body.publicOn !== undefined) { if (body.publicOn && !E.network.domain) throw err(400, 'Add the company domain first.'); E.network.publicOn = !!body.publicOn; audit(u, E.network.publicOn ? 'Opened the appliance to the internet' : 'Closed the appliance to the internet', E.network.domain); }
    return view();
  }, A);
  // ---------- directory: people come from the company directory. This build has no directory to call, so a sync marks who is already here.
  on('POST', '/api/edge/directory', ({ u, body }) => { const provider = ['Microsoft Entra ID', 'Google Workspace', 'Okta'].includes(body.provider) ? body.provider : 'Microsoft Entra ID'; E.directory = { provider, people: db.users.length, syncedAt: now(), by: u.name }; db.users.forEach(x => { if (x.role !== 'owner') x.fromDirectory = true; }); audit(u, 'Connected a directory', provider, db.users.length + ' people'); return view(); }, A);
  on('POST', '/api/edge/directory/sync', ({ u }) => { if (!E.directory) throw err(400, 'Connect a directory first.'); E.directory.people = db.users.length; E.directory.syncedAt = now(); audit(u, 'Synced the directory', E.directory.provider); return view(); }, A);
  on('DELETE', '/api/edge/directory', ({ u }) => { if (E.directory) audit(u, 'Disconnected the directory', E.directory.provider); E.directory = null; db.users.forEach(x => { delete x.fromDirectory; }); return view(); }, A);

  // ---------- updates and power
  on('POST', '/api/edge/updates/check', () => { E.updates.checkedAt = now(); return view(); }, A);
  on('POST', '/api/edge/updates/rollback', ({ u }) => { const prev = E.updates.previous[0]; if (!prev) throw err(400, 'There is no earlier version to go back to.'); E.updates.previous = [E.updates.version, ...E.updates.previous.slice(1)]; E.updates.version = prev; db.device.agent = prev; audit(u, 'Rolled Vanik OS back', 'to ' + prev); return view(); }, A);
  on('POST', '/api/edge/power', ({ u, body }) => {
    if (body.action === 'restart') { db.device.online = false; audit(u, 'Restarted the appliance'); setTimeout(() => { db.device.online = true; save(); }, 6000).unref(); return { ok: true, back: 6 }; }
    if (body.action === 'shutdown') { db.device.online = false; audit(u, 'Shut the appliance down'); return { ok: true }; }
    if (body.action === 'reset') { if (body.confirm !== 'ERASE') throw err(400, 'Type ERASE to confirm.'); audit(u, 'Asked for a factory reset', '', 'Not carried out in this build'); return { ok: true, skipped: true }; }
    throw err(400, 'Unknown action.');
  }, A);

  // ---------- help from the vendor: the customer opens the door, for a set time, with a reason
  on('POST', '/api/edge/support', ({ u, body }) => { const minutes = [30, 60, 120, 240].includes(+body.minutes) ? +body.minutes : 30, reason = String(body.reason || '').trim().slice(0, 200); if (reason.length < 5) throw err(400, 'Say why access is needed.'); const s = { id: uid('sup'), by: u.name, reason, minutes, engineer: String(body.engineer || 'Vanik support').slice(0, 80), openedAt: now(), endsAt: new Date(Date.now() + minutes * 60000).toISOString(), status: 'open' }; E.support.unshift(s); audit(u, 'Opened a support session', s.engineer, `${minutes} minutes: ${reason}`); return view(); }, A);
  on('POST', '/api/edge/support/:id/end', ({ u, p }) => { const s = byId(E.support, p.id, 'Session'); if (s.status === 'open') { s.status = 'ended'; s.endedAt = now(); audit(u, 'Ended a support session', s.engineer); } return view(); }, A);
  on('GET', '/api/edge/diagnostics', ({ u }) => { audit(u, 'Downloaded a diagnostics report'); return { at: now(), device: { name: db.device.name, online: db.device.online, agent: db.device.agent }, os: E.updates.version, models: db.models.map(m => ({ id: m.id, status: m.status })), app: { status: db.app.status, deployed: db.app.deployedVersion }, checks: ctx.probes(), storage: storage(), counts: { people: db.users.length, collections: db.collections.length, documents: db.documents.length, chats: db.chats.length } }; }, A);

  // ---------- a person's own API keys, when the admin allows it
  const mineKeys = u => db.keys.filter(k => k.userId === u.id).map(k => ({ id: k.id, name: k.name, last4: k.last4, createdAt: k.createdAt, lastUsedAt: k.lastUsedAt, revokedAt: k.revokedAt || null, requests: k.requests || 0, tokens: k.tokens || 0 }));
  on('GET', '/api/my/api', ({ u }) => { needGpt(u); return { allowed: E.userKeys || isAdmin(u), keys: mineKeys(u), models: db.models.filter(m => m.status === 'serving').map(m => m.id) }; });
  on('POST', '/api/my/api/keys', ({ u, body }) => { needGpt(u); if (!(E.userKeys || isAdmin(u))) throw err(403, 'Your admin has not turned on personal API keys.'); const name = String(body.name || '').trim().slice(0, 40); if (!name) throw err(400, 'Give the key a name.'); if (mineKeys(u).filter(k => !k.revokedAt).length >= 5) throw err(400, 'That is five keys already. Revoke one first.'); const { k, raw } = ctx.issueKey(name, u.name); k.userId = u.id; k.knowledge = 'none'; audit(u, 'Created a personal API key', name); return { key: raw, keys: mineKeys(u) }; });
  on('DELETE', '/api/my/api/keys/:id', ({ u, p }) => { const k = db.keys.find(x => x.id === p.id && x.userId === u.id); if (!k) throw err(404, 'Key not found'); k.revokedAt = k.revokedAt || now(); audit(u, 'Revoked a personal API key', k.name); return { keys: mineKeys(u) }; });

  return { outsideOn, askOutside, sendsDocs: () => E.outsideDocs, callLimit: () => E.limits.calls, isOutside: id => outsideOn().some(m => m.id === id) };
};
