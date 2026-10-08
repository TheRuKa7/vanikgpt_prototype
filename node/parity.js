'use strict';
// Everything the live VanikGPT has that the prototype must also have, so the prototype reads as the next version of it:
// the admin settings (16 tabs) and personal settings (11 tabs), default permissions, groups, functions, tools,
// calendar events, evaluations, archived chats and the admin exports. The list of settings comes from the audit of
// the live build (public/prod_schema.json). Loaded by server.js.
const fs = require('fs'), path = require('path');
module.exports = function install(ctx) {
  const { db, on, err, uid, now, audit, isAdmin, A, byId, needGpt } = ctx;
  db.prod = db.prod || { admin: {}, permissions: {}, functions: [], tools: [], events: [] };
  for (const k of ['functions', 'tools', 'events']) db.prod[k] = db.prod[k] || [];
  const clean = v => { const o = {}; for (const [k, x] of Object.entries(v || {}).slice(0, 200)) if (/^[a-z0-9_]{1,48}$/.test(k)) o[k] = typeof x === 'boolean' || typeof x === 'number' ? x : String(x).slice(0, 4000); return o; };

  // Settings that change how the prototype behaves. The rest are kept and shown, ready for the real build.
  const WIRED = { rating: ['General', 'message_rating'], folders: ['General', 'folders'], memories: ['General', 'memories'], notes: ['General', 'notes'], calendar: ['General', 'calendar'], automations: ['General', 'automations'], followUps: ['Interface', 'follow_up_generation'], code: ['Code Execution', 'enable_code_execution'] };
  const flags = () => Object.fromEntries(Object.entries(WIRED).map(([f, [tab, key]]) => [f, (db.prod.admin[tab] || {})[key] !== false]));

  // ---------- settings
  on('GET', '/api/parity', ({ u }) => {
    needGpt(u); const admin = isAdmin(u);
    return { flags: flags(), wired: WIRED, me: u.settings || {}, admin: admin ? db.prod.admin : {}, permissions: admin ? db.prod.permissions : {}, groups: admin ? groups() : [], functions: admin ? db.prod.functions : [], tools: db.prod.tools.filter(t => admin || t.userId === u.id || t.shared), events: db.prod.events.filter(e => e.userId === u.id), archived: db.chats.filter(c => c.userId === u.id && c.archived).map(c => ({ id: c.id, title: c.title, updatedAt: c.updatedAt })), mine: stats(u) };
  });
  on('PUT', '/api/parity/admin/:tab', ({ u, p, body }) => { const tab = decodeURIComponent(p.tab).slice(0, 40); db.prod.admin[tab] = { ...(db.prod.admin[tab] || {}), ...clean(body.values) }; audit(u, 'Changed VanikGPT settings', tab, Object.keys(clean(body.values)).length + ' settings'); return { ok: true, flags: flags() }; }, A);
  on('PUT', '/api/parity/me/:tab', ({ u, p, body }) => { needGpt(u); const tab = decodeURIComponent(p.tab).slice(0, 40); u.settings = u.settings || {}; u.settings[tab] = { ...(u.settings[tab] || {}), ...clean(body.values) }; return { ok: true }; });
  on('PUT', '/api/parity/permissions', ({ u, body }) => { db.prod.permissions = clean(body.values); audit(u, 'Changed default permissions', 'People who are not admins'); return { ok: true }; }, A);

  // ---------- groups: the teams people already belong to
  const groups = () => [...new Set(db.users.flatMap(x => x.teams || []))].sort().map(name => ({ name, members: db.users.filter(x => (x.teams || []).includes(name)).map(x => ({ id: x.id, name: x.name })) }));
  on('POST', '/api/parity/groups', ({ u, body }) => { const name = String(body.name || '').trim().slice(0, 40); if (!name) throw err(400, 'Give the group a name.'); const ids = new Set(body.members || []); db.users.forEach(x => { const has = (x.teams || []).includes(name); if (ids.has(x.id) && !has) x.teams = [...(x.teams || []), name]; if (!ids.has(x.id) && has) x.teams = x.teams.filter(t => t !== name); }); audit(u, 'Saved a group', name, ids.size + ' members'); return groups(); }, A);
  on('DELETE', '/api/parity/groups/:name', ({ u, p }) => { const name = decodeURIComponent(p.name); db.users.forEach(x => { x.teams = (x.teams || []).filter(t => t !== name); }); audit(u, 'Removed a group', name); return groups(); }, A);

  // ---------- functions and tools: code an admin or a person adds. Kept and listed; this build does not run them.
  const code = (b, what) => { const name = String(b.name || '').trim().slice(0, 60); if (!name) throw err(400, `Give the ${what} a name.`); return { name, slug: String(b.slug || name).toLowerCase().replace(/[^a-z0-9_]+/g, '_').slice(0, 40), description: String(b.description || '').slice(0, 200), code: String(b.code || '').slice(0, 60000), active: b.active !== false }; };
  for (const [kind, what, opt] of [['functions', 'function', A], ['tools', 'tool', {}]]) {
    on('POST', `/api/parity/${kind}`, ({ u, body }) => { needGpt(u); const x = { id: uid(kind === 'tools' ? 'tl' : 'fn'), userId: u.id, byName: u.name, ...code(body, what), shared: kind === 'tools' && isAdmin(u) && !!body.shared, updatedAt: now() }; db.prod[kind].push(x); audit(u, `Added a ${what}`, x.name); return x; }, opt);
    on('PUT', `/api/parity/${kind}/:id`, ({ u, p, body }) => { const x = byId(db.prod[kind], p.id, what); if (!isAdmin(u) && x.userId !== u.id) throw err(404, 'Not found'); Object.assign(x, code(body, what), { updatedAt: now() }); if (kind === 'tools' && isAdmin(u)) x.shared = !!body.shared; return x; }, opt);
    on('DELETE', `/api/parity/${kind}/:id`, ({ u, p }) => { const x = byId(db.prod[kind], p.id, what); if (!isAdmin(u) && x.userId !== u.id) throw err(404, 'Not found'); db.prod[kind] = db.prod[kind].filter(y => y.id !== x.id); audit(u, `Removed a ${what}`, x.name); return { ok: true }; }, opt);
  }

  // ---------- calendar events
  const ev = b => { const title = String(b.title || '').trim().slice(0, 120); if (!title) throw err(400, 'Give the event a title.'); const d = v => /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(v || '') ? v : ''; const start = d(b.start); if (!start) throw err(400, 'Pick when it starts.'); return { title, calendar: b.calendar === 'Scheduled Tasks' ? 'Scheduled Tasks' : 'Personal', start, end: d(b.end), allDay: !!b.allDay, location: String(b.location || '').slice(0, 120), description: String(b.description || '').slice(0, 2000) }; };
  on('POST', '/api/parity/events', ({ u, body }) => { needGpt(u); const e = { id: uid('ev'), userId: u.id, ...ev(body) }; db.prod.events.push(e); return e; });
  on('PUT', '/api/parity/events/:id', ({ u, p, body }) => { const e = byId(db.prod.events, p.id, 'Event'); if (e.userId !== u.id) throw err(404, 'Event not found'); Object.assign(e, ev(body)); return e; });
  on('DELETE', '/api/parity/events/:id', ({ u, p }) => { const e = byId(db.prod.events, p.id, 'Event'); if (e.userId !== u.id) throw err(404, 'Event not found'); db.prod.events = db.prod.events.filter(x => x.id !== e.id); return { ok: true }; });

  // ---------- evaluations: a board of models from people's ratings, and the ratings themselves
  on('GET', '/api/parity/evaluations', () => {
    const board = {}, list = [];
    for (const c of db.chats) for (const m of c.messages) if (m.role === 'assistant' && m.feedback) { const k = m.model || (m.mode === 'tool' ? 'Plugins' : 'Documents only'), b = board[k] = board[k] || { model: k, up: 0, down: 0 }; b[m.feedback]++; list.push({ model: k, rating: m.feedback, reason: m.feedbackReason || '', by: (db.users.find(x => x.id === c.userId) || { name: 'Removed user' }).name, at: m.at }); }
    return { board: Object.values(board).map(b => ({ ...b, score: Math.round(1000 + 32 * (b.up - b.down)), total: b.up + b.down })).sort((a, b) => b.score - a.score), feedback: list.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 200) };
  }, A);

  // ---------- usage for one person, and for the tenant
  function stats(u) { const mine = db.chats.filter(c => c.userId === u.id && !c.temp), msgs = mine.flatMap(c => c.messages), a = msgs.filter(m => m.role === 'assistant'); return { chats: mine.length, questions: msgs.length - a.length, answers: a.length, tokens: a.reduce((s, m) => s + (m.tokensIn || 0) + (m.tokensOut || 0), 0), days: new Set(msgs.map(m => m.at.slice(0, 10))).size, models: [...new Set(a.map(m => m.model).filter(Boolean))] }; }
  on('GET', '/api/parity/analytics', () => { const a = db.chats.filter(c => !c.temp).flatMap(c => c.messages.filter(m => m.role === 'assistant').map(m => ({ m, c }))), by = {}, who = {}; for (const { m, c } of a) { const k = m.model || 'No model'; by[k] = by[k] || { model: k, messages: 0, tokens: 0, users: new Set(), chats: new Set() }; by[k].messages++; by[k].tokens += (m.tokensIn || 0) + (m.tokensOut || 0); by[k].users.add(c.userId); by[k].chats.add(c.id); const n = (db.users.find(x => x.id === c.userId) || { name: 'Removed user' }).name; who[n] = who[n] || { user: n, messages: 0, tokens: 0 }; who[n].messages++; who[n].tokens += (m.tokensIn || 0) + (m.tokensOut || 0); } return { messages: a.length, tokens: a.reduce((s, x) => s + (x.m.tokensIn || 0) + (x.m.tokensOut || 0), 0), chats: new Set(a.map(x => x.c.id)).size, users: new Set(a.map(x => x.c.userId)).size, models: Object.values(by).map(b => ({ model: b.model, messages: b.messages, tokens: b.tokens, users: b.users.size, chats: b.chats.size })), people: Object.values(who) }; }, A);

  // ---------- archive
  on('POST', '/api/parity/archive-all', ({ u }) => { needGpt(u); let n = 0; db.chats.forEach(c => { if (c.userId === u.id && !c.archived && !c.temp) { c.archived = true; n++; } }); return { archived: n }; });
  on('DELETE', '/api/parity/my-chats', ({ u }) => { needGpt(u); const ids = db.chats.filter(c => c.userId === u.id).map(c => c.id); db.chats = db.chats.filter(c => c.userId !== u.id); db.documents = db.documents.filter(d => !ids.some(id => d.collectionId === 'chat:' + id)); audit(u, 'Deleted all their chats', '', ids.length + ' chats'); return { deleted: ids.length }; });
  on('GET', '/api/parity/export/my-chats', ({ u }) => { needGpt(u); return db.chats.filter(c => c.userId === u.id && !c.temp).map(c => ({ id: c.id, title: c.title, createdAt: c.createdAt, messages: c.messages.map(m => ({ role: m.role, content: m.content, at: m.at, model: m.model })) })); });
  // An export of everyone's chats exists on the live build with no record. Here it follows the same switch as opening a chat, and is recorded.
  on('GET', '/api/parity/export/all-chats', ({ u }) => { if (!db.app.config.safety.adminChats) throw err(403, "Exporting people's chats is off. Turn on \"Admins can open people's chats\" in VanikGPT setup first."); audit(u, "Exported everyone's chats", '', db.chats.length + ' chats'); return db.chats.filter(c => !c.temp).map(c => ({ id: c.id, user: (db.users.find(x => x.id === c.userId) || { name: 'Removed user' }).name, title: c.title, messages: c.messages.map(m => ({ role: m.role, content: m.content, at: m.at })) })); }, A);
  on('GET', '/api/parity/export/users', ({ u }) => { audit(u, 'Exported the list of people', '', db.users.length + ' people'); return { csv: 'name,email,role,teams,status\n' + db.users.map(x => [x.name, x.email, x.role, (x.teams || []).join(';'), x.status].map(v => `"${String(v || '').replace(/"/g, '""')}"`).join(',')).join('\n') }; }, A);

  return { flags };
};
