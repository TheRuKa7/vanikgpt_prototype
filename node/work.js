'use strict';
// What people do with what they find: keep it as a note in the knowledge base, turn it into a task, or pass it to a colleague.
// Also the one place that says who may use each collection, agent, plugin, tool connector and workflow. Loaded by server.js.
module.exports = function install(ctx) {
  const { db, on, err, uid, now, audit, isAdmin, A, byId, needGpt, allowed, cleanAccess, addDocument } = ctx;
  db.tasks = db.tasks || []; db.pluginAccess = db.pluginAccess || {};
  const person = id => db.users.find(u => u.id === id);
  const canWrite = (u, c) => isAdmin(u) || (!!c.write && allowed(c.access, u) && allowed(c.write, u));

  // ---------- tasks and things shared with a colleague
  const cleanSource = s => !s || typeof s !== 'object' ? null : { type: ['chat', 'doc', 'web', 'run'].includes(s.type) ? s.type : 'chat', chatId: String(s.chatId || ''), msgId: String(s.msgId || ''), docId: String(s.docId || ''), runId: String(s.runId || ''), name: String(s.name || '').slice(0, 160), url: /^https?:\/\//.test(s.url || '') ? String(s.url).slice(0, 400) : '' };
  const mine = (u, t) => t.createdBy === u.id || t.assignee === u.id;
  const view = t => ({ ...t, assigneeName: (person(t.assignee) || { name: 'Someone who has left' }).name });
  on('GET', '/api/tasks', ({ u }) => { needGpt(u); return db.tasks.filter(t => mine(u, t)).map(view); });
  on('POST', '/api/tasks', ({ u, body }) => {
    needGpt(u);
    const title = String(body.title || '').trim().slice(0, 160); if (!title) throw err(400, 'Say what needs doing.');
    const to = body.assignee ? person(body.assignee) : u; if (!to) throw err(400, 'Pick a person on this tenant.');
    const kind = body.kind === 'share' ? 'share' : 'task';
    if (kind === 'share' && to.id === u.id) throw err(400, 'Pick a colleague to share this with.');
    const t = { id: uid('tk'), kind, title, note: String(body.note || '').slice(0, 6000), source: cleanSource(body.source), createdBy: u.id, createdByName: u.name, assignee: to.id, due: /^\d{4}-\d{2}-\d{2}$/.test(body.due || '') ? body.due : '', status: 'open', createdAt: now(), doneAt: null };
    db.tasks.unshift(t); audit(u, kind === 'share' ? 'Shared a finding' : 'Added a task', title, to.id === u.id ? '' : 'For ' + to.name); return view(t);
  });
  on('PATCH', '/api/tasks/:id', ({ u, p, body }) => {
    const t = byId(db.tasks, p.id, 'Task'); if (!mine(u, t)) throw err(404, 'Task not found');
    if (body.status) { t.status = body.status === 'done' ? 'done' : 'open'; t.doneAt = t.status === 'done' ? now() : null; }
    if (body.title !== undefined && String(body.title).trim()) t.title = String(body.title).trim().slice(0, 160);
    if (body.note !== undefined) t.note = String(body.note).slice(0, 6000);
    if (body.due !== undefined) t.due = /^\d{4}-\d{2}-\d{2}$/.test(body.due) ? body.due : '';
    if (body.assignee && person(body.assignee)) t.assignee = body.assignee;
    return view(t);
  });
  on('DELETE', '/api/tasks/:id', ({ u, p }) => { const t = byId(db.tasks, p.id, 'Task'); if (!mine(u, t)) throw err(404, 'Task not found'); db.tasks = db.tasks.filter(x => x.id !== t.id); return { ok: true }; });

  // ---------- notes: an answer or a finding kept in a collection, so the next person finds it by asking
  on('POST', '/api/collections/:id/notes', ({ u, p, body }) => {
    needGpt(u);
    const c = byId(db.collections, p.id, 'Collection'); if (!canWrite(u, c)) throw err(403, 'You cannot add to this collection. Ask an admin to let you.');
    const title = String(body.title || '').trim().slice(0, 120), text = String(body.text || '').trim(); if (!title || !text) throw err(400, 'A note needs a title and some text.');
    const from = String(body.from || '').slice(0, 300);
    const d = addDocument(u, c.id, { name: title.replace(/[\\/:*?"<>|]+/g, ' ').trim() + '.md', type: 'md', pages: [`# ${title}\n\n${text}\n\nSaved by ${u.name} on ${now().slice(0, 10)}${from ? '. Source: ' + from : ''}.`], purpose: 'Note saved from chat' });
    d.note = true; c.updatedAt = now(); audit(u, 'Saved a note to knowledge', d.name, c.name); return { id: d.id, name: d.name, collectionName: c.name };
  });
  // Audio is kept as it comes. It can be searched once it has a transcript: from a speech model when one is serving, or typed in.
  on('POST', '/api/documents/:id/transcript', ({ u, p, body }) => {
    const old = byId(db.documents, p.id, 'Document'), c = byId(db.collections, old.collectionId, 'Collection'); if (!canWrite(u, c)) throw err(403, 'You cannot change this collection.');
    const text = String(body.text || '').trim(); if (text.length < 20) throw err(400, 'Paste the transcript first.');
    const d = addDocument(u, c.id, { name: old.name, type: old.type, size: old.size, pages: [text], purpose: old.purpose }, true); d.transcribed = true; d.uploadedBy = old.uploadedBy; d.uploadedAt = old.uploadedAt;
    db.documents = db.documents.filter(x => x.id !== old.id); audit(u, 'Added a transcript', d.name, c.name); return { id: d.id };
  });
  // Sentences in a document that read like something to do: a duty, a deadline, a review.
  on('GET', '/api/documents/:id/task-ideas', ({ u, p }) => {
    const d = byId(db.documents, p.id, 'Document'); if (!ctx.canReadDoc(u, d)) throw err(403, 'You do not have access to this document.');
    const DO = /\b(must|need(s)? to|has to|have to|is due|are due|due (on|by|within)|within \d+ (working )?days|at least \d+ (working )?days|by \d{1,2} [A-Z][a-z]+|before \d|deadline|renew|review(ed)? every|submit|notice|expires?|lapses?)\b/i, seen = new Set(), out = [];
    for (const k of d.chunks) for (const s of k.text.split(/(?<=[.!?])\s+|\n+/)) { const t = s.replace(/^[#\-*\s]+/, '').trim(); if (t.length < 25 || t.length > 220 || !DO.test(t) || seen.has(t)) continue; seen.add(t); out.push({ text: t, page: k.page || null }); if (out.length === 8) return out; }
    return out;
  });

  // ---------- access: who may use what
  const things = () => [
    ...db.collections.map(c => ({ kind: 'collection', id: c.id, name: c.name, icon: 'library_books', access: c.access, write: c.write || { mode: 'restricted', teams: [], users: [], deny: [] } })),
    ...db.assistants.filter(a => a.shared).map(a => ({ kind: 'agent', id: a.id, name: a.name, icon: a.icon || 'smart_toy', access: a.access })),
    ...ctx.plugins().map(p2 => ({ kind: 'plugin', id: p2.id, name: p2.name, icon: p2.icon, access: db.pluginAccess[p2.id] || null })),
    ...db.mcp.map(m => ({ kind: 'connector', id: m.id, name: m.name, icon: 'hub', access: m.access || null })),
    ...db.flowTypes.map(t => ({ kind: 'workflow', id: t.id, name: t.name, icon: t.icon, access: t.access || null })),
  ].map(x => ({ ...x, access: x.access || { mode: 'everyone', teams: [], users: [], deny: [] } }));
  on('GET', '/api/access', () => things(), A);
  on('PUT', '/api/access', ({ u, body }) => {
    const a = cleanAccess(body.access), label = a.mode === 'everyone' ? 'Everyone' : a.teams.length + a.users.length ? 'Chosen people' : 'Admins only';
    const done = name => { audit(u, body.part === 'write' ? 'Changed who can add to a collection' : 'Changed who can use ' + ({ collection: 'a collection', agent: 'an agent', plugin: 'a plugin', connector: 'a tool connector', workflow: 'a workflow' }[body.kind]), name, label + ((a.deny || []).length ? `, ${a.deny.length} blocked` : '')); return things().find(x => x.kind === body.kind && x.id === body.id); };
    if (body.kind === 'collection') { const c = byId(db.collections, body.id, 'Collection'); if (body.part === 'write') c.write = a; else c.access = a; return done(c.name); }
    if (body.kind === 'agent') { const x = byId(db.assistants, body.id, 'Agent'); x.access = a; return done(x.name); }
    if (body.kind === 'plugin') { const x = ctx.plugins().find(q => q.id === body.id); if (!x) throw err(404, 'Plugin not found'); db.pluginAccess[x.id] = a; return done(x.name); }
    if (body.kind === 'connector') { const x = byId(db.mcp, body.id, 'Connector'); x.access = a; return done(x.name); }
    if (body.kind === 'workflow') { const x = byId(db.flowTypes, body.id, 'Workflow'); x.access = a; return done(x.name); }
    throw err(400, 'Unknown kind.');
  }, A);
  return { canWrite, openTasks: u => db.tasks.filter(t => t.assignee === u.id && t.status === 'open').length };
};
