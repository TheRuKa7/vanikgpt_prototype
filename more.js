// Library: what a person keeps for themselves. Notes, skills (saved steps that can be run again), automations (a question on a schedule)
// and memory (what VanikGPT should remember about them). Also the Run button for Python blocks.
import { S, $, esc, icon, info, chip, go, ago, api, refresh, rerender, acts, toast, modal, menu, confirmBox, navToggle } from './core.js';
import { gptShell, chatNow, sendText } from './gpt.js';
import { promptsHtml } from './simple.js';

const L = { key: '', notes: null, skills: null, autos: null, mem: null };
export const moreRouteChanged = () => { L.key = ''; };
const TABS = [['notes', 'Notes', 'sticky_note_2'], ['prompts', 'Prompts', 'bookmark_border'], ['memory', 'Memory', 'psychology']], ALL = ['notes', 'prompts', 'memory', 'skills', 'automations'];
export const LIB = L;
export const loadLibrary = () => load();
const load = async () => { try { [L.notes, L.skills, L.autos, L.mem] = await Promise.all(['notes', 'skills', 'automations', 'memories'].map(p => api('GET', '/api/' + p))); rerender(); } catch (e) { toast(e.message, 'err'); } };
const reload = async () => { await load(); };
const wait = ms => new Promise(r => setTimeout(r, ms));
const EVERY = { hour: 'Every hour', day: 'Every day', week: 'Every week' };

// ---------- notes
function noteEdit(n = {}) {
  modal({ title: n.id ? 'Note' : 'New note', wide: true, body: `<div class="stack"><input class="input" id="n-title" maxlength="120" placeholder="Title" value="${esc(n.title || '')}"><textarea class="input" id="n-text" rows="12" placeholder="Write here. Only you can see it.">${esc(n.text || '')}</textarea></div>`,
    actions: [{ label: 'Save', run: async o => { await api(n.id ? 'PUT' : 'POST', '/api/notes' + (n.id ? '/' + n.id : ''), { title: $('#n-title', o).value, text: $('#n-text', o).value }); await reload(); } }] });
}
acts['note-new'] = () => noteEdit();
acts['note-open'] = el => noteEdit(L.notes.find(n => n.id === el.dataset.id));
acts['note-menu'] = el => { const n = L.notes.find(x => x.id === el.dataset.id); menu(el, [{ label: 'Ask about this note', icon: 'forum', run: async () => { const c = await api('POST', '/api/chats', {}); await api('POST', `/api/chats/${c.id}/files`, { name: n.title + '.md', type: 'md', pages: [n.text || n.title] }); await refresh(); go('#/gpt/c/' + c.id); } }, '-', { label: 'Delete', icon: 'delete_outline', danger: true, run: () => confirmBox(`Delete "${n.title}"?`, 'This cannot be undone.', 'Delete', async () => { await api('DELETE', '/api/notes/' + n.id); await reload(); }) }]); };

// ---------- skills
function skillEdit(s = {}) {
  modal({ title: s.id ? 'Change skill' : 'New skill', wide: true, body: `<div class="stack"><label class="field"><span>Name</span><input class="input" id="k-name" maxlength="60" value="${esc(s.name || '')}" placeholder="Check a supplier invoice"></label><label class="field"><span>What it does</span><input class="input" id="k-desc" maxlength="200" value="${esc(s.description || '')}"></label>
    <label class="field"><span>Steps ${info('One per line. Each line is sent as a message, in order. Commands such as /gst, /use and /browse work. A step that needs your go-ahead stops the run until you allow it.')}</span><textarea class="input mono" id="k-steps" rows="7" style="font-size:12.5px">${esc((s.steps || []).join('\n'))}</textarea></label>
    ${S.boot.admin ? `<label class="row" style="gap:8px"><input type="checkbox" id="k-shared" ${s.shared ? 'checked' : ''}> Everyone can use this skill</label>` : ''}</div>`,
    actions: [{ label: 'Save', run: async o => { await api(s.id ? 'PUT' : 'POST', '/api/skills' + (s.id ? '/' + s.id : ''), { name: $('#k-name', o).value, description: $('#k-desc', o).value, steps: $('#k-steps', o).value, shared: $('#k-shared', o) ? $('#k-shared', o).checked : undefined }); toast('Routine saved. Find it under Routines.'); await reload(); } }] });
}
export const skillFromChat = c => skillEdit({ name: c.title.slice(0, 60), description: '', steps: c.messages.filter(m => m.role === 'user').map(m => m.content.replace(/\s*\n+\s*/g, ' ')) });
async function runSkill(s) {
  go('#/gpt'); await wait(250);
  for (let i = 0; i < s.steps.length; i++) {
    await sendText(s.steps[i]); await wait(150);
    const c = chatNow(), last = c && c.messages[c.messages.length - 1];
    if (c && c.pending) return toast(`Stopped at step ${i + 1} of ${s.steps.length}: it needs your go-ahead.`);
    if (last && last.ask) return toast(`Stopped at step ${i + 1} of ${s.steps.length}: it needs an answer from you.`);
  }
  toast(`${s.name}: ${s.steps.length} ${s.steps.length === 1 ? 'step' : 'steps'} done.`);
}
acts['skill-new'] = () => skillEdit();
acts['skill-run'] = el => runSkill(L.skills.find(s => s.id === el.dataset.id));
acts['skill-menu'] = el => { const s = L.skills.find(x => x.id === el.dataset.id); menu(el, [{ label: 'Change', icon: 'edit', run: () => skillEdit(s) }, '-', { label: 'Delete', icon: 'delete_outline', danger: true, run: () => confirmBox(`Delete "${s.name}"?`, 'Chats made with it are kept.', 'Delete', async () => { await api('DELETE', '/api/skills/' + s.id); await reload(); }) }]); };

// ---------- automations
function autoEdit(a = {}) {
  modal({ title: a.id ? 'Change automation' : 'New automation', wide: true, body: `<div class="stack"><label class="field"><span>Name</span><input class="input" id="a-name" maxlength="80" value="${esc(a.name || '')}" placeholder="What we owe our top supplier"></label>
    <label class="field"><span>What to ask ${info('Asked for you on the schedule, with your access. The answers collect in one chat. A step that needs a go-ahead waits for you there.')}</span><textarea class="input" id="a-prompt" rows="3">${esc(a.prompt || '')}</textarea></label>
    <div class="row" style="gap:12px;align-items:flex-end"><label class="field grow"><span>How often</span><select class="input" id="a-every">${Object.entries(EVERY).map(([k, v]) => `<option value="${k}" ${k === (a.every || 'day') ? 'selected' : ''}>${v}</option>`).join('')}</select></label><label class="field grow"><span>With agent</span><select class="input" id="a-as"><option value="">None</option>${S.boot.assistants.map(x => `<option value="${x.id}" ${x.id === a.assistantId ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label></div></div>`,
    actions: [{ label: 'Save', run: async o => { await api(a.id ? 'PUT' : 'POST', '/api/automations' + (a.id ? '/' + a.id : ''), { name: $('#a-name', o).value, prompt: $('#a-prompt', o).value, every: $('#a-every', o).value, assistantId: $('#a-as', o).value }); await reload(); } }] });
}
acts['auto-new'] = () => autoEdit();
acts['auto-run'] = async el => { el.disabled = true; el.textContent = 'Running…'; const a = await api('POST', `/api/automations/${el.dataset.id}/run`); toast(a.lastResult ? 'Done. ' + a.lastResult.slice(0, 90) : 'Done.'); await reload(); await refresh(); };
acts['auto-toggle'] = async el => { const a = L.autos.find(x => x.id === el.dataset.id); await api('PUT', '/api/automations/' + a.id, { active: !a.active }); await reload(); };
acts['auto-menu'] = el => { const a = L.autos.find(x => x.id === el.dataset.id); menu(el, [{ label: 'Change', icon: 'edit', run: () => autoEdit(a) }, '-', { label: 'Delete', icon: 'delete_outline', danger: true, run: () => confirmBox(`Delete "${a.name}"?`, 'Its chat is kept.', 'Delete', async () => { await api('DELETE', '/api/automations/' + a.id); await reload(); }) }]); };

// ---------- memory
export const remember = text => modal({ title: 'Remember this', body: `<label class="field"><span>What to remember ${info('Added to your chats only, so answers fit you. Other people never see it. Keep it short.')}</span><textarea class="input" id="m-text" rows="3" maxlength="300">${esc(text || '')}</textarea></label>`, actions: [{ label: 'Remember', run: async o => { await api('POST', '/api/memories', { text: $('#m-text', o).value }); toast('Remembered.'); if (location.hash.startsWith('#/gpt/library')) await reload(); } }] });
acts['mem-new'] = () => remember('');
acts['mem-del'] = async el => { await api('DELETE', '/api/memories/' + el.dataset.id); await reload(); };

// Extra lines for the menu under an answer.
export const moreMenu = (m, c) => [...(S.boot.app.config.models.length > 1 && c.messages[c.messages.length - 1] === m ? [{ label: 'Answer again with another model', icon: 'memory', run: () => menu(document.querySelector(`[data-act="msg-more"][data-id="${m.id}"]`), S.boot.app.config.models.map(id => ({ label: id, icon: 'memory', on: id === c.model, run: () => acts.regenWith(id) }))) }] : []), '-', { label: 'Remember this', sub: 'For your chats only', icon: 'psychology', run: () => remember(String(m.content).replace(/ ?\[\d{1,2}\]/g, '').replace(/[*#]/g, '').split('\n').find(l => l.trim().length > 8) || '') },
  { label: 'Save as a note', sub: 'Private to you', icon: 'sticky_note_2', run: async () => { await api('POST', '/api/notes', { title: c.title.slice(0, 120), text: String(m.content).replace(/ ?\[\d{1,2}\]/g, '') }); toast('Saved to your notes.'); } },
  { label: 'Save this chat as a routine', sub: 'Run the same steps again', icon: 'bolt', run: () => skillFromChat(c) }];

export function libraryPage(tab) {
  if (!ALL.includes(tab)) tab = 'notes';
  if (L.key !== 'lib') { L.key = 'lib'; load(); }
  const ready = L.notes && L.skills && L.autos && L.mem, me = S.boot.me.id;
  const add = { notes: ['note-new', 'New note'], prompts: ['ws-prompt-new', 'New prompt'], skills: ['skill-new', 'New routine'], automations: ['auto-new', 'New routine'], memory: ['mem-new', 'Add']}[tab];
  let body = '<p class="muted">Loading…</p>';
  if (ready && tab === 'notes') body = L.notes.length ? `<div class="grid">${L.notes.map(n => `<div class="card flat app-card" style="min-height:150px;cursor:pointer" data-act="note-open" data-id="${n.id}"><div class="row"><h3 class="grow ellipsis">${esc(n.title)}</h3><button class="icon-btn sm" data-act="note-menu" data-stop data-id="${n.id}" aria-label="More">${icon('more_vert')}</button></div><p class="small muted clamp">${esc(n.text)}</p><div class="foot"><span class="small faint">${ago(n.updatedAt)}</span></div></div>`).join('')}</div>` : `<div class="empty">${icon('sticky_note_2')}No notes yet. Write one, or use the ⋯ menu under an answer.</div>`;
  if (ready && tab === 'skills') body = L.skills.length ? `<div class="grid">${L.skills.map(s => `<div class="card flat app-card" style="min-height:0"><div class="row"><span class="avatar sq">${icon('bolt')}</span><h3 class="grow ellipsis">${esc(s.name)}</h3>${s.userId === me || S.boot.admin ? `<button class="icon-btn sm" data-act="skill-menu" data-id="${s.id}" aria-label="More">${icon('more_vert')}</button>` : ''}</div><p class="small muted">${esc(s.description || s.steps[0])}</p><div class="row wrap" style="gap:6px">${chip(s.steps.length + (s.steps.length === 1 ? ' step' : ' steps'), 'line', false)}${s.shared ? chip('Shared', 'line', false) : chip('Only you', 'line', false)}</div><div class="foot"><span class="small faint grow ellipsis">By ${esc(s.createdByName)}</span><button class="btn" data-act="skill-run" data-id="${s.id}">${icon('play_arrow')}Run</button></div></div>`).join('')}</div>` : `<div class="empty">${icon('bolt')}No skills yet. When a chat does a job well, save it as a skill from the ⋯ menu under an answer.</div>`;
  if (ready && tab === 'automations') body = L.autos.length ? `<div class="card" style="max-width:860px">${L.autos.map(a => `<div class="set-row" style="align-items:flex-start"><span class="avatar sq">${icon('schedule')}</span><div class="grow"><div class="lbl">${esc(a.name)}</div><div class="small muted">${EVERY[a.every]}${a.lastRunAt ? ' · last ran ' + ago(a.lastRunAt) : ' · not run yet'}${a.active && a.nextRunAt ? '' : ' · paused'}</div>${a.lastResult ? `<div class="small" style="margin-top:6px">${esc(a.lastResult)}</div>` : ''}${a.chatExists ? `<a class="link small" style="display:inline-block;margin-top:6px" href="#/gpt/c/${a.chatId}">Open its chat →</a>` : ''}</div>
      <button class="switch ${a.active ? 'on' : ''}" role="switch" aria-checked="${a.active}" aria-label="Active" data-act="auto-toggle" data-id="${a.id}"></button><button class="btn ghost" data-act="auto-run" data-id="${a.id}">Run now</button><button class="icon-btn sm" data-act="auto-menu" data-id="${a.id}" aria-label="More">${icon('more_vert')}</button></div>`).join('')}</div>` : `<div class="empty">${icon('schedule')}No automations yet. Have a question asked for you every hour, day or week.</div>`;
  if (ready && tab === 'prompts') body = promptsHtml();
  if (ready && tab === 'memory') body = `<div class="card" style="max-width:720px"><div class="card-head"><h3>What VanikGPT remembers about you</h3>${info('These lines are added to your chats so answers fit you. They stay on the appliance and nobody else sees them.')}</div>${L.mem.length ? L.mem.map(m => `<div class="set-row"><div class="grow">${esc(m.text)}</div><button class="icon-btn sm" data-act="mem-del" data-id="${m.id}" data-tip="Forget" aria-label="Forget">${icon('close')}</button></div>`).join('') : '<p class="muted">Nothing yet.</p>'}</div>`;
  return gptShell(tab === 'skills' || tab === 'automations' ? 'routines' : 'saved', `<div class="gpt-top">${navToggle()}<h3 class="grow">Saved ${info('What you keep for yourself: notes, prompts you reuse, and what VanikGPT should remember about you.', 'tip-down')}</h3><button class="btn" data-act="${add[0]}">${icon('add')}${add[1]}</button></div>
    <div class="scroll" id="scroll"><div class="page"><nav class="tabs" style="margin-bottom:20px">${TABS.map(t => `<a class="${t[0] === tab ? 'on' : ''}" href="#/gpt/saved/${t[0]}">${t[1]}${ready ? ` <span class="mono">${({ notes: L.notes, prompts: S.boot.prompts, memory: L.mem })[t[0]].length}</span>` : ''}</a>`).join('')}</nav>${body}</div></div>`);
}

// ---------- Python blocks run in the browser (Pyodide), never on the appliance
let py = null;
acts['py-run'] = async el => {
  const box = el.closest('.pyblock'), out = box.querySelector('.out'), code = box.querySelector('code').textContent;
  el.disabled = true; out.hidden = false; out.textContent = py ? 'Running…' : 'Getting Python ready (first run takes a few seconds)…';
  try {
    if (!py) { await new Promise((ok, no) => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js'; s.onload = ok; s.onerror = () => no(new Error('Python could not be loaded. It needs the internet once.')); document.head.appendChild(s); }); py = await window.loadPyodide(); }
    let text = ''; py.setStdout({ batched: t => { text += t + '\n'; } }); py.setStderr({ batched: t => { text += t + '\n'; } });
    const r = await py.runPythonAsync(code);
    out.textContent = (text + (r !== undefined && r !== null ? String(r) : '')).trim() || 'Done. Nothing was printed.';
  } catch (e) { out.textContent = String(e.message || e).split('\n').filter(Boolean).slice(-3).join('\n'); out.classList.add('bad'); }
  el.disabled = false;
};
acts['ask-pick'] = el => sendText(el.dataset.send);
