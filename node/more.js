'use strict';
// Things the live VanikGPT build has that people expect from a chat app, done the Vanik way:
// memory (what to remember about a person), private notes, skills (a saved way of doing a job, replayed step by step)
// and automations (a question asked on a schedule). Loaded by server.js.
module.exports = function install(ctx) {
  const { db, on, err, uid, now, audit, isAdmin, byId, needGpt } = ctx;
  for (const k of ['memories', 'notes', 'skills', 'automations']) db[k] = db[k] || [];
  const own = (list, id, u, what) => { const x = byId(list, id, what); if (x.userId !== u.id && !(what === 'Skill' && isAdmin(u))) throw err(404, what + ' not found'); return x; };

  // ---------- memory: short facts a person asks VanikGPT to keep. They are added to that person's chats only.
  on('GET', '/api/memories', ({ u }) => { needGpt(u); return db.memories.filter(m => m.userId === u.id); });
  on('POST', '/api/memories', ({ u, body }) => { needGpt(u); const text = String(body.text || '').replace(/\s+/g, ' ').trim().slice(0, 300); if (text.length < 3) throw err(400, 'Say what to remember.'); if (db.memories.filter(m => m.userId === u.id).length >= 50) throw err(400, 'That is 50 things already. Remove one first.'); const m = { id: uid('mem'), userId: u.id, text, at: now() }; db.memories.push(m); return m; });
  on('DELETE', '/api/memories/:id', ({ u, p }) => { const m = own(db.memories, p.id, u, 'Memory'); db.memories = db.memories.filter(x => x.id !== m.id); return { ok: true }; });
  const memoryFor = u => db.memories.filter(m => m.userId === u.id).map(m => m.text);

  // ---------- notes: private to the person who wrote them
  const cleanNote = b => { const title = String(b.title || '').trim().slice(0, 120), text = String(b.text || '').slice(0, 40000); if (!title) throw err(400, 'Give the note a title.'); return { title, text }; };
  on('GET', '/api/notes', ({ u }) => { needGpt(u); return db.notes.filter(n => n.userId === u.id).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); });
  on('POST', '/api/notes', ({ u, body }) => { needGpt(u); const n = { id: uid('nt'), userId: u.id, ...cleanNote(body), createdAt: now(), updatedAt: now() }; db.notes.push(n); return n; });
  on('PUT', '/api/notes/:id', ({ u, p, body }) => { const n = own(db.notes, p.id, u, 'Note'); Object.assign(n, cleanNote(body), { updatedAt: now() }); return n; });
  on('DELETE', '/api/notes/:id', ({ u, p }) => { const n = own(db.notes, p.id, u, 'Note'); db.notes = db.notes.filter(x => x.id !== n.id); return { ok: true }; });

  // ---------- skills: the steps of a job that worked, saved so anyone can run them again
  const cleanSkill = b => { const name = String(b.name || '').trim().slice(0, 60), steps = (Array.isArray(b.steps) ? b.steps : String(b.steps || '').split(/\n+/)).map(s => String(s).trim()).filter(Boolean).slice(0, 20); if (!name) throw err(400, 'Give the skill a name.'); if (!steps.length) throw err(400, 'A skill needs at least one step.'); return { name, description: String(b.description || '').trim().slice(0, 200), steps }; };
  const skillView = s => ({ id: s.id, name: s.name, description: s.description, steps: s.steps, shared: !!s.shared, userId: s.userId, createdByName: s.createdByName, updatedAt: s.updatedAt });
  on('GET', '/api/skills', ({ u }) => { needGpt(u); return db.skills.filter(s => s.userId === u.id || s.shared).map(skillView); });
  on('POST', '/api/skills', ({ u, body }) => { needGpt(u); const s = { id: uid('sk'), userId: u.id, createdByName: u.name, ...cleanSkill(body), shared: !!body.shared && isAdmin(u), createdAt: now(), updatedAt: now() }; db.skills.push(s); audit(u, 'Saved a skill', s.name, s.steps.length + ' steps'); return skillView(s); });
  on('PUT', '/api/skills/:id', ({ u, p, body }) => { const s = own(db.skills, p.id, u, 'Skill'); Object.assign(s, cleanSkill(body), { updatedAt: now() }); if (body.shared !== undefined && isAdmin(u)) s.shared = !!body.shared; return skillView(s); });
  on('DELETE', '/api/skills/:id', ({ u, p }) => { const s = own(db.skills, p.id, u, 'Skill'); db.skills = db.skills.filter(x => x.id !== s.id); audit(u, 'Deleted a skill', s.name); return { ok: true }; });

  // ---------- automations: a question asked on a schedule. The answers collect in one chat.
  const EVERY = { hour: 36e5, day: 864e5, week: 6048e5 };
  const autoView = a => ({ ...a, chatExists: db.chats.some(c => c.id === a.chatId) });
  const cleanAuto = b => { const name = String(b.name || '').trim().slice(0, 80), prompt = String(b.prompt || '').trim().slice(0, 2000); if (!name || !prompt) throw err(400, 'An automation needs a name and something to ask.'); return { name, prompt, every: EVERY[b.every] ? b.every : 'day', assistantId: db.assistants.some(a => a.id === b.assistantId) ? b.assistantId : null }; };
  async function run(a) {
    const u = db.users.find(x => x.id === a.userId); if (!u) { a.active = false; return; }
    a.lastRunAt = now(); a.nextRunAt = new Date(Date.now() + EVERY[a.every]).toISOString();
    try {
      let c = db.chats.find(x => x.id === a.chatId);
      if (!c) { const made = await ctx.call(u, 'POST', '/api/chats', { assistantId: a.assistantId }); c = db.chats.find(x => x.id === made.id); c.title = a.name; c.automationId = a.id; a.chatId = c.id; }
      if (c.pending) { a.lastResult = 'Waiting for your go-ahead in the chat.'; return; }
      await ctx.ask(u, c, { content: a.prompt }); c.title = a.name;
      const m = c.messages[c.messages.length - 1];
      a.lastResult = m.interrupt ? 'Waiting for your go-ahead in the chat.' : m.toolError ? 'Stopped: ' + m.toolError.slice(0, 140) : (m.content || 'No answer.').replace(/\s+/g, ' ').replace(/[*#|]/g, '').slice(0, 160);
      a.runs = (a.runs || 0) + 1;
    } catch (e) { a.lastResult = 'Could not run: ' + e.message; }
    ctx.save();
  }
  on('GET', '/api/automations', ({ u }) => { needGpt(u); return db.automations.filter(a => a.userId === u.id).map(autoView); });
  on('POST', '/api/automations', ({ u, body }) => { needGpt(u); if (db.automations.filter(a => a.userId === u.id).length >= 20) throw err(400, 'That is 20 automations already. Remove one first.'); const a = { id: uid('au'), userId: u.id, ...cleanAuto(body), active: true, createdAt: now(), lastRunAt: null, nextRunAt: null, lastResult: '', chatId: null, runs: 0 }; a.nextRunAt = new Date(Date.now() + EVERY[a.every]).toISOString(); db.automations.push(a); audit(u, 'Added an automation', a.name, 'Every ' + a.every); return autoView(a); });
  on('PUT', '/api/automations/:id', ({ u, p, body }) => { const a = own(db.automations, p.id, u, 'Automation'); if (body.active !== undefined && body.name === undefined) a.active = !!body.active; else Object.assign(a, cleanAuto(body)); return autoView(a); });
  on('POST', '/api/automations/:id/run', async ({ u, p }) => { const a = own(db.automations, p.id, u, 'Automation'); await run(a); return autoView(a); });
  on('DELETE', '/api/automations/:id', ({ u, p }) => { const a = own(db.automations, p.id, u, 'Automation'); db.automations = db.automations.filter(x => x.id !== a.id); audit(u, 'Removed an automation', a.name); return { ok: true }; });
  let busy = false;
  setInterval(async () => { if (busy || db.app.status !== 'running' || !db.device.online) return; busy = true; try { for (const a of db.automations) if (a.active && a.nextRunAt && new Date(a.nextRunAt) <= new Date()) await run(a); } finally { busy = false; } }, 30000).unref();

  // ---------- folders for chats
  db.folders = db.folders || [];
  const fname = b => { const n = String(b.name || '').trim().slice(0, 40); if (!n) throw err(400, 'Give the folder a name.'); return n; };
  on('POST', '/api/folders', ({ u, body }) => { needGpt(u); const f = { id: uid('fd'), userId: u.id, name: fname(body), createdAt: now() }; db.folders.push(f); return f; });
  on('PUT', '/api/folders/:id', ({ u, p, body }) => { const f = own(db.folders, p.id, u, 'Folder'); f.name = fname(body); return f; });
  on('DELETE', '/api/folders/:id', ({ u, p }) => { const f = own(db.folders, p.id, u, 'Folder'); db.folders = db.folders.filter(x => x.id !== f.id); db.chats.forEach(c => { if (c.folderId === f.id) c.folderId = null; }); return { ok: true }; });
  // ---------- an admin looking at a person's chats: off unless the tenant turns it on, and always recorded
  on('GET', '/api/admin/users/:id/chats', ({ u, p }) => { if (!db.app.config.safety.adminChats) throw err(403, "Opening people's chats is turned off for this tenant."); const who = byId(db.users, p.id, 'Person'); audit(u, "Listed a person's chats", who.name); return db.chats.filter(c => c.userId === who.id && !c.temp).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(c => ({ id: c.id, title: c.title, updatedAt: c.updatedAt, messages: c.messages.length })); }, ctx.A);

  return { memoryFor };
};
