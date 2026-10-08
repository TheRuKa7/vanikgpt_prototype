// What people do with what they find: keep it in the knowledge base, make it a task, pass it to a colleague.
// Also the Access page in Vanik OS: who may use each collection, agent, plugin, tool connector and workflow.
import { S, $, esc, icon, info, chip, go, ago, api, refresh, rerender, acts, toast, modal, menu, confirmBox, navToggle, accessDrafts, accessPicker, accessLabel, pickFiles } from './core.js';
import { gptShell, chatNow } from './gpt.js';
import { moreMenu } from './more.js';
import { osShell, uploadFiles } from './os.js';

const W = { tasks: null, key: '', access: null, akey: '', view: 'list', month: 0, autos: [] };
export const workRouteChanged = () => { W.key = ''; W.akey = ''; };
const loadTasks = () => Promise.all([api('GET', '/api/tasks'), api('GET', '/api/automations').catch(() => [])]).then(([t, a]) => { W.tasks = t; W.autos = a; rerender(); }).catch(e => toast(e.message, 'err'));
const plain = t => String(t || '').replace(/ ?\[\d{1,2}\]/g, '').replace(/\*\*/g, '').trim();
const firstLine = t => { const l = plain(t).split('\n').map(x => x.replace(/^[-#>\s]+/, '').trim()).find(x => x.length > 8) || ''; return l.length > 110 ? l.slice(0, 107) + '…' : l; };
const people = (me = true) => S.boot.users.filter(u => me || u.id !== S.boot.me.id);

// ---------- from an answer: keep, task, share
function taskModal(pre, done) {
  modal({ title: pre.id ? 'Change task' : 'Add a task', body: `<div class="stack"><label class="field"><span>What needs doing</span><input class="input" id="t-title" maxlength="160" value="${esc(pre.title || '')}"></label>
    <div class="row" style="gap:12px;align-items:flex-end"><label class="field grow"><span>For</span><select class="input" id="t-for">${people().map(u => `<option value="${u.id}" ${u.id === (pre.assignee || S.boot.me.id) ? 'selected' : ''}>${u.id === S.boot.me.id ? 'Me' : esc(u.name)}</option>`).join('')}</select></label><label class="field"><span>Due</span><input class="input" type="date" id="t-due" value="${esc(pre.due || '')}"></label></div>
    <label class="field"><span>Note</span><textarea class="input" id="t-note" rows="4">${esc(pre.note || '')}</textarea></label></div>`,
    actions: [{ label: pre.id ? 'Save' : 'Add task', run: async o => { const b = { title: $('#t-title', o).value, assignee: $('#t-for', o).value, due: $('#t-due', o).value, note: $('#t-note', o).value, source: pre.source }; const t = await api(pre.id ? 'PATCH' : 'POST', '/api/tasks' + (pre.id ? '/' + pre.id : ''), b); toast(pre.id ? 'Saved.' : t.assignee === S.boot.me.id ? 'Added to your tasks.' : `Sent to ${t.assigneeName}.`); W.key = ''; await refresh(); if (done) done(); } }] });
}
function shareModal(pre) {
  const others = people(false);
  if (!others.length) return toast('There is nobody else on this tenant yet.');
  modal({ title: 'Share with a colleague', body: `<div class="stack"><label class="field"><span>With</span><select class="input" id="s-for">${others.map(u => `<option value="${u.id}">${esc(u.name)}</option>`).join('')}</select></label>
    <label class="field"><span>In one line ${info('They see this line, the text below and where it came from, under Tasks. They do not get access to your chat.')}</span><input class="input" id="s-title" maxlength="160" value="${esc(pre.title || '')}"></label>
    <label class="field"><span>What you found</span><textarea class="input" id="s-note" rows="6">${esc(pre.note || '')}</textarea></label></div>`,
    actions: [{ label: 'Share', run: async o => { const t = await api('POST', '/api/tasks', { kind: 'share', title: $('#s-title', o).value, note: $('#s-note', o).value, assignee: $('#s-for', o).value, source: pre.source }); toast(`Shared with ${t.assigneeName}.`); W.key = ''; } }] });
}
function noteModal(pre) {
  const cols = S.boot.collections.filter(c => c.canWrite);
  if (!cols.length) return toast('You cannot add to any collection yet. An admin decides who can, under Access.');
  modal({ title: 'Save to knowledge', wide: true, body: `<div class="stack"><div class="row" style="gap:12px;align-items:flex-end"><label class="field grow"><span>Title ${info('Saved as a note in the collection. Anyone who can use that collection will find it by asking.')}</span><input class="input" id="n-title" maxlength="120" value="${esc(pre.title || '')}"></label><label class="field"><span>Collection</span><select class="input" id="n-col">${cols.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></label></div>
    <label class="field"><span>Note</span><textarea class="input" id="n-text" rows="9">${esc(pre.note || '')}</textarea></label></div>`,
    actions: [{ label: 'Save', run: async o => { const r = await api('POST', `/api/collections/${$('#n-col', o).value}/notes`, { title: $('#n-title', o).value, text: $('#n-text', o).value, from: pre.from || '' }); toast(`Saved to ${r.collectionName}.`); await refresh(); } }] });
}
acts['msg-more'] = el => {
  const c = chatNow(), m = c.messages.find(x => x.id === el.dataset.id), i = c.messages.indexOf(m), q = (c.messages.slice(0, i).reverse().find(x => x.role === 'user') || { content: c.title }).content.replace(/^\/\w+\s*/, '');
  const web = (m.activity || []).map(a => a.url).filter(Boolean).pop() || '', source = web ? { type: 'web', name: c.title, url: web } : { type: 'chat', chatId: c.id, msgId: m.id, name: c.title }, note = plain(m.content);
  const extra = moreMenu(m, c).filter(x => x !== '-'), toKnow = { label: 'To knowledge', sub: 'A note others can find by asking', icon: 'library_books', run: () => noteModal({ title: firstLine(q) || c.title, note, from: web || 'a chat' }) };
  menu(el, [{ label: 'How this answer was made', icon: 'insights', run: () => acts['msg-details'](el) }, { label: 'Read aloud', icon: 'volume_up', run: () => acts['msg-speak'](el) }, '-',
    { label: 'Save', sub: 'To knowledge, as a note, or to memory', icon: 'bookmark_add', run: () => menu(el, [{ heading: 'Save' }, toKnow, { ...extra[1], label: 'As a private note', sub: 'Only you see it' }, { ...extra[0], label: 'To memory', sub: 'So answers fit you' }]) },
    { label: 'Add as a task', sub: 'For you or a colleague', icon: 'add_task', run: () => taskModal({ title: firstLine(m.content), note, source }) },
    { label: 'Send to a colleague', sub: 'They get the text, not your chat', icon: 'send', run: () => shareModal({ title: firstLine(m.content), note, source }) },
    extra[2]]);
};

// ---------- from the knowledge base: notes, files, tasks out of a document
acts['kb-note'] = () => noteModal({ title: '', note: '', from: '' });
acts['kb-add'] = async el => { const files = await pickFiles(); if (!files.length) return; await uploadFiles(`/api/collections/${el.dataset.id}/documents`, files); go(location.hash + ''); await refresh(); toast('Added.'); };
acts['doc-tasks'] = async el => {
  const id = el.dataset.id, name = el.dataset.name, ideas = await api('GET', `/api/documents/${id}/task-ideas`), source = { type: 'doc', docId: id, name };
  if (!ideas.length) return taskModal({ title: '', note: '', source });
  modal({ title: 'Tasks from ' + name, wide: true, text: 'These lines read like something to do. Pick the ones to turn into tasks.', body: `<div class="stack" style="gap:8px" id="ideas">${ideas.map((x, k) => `<button class="check ${k < 3 ? 'on' : ''}" data-k="${k}" style="text-align:left"><span class="box">${icon('check')}</span><span class="grow">${esc(x.text)}${x.page ? ` <span class="mono">page ${x.page}</span>` : ''}</span></button>`).join('')}</div>
    <div class="row" style="gap:12px;margin-top:14px;align-items:flex-end"><label class="field grow"><span>For</span><select class="input" id="t-for">${people().map(u => `<option value="${u.id}">${u.id === S.boot.me.id ? 'Me' : esc(u.name)}</option>`).join('')}</select></label><label class="field"><span>Due</span><input class="input" type="date" id="t-due"></label></div>`,
    actions: [{ label: 'Add tasks', run: async o => { const picked = [...o.querySelectorAll('#ideas .on')].map(b => ideas[+b.dataset.k]); if (!picked.length) { toast('Pick at least one line.'); return false; } for (const x of picked) await api('POST', '/api/tasks', { title: x.text.length > 150 ? x.text.slice(0, 147) + '…' : x.text, note: `From ${name}${x.page ? ', page ' + x.page : ''}: ${x.text}`, assignee: $('#t-for', o).value, due: $('#t-due', o).value, source }); toast(`${picked.length} ${picked.length === 1 ? 'task' : 'tasks'} added.`); W.key = ''; await refresh(); } }] }).el.querySelector('#ideas').addEventListener('click', e => { const b = e.target.closest('.check'); if (b) b.classList.toggle('on'); });
};

// ---------- tasks
const srcLink = t => { const s = t.source; if (!s) return ''; const mine = t.createdBy === S.boot.me.id, ic = { chat: 'forum', doc: 'description', web: 'public', run: 'fact_check' }[s.type];
  const href = s.type === 'doc' && s.docId ? `#/gpt/source/${s.docId}/-/k` : s.type === 'run' && s.runId && (mine || S.boot.admin) ? `#/gpt/flows/${s.runId}` : s.type === 'chat' && mine ? `#/gpt/c/${s.chatId}` : s.type === 'web' ? s.url : '';
  return href ? `<a class="tag" href="${esc(href)}" ${s.type === 'web' ? 'target="_blank" rel="noopener"' : ''}>${icon(ic)}${esc(s.name || 'Source')}</a>` : `<span class="tag">${icon(ic)}${esc(s.name || 'A chat')}</span>`; };
function taskRow(t) {
  const me = S.boot.me.id, late = t.due && t.status === 'open' && t.due < new Date().toISOString().slice(0, 10), who = t.createdBy !== me ? 'From ' + t.createdByName : t.assignee !== me ? 'For ' + t.assigneeName : '';
  return `<div class="task ${t.status}"><button class="tick tip-right" data-act="task-tick" data-id="${t.id}" data-tip="${t.status === 'done' ? 'Not done yet' : 'Done'}" aria-label="${t.status === 'done' ? 'Mark as not done' : 'Mark as done'}">${icon('check')}</button>
    <div class="grow"><b>${esc(t.title)}</b>${t.note && t.note !== t.title ? `<div class="small muted tnote">${esc(t.note)}</div>` : ''}<div class="row wrap" style="gap:6px;margin-top:7px">${srcLink(t)}${who ? `<span class="small muted">${esc(who)}</span>` : ''}${t.due ? `<span class="small" style="color:var(--vnk-${late ? 'err' : 'ink-2'})">${late ? 'Was due' : 'Due'} ${new Date(t.due + 'T00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>` : ''}<span class="small faint">${ago(t.createdAt)}</span></div></div>
    <button class="icon-btn sm tip-left" data-act="task-menu" data-id="${t.id}" data-tip="More" aria-label="More">${icon('more_horiz')}</button></div>`;
}
// A month at a glance: tasks on the day they are due, automations on the day they next run.
function calendar() {
  const base = new Date(); base.setDate(1); base.setMonth(base.getMonth() + W.month);
  const y = base.getFullYear(), mo = base.getMonth(), first = (new Date(y, mo, 1).getDay() + 6) % 7, days = new Date(y, mo + 1, 0).getDate(), key = d => `${y}-${String(mo + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`, today = new Date().toLocaleDateString('en-CA');
  const on = {}; const put = (k, html) => { (on[k] = on[k] || []).push(html); };
  for (const t of W.tasks) if (t.due) put(t.due, `<button class="ev ${t.status}" data-act="task-menu" data-id="${t.id}" title="${esc(t.title)}">${esc(t.title)}</button>`);
  for (const a of W.autos) if (a.active && a.nextRunAt) put(new Date(a.nextRunAt).toLocaleDateString('en-CA'), `<a class="ev auto" href="#/gpt/library/automations" title="${esc(a.name)}">${icon('schedule')}${esc(a.name)}</a>`);
  const cells = [...Array(first).fill(''), ...Array.from({ length: days }, (_, i) => i + 1)];
  return `<div class="card"><div class="card-head"><button class="icon-btn sm" data-act="cal-move" data-v="-1" aria-label="Previous month">${icon('chevron_left')}</button><h3 style="min-width:150px;text-align:center">${base.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</h3><button class="icon-btn sm" data-act="cal-move" data-v="1" aria-label="Next month">${icon('chevron_right')}</button></div>
    <div class="cal">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => `<div class="dow">${d}</div>`).join('')}${cells.map(d => d ? `<div class="day ${key(d) === today ? 'today' : ''}"><span class="n">${d}</span>${(on[key(d)] || []).join('')}</div>` : '<div class="day off"></div>').join('')}</div></div>`;
}
acts['cal-move'] = el => { W.month += +el.dataset.v; rerender(); };
acts['task-view'] = el => { if (el.dataset.v === 'cal') return go('#/gpt/calendar'); W.view = 'list'; go('#/gpt/tasks'); };
export function tasksPage() {
  if (W.key !== 'tasks') { W.key = 'tasks'; loadTasks(); }
  const l = W.tasks, me = S.boot.me.id, sec = (title, list, tip) => list.length ? `<div class="card" style="margin-bottom:16px"><div class="card-head"><h3>${title}</h3>${tip ? info(tip) : ''}<span class="mono">${list.length}</span></div>${list.map(taskRow).join('')}</div>` : '';
  const open = l ? l.filter(t => t.status === 'open') : [], todo = open.filter(t => t.kind === 'task' && t.assignee === me), shared = open.filter(t => t.kind === 'share' && t.assignee === me), out = open.filter(t => t.assignee !== me), done = l ? l.filter(t => t.status === 'done').slice(0, 30) : [];
  return gptShell('tasks', `<div class="gpt-top">${navToggle()}<h3 class="grow">Tasks ${info('Things to do that came out of a chat, a document or a check. Each keeps a link to where it came from.', 'tip-down')}</h3><div class="seg"><button class="${W.view === 'list' ? 'on' : ''}" data-act="task-view" data-v="list">List</button><button class="${W.view === 'cal' ? 'on' : ''}" data-act="task-view" data-v="cal">Calendar</button></div><button class="btn" data-act="task-new">${icon('add')}New task</button></div>
    <div class="scroll" id="scroll"><div class="page" style="max-width:${W.view === 'cal' ? 1100 : 860}px">${!l ? '<p class="muted">Loading…</p>' : W.view === 'cal' ? calendar() : !l.length ? `<div class="empty">${icon('task_alt')}Nothing here yet. Open the ⋯ menu under any answer to add a task or share a finding.</div>`
      : sec('To do', todo) + sec('Shared with you', shared, 'A colleague passed these on. Tick one when you have read it.') + sec('Waiting on others', out, 'Tasks and findings you sent to colleagues.') + (done.length ? `<details class="card"><summary><h3 style="display:inline">Done</h3> <span class="mono">${done.length}</span></summary><div style="margin-top:12px">${done.map(taskRow).join('')}</div></details>` : '') + (open.length ? '' : '<p class="muted" style="margin-top:14px">All clear.</p>')}</div></div>`);
}
const taskOf = id => W.tasks.find(t => t.id === id);
acts['task-new'] = () => taskModal({});
acts['task-tick'] = async el => { const t = taskOf(el.dataset.id); await api('PATCH', '/api/tasks/' + t.id, { status: t.status === 'done' ? 'open' : 'done' }); W.key = ''; await refresh(); };
acts['task-menu'] = el => { const t = taskOf(el.dataset.id); menu(el, [{ label: 'Change', icon: 'edit', run: () => taskModal(t) }, t.note && { label: 'Save to knowledge', icon: 'bookmark_add', run: () => noteModal({ title: t.title, note: t.note, from: (t.source && (t.source.url || t.source.name)) || '' }) }, '-', { label: 'Delete', icon: 'delete_outline', danger: true, run: () => confirmBox('Delete this task?', 'It is removed for you and for the other person.', 'Delete', async () => { await api('DELETE', '/api/tasks/' + t.id); W.key = ''; await refresh(); }) }]); };

// ---------- Vanik OS: who may use what
const KINDS = [['collection', 'Knowledge', 'Who can search a collection, and who can add to it.'], ['agent', 'Agents', 'Shared agents. A private agent is only ever seen by the person who made it.'], ['plugin', 'Plugins', 'An ability that is off in VanikGPT setup is off for everyone.'], ['connector', 'Tool connectors', 'Tools from your own systems, such as the ERP.'], ['workflow', 'Workflows', 'Workflows built here. The three built in are open to everyone who can use VanikGPT.']];
const loadAccess = () => api('GET', '/api/access').then(a => { W.access = a; rerender(); }).catch(e => toast(e.message, 'err'));
const who = a => accessLabel(a) + ((a.deny || []).length ? ` · ${a.deny.length} blocked` : '');
function accessPage() {
  if (W.akey !== 'access') { W.akey = 'access'; loadAccess(); }
  const l = W.access;
  return osShell('access', 'Access', `<div class="page-head"><div><h1>Access</h1><p class="sub">Who may use each thing. Owners and admins always can.</p></div></div>
    ${!l ? '<p class="muted">Loading…</p>' : KINDS.map(([k, title, tip]) => { const rows = l.filter(x => x.kind === k); return `<div class="card" style="margin-bottom:16px;max-width:860px"><div class="card-head"><h3>${title}</h3>${info(tip)}</div>${rows.length ? rows.map(x => `<div class="set-row"><span class="avatar sq">${icon(x.icon)}</span><div class="grow"><div class="lbl ellipsis">${esc(x.name)}</div><div class="small muted">${k === 'collection' ? `Can use: ${esc(who(x.access))} · Can add: ${esc(who(x.write).replace('Everyone', 'Everyone who can use it'))}` : esc(who(x.access))}</div></div><button class="btn ghost" data-act="ax-edit" data-kind="${k}" data-id="${esc(x.id)}">Change</button></div>`).join('') : '<p class="muted">None yet.</p>'}</div>`; }).join('')}`);
}
acts['ax-edit'] = el => {
  const x = W.access.find(o => o.kind === el.dataset.kind && o.id === el.dataset.id), copy = a => ({ mode: a.mode, teams: [...a.teams], users: [...a.users], deny: [...(a.deny || [])] });
  accessDrafts.ax = copy(x.access); if (x.write) accessDrafts.axw = copy(x.write);
  modal({ title: x.name, wide: true, body: `<div class="stack" style="gap:18px"><div><div class="small" style="font-weight:600;margin-bottom:8px">Who can use it</div>${accessPicker('ax')}</div>${x.write ? `<div style="border-top:1px solid var(--vnk-border);padding-top:16px"><div class="small" style="font-weight:600;margin-bottom:8px">Who can add documents and notes ${info('Of the people who can use it. With nobody chosen, only owners and admins can add.')}</div>${accessPicker('axw', 'Everyone who can use it')}</div>` : ''}</div>`,
    actions: [{ label: 'Save', run: async () => { await api('PUT', '/api/access', { kind: x.kind, id: x.id, access: accessDrafts.ax }); if (x.write) await api('PUT', '/api/access', { kind: x.kind, id: x.id, part: 'write', access: accessDrafts.axw }); toast('Access saved.'); W.akey = ''; await refresh(); } }] });
};
export const workOsPage = parts => parts[0] === 'access' && S.boot.admin ? accessPage() : undefined;
