// The VanikGPT app people use: chat, sources, assistants, knowledge.
import { navToggle, S, $, esc, icon, info, chip, initials, go, bytes, ago, api, load, refresh, rerender, acts, ins, toast, modal, confirmBox, menu, themeButton, userButton, accessDrafts, accessPicker, accessLabel, pickFiles, downloadText, when, FILE_ACCEPT } from './core.js';
import { osShell, uploadFiles } from './os.js';

const G = { chat: null, chatId: null, streaming: null, draftText: '', newOpts: { model: null, sources: 'all', assistantId: null, effort: 'balanced' }, slashOpen: false, listening: false, rec: null, catalog: null, search: '', searchRes: null, toBottom: false, focus: false, editOf: null, shared: null, sharedKey: '', docs: {}, doc: null, docKey: '', colDocs: {}, hitKey: '' };
export const gptRouteChanged = () => { G.hitKey = ''; const c = G.chat; if (c && c.temp && location.hash !== '#/gpt/c/' + c.id) api('DELETE', '/api/chats/' + c.id).catch(() => {}); };
export const sendText = async text => { G.draftText = text; await acts.send(); };

// ---------- markdown (small, safe subset)
function md(src) {
  const blocks = [];
  const s = String(src || '').replace(/```(\w*)\n?([\s\S]*?)(```|$)/g, (_, lang, code) => { const pre = `<pre><code>${esc(code.replace(/\n$/, ''))}</code></pre>`; blocks.push(/^py(thon)?$/i.test(lang) ? `<div class="pyblock">${pre}<div class="row"><button class="btn ghost" data-act="py-run">${icon('play_arrow')}Run</button><span class="small faint">Runs in your browser</span></div><pre class="out" hidden></pre></div>` : pre); return `\n\u0000${blocks.length - 1}\u0000\n`; });
  const inline = t => esc(t).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a class="ext" href="$2" target="_blank" rel="noopener">$1</a>').replace(/\[(\d{1,2})\]/g, '<a class="cite" data-act="cite" data-n="$1" role="button">$1</a>');
  const LI = /^\s*([-*•]|\d+[.)])\s+/, lines = s.split('\n');
  let out = '', i = 0;
  while (i < lines.length) {
    const l = lines[i], t = l.trim();
    if (!t) { i++; continue; }
    if (/^\u0000\d+\u0000$/.test(t)) { out += blocks[+t.slice(1, -1)]; i++; continue; }
    const h = l.match(/^#{1,4}\s+(.*)/);
    if (h) { out += `<h4>${inline(h[1])}</h4>`; i++; continue; }
    if (LI.test(l)) { const ord = /^\s*\d+[.)]\s+/.test(l); let items = ''; while (i < lines.length && LI.test(lines[i])) { items += `<li>${inline(lines[i].replace(LI, ''))}</li>`; i++; } out += ord ? `<ol>${items}</ol>` : `<ul>${items}</ul>`; continue; }
    if (/^\|.*\|$/.test(t) && i + 1 < lines.length && /^\|[\s:|-]+\|$/.test(lines[i + 1].trim())) {
      const cells = r => r.trim().slice(1, -1).split('|').map(c => inline(c.trim()));
      let rows = `<tr>${cells(l).map(c => `<th>${c}</th>`).join('')}</tr>`; i += 2;
      while (i < lines.length && /^\|.*\|$/.test(lines[i].trim())) { rows += `<tr>${cells(lines[i]).map(c => `<td>${c}</td>`).join('')}</tr>`; i++; }
      out += `<div class="tbl"><div class="tbl-tools"><button data-act="tbl-copy">Copy</button><button data-act="tbl-csv">Download CSV</button></div><table>${rows}</table></div>`; continue;
    }
    const p = [inline(l)]; i++;
    while (i < lines.length && lines[i].trim() && !LI.test(lines[i]) && !/^(#{1,4}\s|\u0000)/.test(lines[i].trim())) { p.push(inline(lines[i])); i++; }
    out += `<p>${p.join('<br>')}</p>`;
  }
  return out;
}

// ---------- shell
function chatList() {
  const B = S.boot, item = (c, sub) => `<div class="chat-item ${G.chatId === c.id ? 'on' : ''}"><a class="ellipsis" href="#/gpt/c/${c.id}">${c.shared ? icon('group') + ' ' : ''}${esc(c.title)}${sub ? `<small class="ellipsis">${esc(sub)}</small>` : ''}</a><button class="icon-btn sm" data-act="chat-menu" data-id="${c.id}" aria-label="Chat options">${icon('more_horiz')}</button></div>`;
  if (G.search) return G.searchRes ? (G.searchRes.length ? G.searchRes.map(c => item(c, c.match)).join('') : `<p class="small muted" style="padding:10px">No chat matches.</p>`) : `<p class="small muted" style="padding:10px">Searching…</p>`;
  const fs = B.folders || [], inF = c => fs.some(f => f.id === c.folderId), pinned = B.chats.filter(c => c.pinned && !inF(c)), rest = B.chats.filter(c => !c.pinned && !inF(c));
  const folders = fs.map(f => `<span class="nav-group-label folder" style="padding-top:14px">${icon('folder')}<span class="grow ellipsis">${esc(f.name)}</span><button class="icon-btn sm" data-act="folder-menu" data-id="${f.id}" aria-label="Folder options">${icon('more_horiz')}</button></span>${B.chats.filter(c => c.folderId === f.id).map(c => item(c)).join('') || '<p class="small faint" style="padding:2px 10px 0">Empty</p>'}`).join('');
  if (!B.chats.length) return `<p class="small muted" style="padding:10px">Your chats show up here.</p>`;
  return (pinned.length ? `<span class="nav-group-label" style="padding-top:8px;display:block">Pinned</span>${pinned.map(c => item(c)).join('')}` : '') + folders + (rest.length ? `<span class="nav-group-label" style="padding-top:${pinned.length || fs.length ? 14 : 8}px;display:block">Recent</span>${rest.map(c => item(c)).join('')}` : '');
}
export function gptShell(active, content) {
  const B = S.boot;
  return `<div class="gpt"><aside class="gpt-nav">
    <div class="brand"><span class="app-ico" style="width:26px;height:26px;border-radius:8px">${icon('forum')}</span><span>VanikGPT</span>${B.admin ? `<a class="icon-btn sm right tip-down tip-left" href="#/os/apps/vanikgpt/overview" data-tip="Manage in Vanik OS" aria-label="Manage in Vanik OS">${icon('tune')}</a>` : ''}</div>
    <a class="btn ghost newchat" href="#/gpt">${icon('add')}New chat</a>
    <input class="input" placeholder="Search chats" value="${esc(G.search)}" data-on="chat-search" aria-label="Search chats">
    <div class="chatlist" id="chatlist">${chatList()}</div>
    ${[['assistants', 'Agents', 'smart_toy', '#/gpt/assistants', ['assistants', 'workspace']], ['knowledge', 'Knowledge', 'library_books', '#/gpt/knowledge', ['knowledge']], ['routines', 'Routines', 'bolt', '#/gpt/routines', ['routines', 'flows']], ['tasks', 'Tasks', 'task_alt', '#/gpt/tasks', ['tasks', 'calendar']], ['saved', 'Saved', 'bookmark_border', '#/gpt/saved', ['saved', 'library', 'notes']]].map(n => `<a class="nav-item ${n[4].includes(active) ? 'is-active' : ''}" href="${n[3]}">${icon(n[2])}<span class="grow">${n[1]}</span>${n[0] === 'tasks' && B.openTasks ? `<span class="count">${B.openTasks}</span>` : ''}</a>`).join('')}
    <div class="row" style="border-top:1px solid var(--vnk-border);padding-top:10px;margin-top:8px">${userButton()}<span class="right">${themeButton()}</span></div>
  </aside><div class="gpt-main">${content}</div></div>`;
}
let searchT;
ins['chat-search'] = el => { G.search = el.value.trim(); G.searchRes = null; clearTimeout(searchT); $('#chatlist').innerHTML = chatList(); if (G.search) searchT = setTimeout(async () => { const q = G.search; const r = await api('GET', '/api/search/chats?q=' + encodeURIComponent(q)); if (q === G.search) { G.searchRes = r; $('#chatlist').innerHTML = chatList(); } }, 200); };

function blocked() {
  const B = S.boot, a = B.app;
  const [title, text] = !B.device.online && a.status === 'running' ? ['The Vanik Appliance is offline', 'VanikGPT comes back as soon as the appliance is online again.']
    : a.status !== 'running' ? ['VanikGPT is not running yet', B.admin ? 'Finish setup and deploy it to start chatting.' : 'Ask an owner or admin to turn it on.']
      : ['You have not been given VanikGPT', 'Ask an owner or admin for access.'];
  return `<div class="center-page"><div class="card" style="text-align:center"><span class="app-ico" style="margin:0 auto 16px">${icon('forum')}</span><h2>${title}</h2><p class="muted" style="margin-top:8px">${text}</p>
    <div class="row" style="justify-content:center;margin-top:20px">${B.admin ? `<a class="btn" href="#/os/apps/vanikgpt/overview">Open in Vanik OS</a>` : ''}<button class="btn ghost" data-act="user-menu">${esc(B.me.name)}</button></div></div></div>`;
}

// ---------- composer
const assistantOf = id => S.boot.assistants.find(a => a.id === id);
const colsLabel = v => { const B = S.boot, mine = B.collections.filter(c => B.gptCollectionIds.includes(c.id)); if (v === 'none') return 'No knowledge'; if (v === 'all') return mine.length ? 'All knowledge' : 'No knowledge yet'; const n = mine.filter(c => v.includes(c.id)); return n.length === 1 ? n[0].name : n.length + ' collections'; };
function composer() {
  const B = S.boot, c = G.chat, o = c || G.newOpts, as = assistantOf(o.assistantId), model = (c ? c.model : (as && as.model) || G.newOpts.model) || B.app.config.defaultModel;
  const busy = G.streaming && (!c || G.streaming.chatId === c.id), files = c ? c.files || [] : [];
  return `<div class="composer-wrap"><div id="uploads"></div><div class="composer" data-chatdrop>
    ${files.length ? `<div class="files">${files.map(f => `<span class="tag">${icon('description')}<a class="ellipsis" style="max-width:180px" href="#/gpt/source/${f.id}/-/${c.id}">${esc(f.name)}</a><button data-act="file-remove" data-id="${f.id}" aria-label="Remove file">${icon('close')}</button></span>`).join('')}</div>` : ''}
    ${G.editOf ? `<div class="editing">${icon('edit')}<span class="grow">Editing an earlier question. Everything after it will be replaced.</span><button class="link" data-act="edit-cancel">Cancel</button></div>` : ''}
    <div id="slash">${slashHtml()}</div>
    <textarea id="q" rows="1" placeholder="${as ? 'Ask ' + esc(as.name) : 'Ask anything'}" data-on="q-input" aria-label="Your question">${esc(G.draftText)}</textarea>
    <div class="tools">
      <button class="icon-btn sm bordered tip-right" data-act="plus" data-tip="Add files, use an agent, more" aria-label="Add">${icon('add')}</button>
      ${as || (o.sources && o.sources !== 'all') ? `<button class="pick ${as ? 'tip-right' : ''}" data-act="pick-sources" ${as ? 'disabled data-tip="Set by the agent"' : ''}>${icon('library_books')}<span class="ellipsis">${esc(colsLabel(as ? as.collections : o.sources))}</span></button>` : ''}
      ${(o.effort || 'balanced') !== 'balanced' ? `<button class="pick" data-act="pick-effort">${icon('speed')}<span>${EFFORT[o.effort][0]}</span></button>` : ''}
      ${model && model !== B.app.config.defaultModel ? `<button class="pick ${outsideOf(model) ? 'out' : ''}" data-act="pick-model">${icon(outsideOf(model) ? 'public' : 'memory')}<span class="ellipsis">${esc(outsideOf(model) ? outsideOf(model).name : model)}</span></button>` : ''}
      <span class="grow"></span>
      ${B.app.config.safety.voice ? '' : '<!--'}<button class="icon-btn sm ${G.listening ? 'on' : ''} tip-left" data-act="mic" data-tip="${G.listening ? 'Stop listening' : 'Speak instead of typing'}" aria-label="Voice typing" aria-pressed="${G.listening}">${icon(G.listening ? 'mic' : 'mic_none')}</button>${B.app.config.safety.voice ? '' : '-->'}
      ${busy ? `<button class="send" data-act="stop" aria-label="Stop">${icon('stop')}</button>` : `<button class="send" data-act="send" aria-label="Send">${icon('arrow_upward')}</button>`}
    </div></div><p class="small ${outsideOf(model) ? '' : 'faint'}" style="text-align:center;margin-top:9px${outsideOf(model) ? ';color:var(--vnk-warn)' : ''}">${outsideOf(model) ? `${icon('public')} This chat uses a model outside your network. Your question is sent to ${esc(outsideOf(model).provider)}. Your documents are not, unless an admin allows it.` : 'Runs on your Vanik Appliance. Nothing leaves your network.'}</p>${!c && !as ? `<p style="text-align:center;margin-top:6px"><button class="link small" data-act="temp-toggle">${icon(G.newOpts.temp ? 'visibility' : 'visibility_off')} ${G.newOpts.temp ? 'Temporary chat is on. Nothing will be kept. Turn off' : 'Start a temporary chat'}</button></p>` : ''}</div>`;
}
ins['q-input'] = el => { G.draftText = el.value; el.style.height = 'auto'; if (el.value) el.style.height = Math.min(200, el.scrollHeight) + 'px'; const sl = $('#slash'); if (sl) sl.innerHTML = slashHtml(); };
document.addEventListener('keydown', e => {
  if (e.target.id !== 'q') return;
  const open = slashMatches();
  if (e.key === 'Escape' && open.length) { G.draftText = ''; e.target.value = ''; $('#slash').innerHTML = ''; return; }
  if ((e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey && !e.isComposing && open.length) { e.preventDefault(); return runSlash(open[0][0], e.target); }
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); acts.send(); }
});
const EFFORT = { quick: ['Quick', 'Fewer sources, short answer'], balanced: ['Balanced', 'The usual depth'], thorough: ['Thorough', 'More sources, more history, longer answer'] };
// Slash commands. Some open a picker, some put a command in the box for you to finish.
const put = t => { G.draftText = t; G.focus = true; rerender(); };
const SLASH = [
  ['/agent', 'Start a chat with an agent', el => agentMenu(el)], ['/prompt', 'Use a saved prompt', el => acts.prompts(el)],
  ['/search', 'Show matching passages only, no written answer', () => put('/search ')], ['/summarise', 'Summarise the files attached to this chat', () => { G.draftText = '/summarise'; acts.send(); }],
  ['/calc', 'Exact arithmetic', () => put('/calc '), 'calculator'], ['/gst', 'Check a GSTIN, PAN or IFSC, or work out GST', () => put('/gst '), 'gst'], ['/table', 'Totals, counts and top rows from an attached CSV or Excel file', () => put('/table '), 'tables'],
  ['/browse', 'Open an allowed site and read it', () => put('/browse https://'), 'browser'], ['/screen', 'Work a page by pointer and keys', () => put('/screen open https://'), 'screen'],
  ['/use', 'Run a tool from a connector', el => toolMenu(el)], ['/effort', 'Quick, balanced or thorough', el => acts['pick-effort'](el)], ['/model', 'Change the model', el => acts['pick-model'](el)],
  ['/sources', 'Choose where answers come from', el => acts['pick-sources'](el)], ['/new', 'Start a new chat', () => { G.draftText = ''; go('#/gpt'); }], ['/help', 'What VanikGPT can do', () => helpBox()],
];
const pluginOn = id => { const B = S.boot, c = G.chat || G.newOpts, as = assistantOf(c.assistantId); return B.app.config.tools.enabled.includes(id) && (as ? (as.tools || []).includes(id) : !Array.isArray(c.plugins) || c.plugins.includes(id)); };
function slashMatches() { const t = G.draftText; if (!/^\/[a-z]*$/i.test(t)) return []; return SLASH.filter(c => c[0].startsWith(t.toLowerCase()) && (!c[3] || pluginOn(c[3]))); }
function slashHtml() { const m = slashMatches(); return m.length ? `<div class="slash" role="listbox">${m.map((c, i) => `<button class="${i ? '' : 'sel'}" data-act="slash" data-c="${c[0]}" role="option"><b>${c[0]}</b><span>${c[1]}</span></button>`).join('')}</div>` : ''; }
function runSlash(name, el) { const c = SLASH.find(x => x[0] === name); G.draftText = ''; const q = $('#q'); if (q) q.value = ''; const sl = $('#slash'); if (sl) sl.innerHTML = ''; c[2](q || el); }
acts.slash = el => runSlash(el.dataset.c, $('#q'));
function helpBox() {
  const B = S.boot;
  modal({ title: 'What VanikGPT can do', wide: true, cancel: 'Close', body: `<p class="muted">Ask in plain words. Add files with the + button. Type / to see commands.</p><h3 style="margin:16px 0 8px">Commands</h3><dl class="kv">${SLASH.map(c => `<dt class="mono" style="color:var(--vnk-ink)">${c[0]}</dt><dd style="font-weight:400">${c[1]}</dd>`).join('')}</dl><h3 style="margin:16px 0 8px">Abilities</h3>${B.plugins.map(p => `<div class="set-row">${icon(p.icon)}<div class="grow"><div class="lbl">${p.name}</div><div class="small muted">${p.what} Try: <span class="mono">${esc(p.hint)}</span></div></div>${chip(B.app.config.tools.enabled.includes(p.id) ? 'On' : 'Off', B.app.config.tools.enabled.includes(p.id) ? 'ok' : '', false)}</div>`).join('')}<p class="small faint" style="margin-top:12px">Keys: Ctrl K search, Alt T theme, Alt C copy the last answer.</p>` });
}
acts['pick-effort'] = el => { const cur = (G.chat || G.newOpts).effort || 'balanced'; menu(el, [{ heading: 'Effort' }, ...Object.entries(EFFORT).map(([k, v]) => ({ label: v[0], sub: v[1], icon: k === 'quick' ? 'bolt' : k === 'thorough' ? 'psychology' : 'speed', on: k === cur, run: () => setOpt({ effort: k }) }))]); };
function agentMenu(el) { const B = S.boot; menu(el, [{ heading: 'Agents' }, ...B.assistants.slice(0, 12).map(a => ({ label: a.name, sub: a.description, icon: a.icon || 'smart_toy', run: () => go('#/gpt/new/' + a.id) })), !B.assistants.length && { label: 'No agents yet', sub: 'Add a ready-made one or make your own', icon: 'info_outline', run: () => go('#/gpt/assistants') }, '-', { label: 'Ready-made agents', icon: 'apps', run: () => go('#/gpt/assistants') }, { label: 'New agent', sub: 'Describe the job and get a draft', icon: 'auto_fix_high', run: () => go('#/gpt/assistants/new') }]); }
function toolMenu(el) { const B = S.boot, tools = B.toolConnectors.flatMap(m => m.tools.map(t => ({ m, t }))); menu(el, [{ heading: 'Connector tools' }, ...tools.map(x => ({ label: x.t.name, sub: `${x.m.name} · ${x.t.ask ? 'asks first' : 'runs straight away'}`, icon: 'hub', run: () => put(`/use ${x.t.name} ${x.t.params.map(k => k + '=').join(' ')}`) })), !tools.length && { label: 'No tool connectors yet', sub: B.admin ? 'Add one in Vanik OS, Connectors' : 'Ask an admin to add one', icon: 'info_outline', run: () => { if (B.admin) go('#/os/connectors'); } }]); }
function pluginMenu(el) {
  const B = S.boot, c = G.chat || G.newOpts, as = assistantOf(c.assistantId), en = B.app.config.tools.enabled;
  if (as) return menu(el, [{ heading: 'Plugins set by the agent' }, ...B.plugins.filter(p => (as.tools || []).includes(p.id)).map(p => ({ label: p.name, sub: p.what, icon: p.icon, on: true, run: () => {} })), !(as.tools || []).length && { label: 'This agent uses no plugins', icon: 'info_outline', run: () => {} }]);
  menu(el, [{ heading: 'Plugins for this chat' }, ...B.plugins.filter(p => en.includes(p.id)).map(p => ({ label: p.name, sub: p.what, icon: p.icon, on: pluginOn(p.id), run: () => { const cur = Array.isArray(c.plugins) ? [...c.plugins] : [...en]; const i = cur.indexOf(p.id); if (i < 0) cur.push(p.id); else cur.splice(i, 1); return setOpt({ plugins: cur }); } })), !en.length && { label: 'Your admin has turned plugins off', icon: 'info_outline', run: () => {} }, B.admin && '-', B.admin && { label: 'Manage plugins', sub: 'Vanik OS, VanikGPT, Setup', icon: 'tune', run: () => go('#/os/apps/vanikgpt/setup') }]);
}
function connectorMenu(el) {
  const B = S.boot, c = G.chat || G.newOpts, on = id => !Array.isArray(c.connectors) || c.connectors.includes(id);
  menu(el, [{ heading: 'Knowledge' }, { label: colsLabel(c.sources), sub: 'Choose collections', icon: 'library_books', run: () => acts['pick-sources'](el) },
    { heading: 'Tool connectors' }, ...B.toolConnectors.map(m => ({ label: m.name, sub: m.error ? 'Not reachable' : `${m.tools.length} tools · type /use to run one`, icon: 'hub', on: on(m.id), run: () => { const cur = Array.isArray(c.connectors) ? [...c.connectors] : B.toolConnectors.map(x => x.id); const i = cur.indexOf(m.id); if (i < 0) cur.push(m.id); else cur.splice(i, 1); return setOpt({ connectors: cur }); } })),
    !B.toolConnectors.length && { label: 'None yet', sub: 'A tool connector links VanikGPT to another system', icon: 'info_outline', run: () => {} }, B.admin && '-', B.admin && { label: 'Add a connector', sub: 'Vanik OS, Connectors', icon: 'add_link', run: () => go('#/os/connectors') }]);
}
acts.plus = el => {
  const up = S.boot.app.config.safety.uploads;
  menu(el, [up && { label: 'Add files or photos', sub: 'PDF, Word, Excel, text, images of scans', icon: 'attach_file', run: () => acts.attach() }, up && { label: 'Add a folder', sub: 'Every readable file in it, up to 50', icon: 'create_new_folder', run: () => acts['attach-folder']() }, up && '-',
    { label: 'Use an agent', sub: 'A helper set up for one job', icon: 'smart_toy', run: () => agentMenu(el) }, { label: 'Saved prompts', icon: 'bookmark_border', run: () => acts.prompts(el) },
    { label: 'Options', sub: 'Where answers come from, effort, model, abilities', icon: 'tune', run: () => { const o = G.chat || G.newOpts; menu(el, [{ heading: 'For this chat' }, !assistantOf(o.assistantId) && { label: 'Answer from', sub: colsLabel(o.sources), icon: 'library_books', run: () => acts['pick-sources'](el) }, { label: 'Model', sub: (outsideOf((G.chat ? G.chat.model : G.newOpts.model)) || { name: (G.chat ? G.chat.model : G.newOpts.model) || S.boot.app.config.defaultModel }).name, icon: 'memory', run: () => acts['pick-model'](el) }, { label: 'Abilities', sub: 'Calculator, checks, tables, browser', icon: 'extension', run: () => pluginMenu(el) }, { label: 'Connected systems', sub: 'Tools from your own systems', icon: 'hub', run: () => connectorMenu(el) }]); } },
    '-', { label: 'Commands', sub: 'Type / in the box', icon: 'terminal', run: () => helpBox() }]);
};
acts.mic = () => {
  const B = S.boot;
  if (G.rec) return G.rec.stop();
  if (!B.app.config.safety.voice) return modal({ title: 'Voice typing is off', text: 'It uses the browser\'s own dictation. In Chrome and Edge the audio goes to the browser maker to be turned into text, so it is off until an admin turns it on.', cancel: 'Close', actions: B.admin ? [{ label: 'Open Setup', run: () => go('#/os/apps/vanikgpt/setup') }] : [] });
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return toast('This browser has no voice typing.', 'err');
  const r = G.rec = new SR(), base = G.draftText ? G.draftText.trimEnd() + ' ' : '';
  r.lang = navigator.language || 'en-IN'; r.interimResults = true; r.continuous = true;
  r.onresult = e => { let t = ''; for (const x of e.results) t += x[0].transcript; G.draftText = base + t; const q = $('#q'); if (q) { q.value = G.draftText; q.style.height = 'auto'; q.style.height = Math.min(200, q.scrollHeight) + 'px'; } };
  r.onerror = e => toast(e.error === 'not-allowed' ? 'The browser blocked the microphone.' : 'Voice typing stopped.', 'err');
  r.onend = () => { G.rec = null; G.listening = false; G.focus = true; rerender(); };
  r.start(); G.listening = true; rerender();
};
async function setOpt(patch) { if (G.chat) { G.chat = await api('PATCH', '/api/chats/' + G.chat.id, patch); } else Object.assign(G.newOpts, patch); rerender(); }
acts['pick-sources'] = el => {
  const B = S.boot, cur = (G.chat || G.newOpts).sources, mine = B.collections.filter(c => B.gptCollectionIds.includes(c.id));
  menu(el, [{ heading: 'Answer from' }, { label: 'All knowledge', icon: 'library_books', on: cur === 'all', run: () => setOpt({ sources: 'all' }) },
    ...mine.map(c => ({ label: c.name, sub: c.docCount + ' documents', icon: 'folder_open', on: Array.isArray(cur) && cur.includes(c.id), run: () => { const l = Array.isArray(cur) ? [...cur] : []; const i = l.indexOf(c.id); if (i < 0) l.push(c.id); else l.splice(i, 1); return setOpt({ sources: l.length ? l : 'all' }); } })),
    '-', { label: 'No knowledge', sub: 'The model answers on its own', icon: 'block', on: cur === 'none', run: () => setOpt({ sources: 'none' }) }]);
};
acts.prompts = el => {
  const B = S.boot, put = t => { G.draftText = t; G.focus = true; rerender(); };
  menu(el, [{ heading: 'Saved prompts' }, ...B.prompts.map(p => ({ label: p.title, sub: p.shared ? 'Shared by ' + p.byName : 'Only you', icon: 'bolt', run: () => put(p.text) })),
    !B.prompts.length && { label: 'None yet', sub: 'Type something, then save it here', icon: 'info_outline', run: () => {} }, '-',
    { label: 'Save what I typed', icon: 'bookmark_add', run: () => { if (!G.draftText.trim()) return toast('Type the prompt in the box first.'); modal({ title: 'Save prompt', body: `<div class="stack"><label class="field"><span>Name</span><input class="input" id="f-title" maxlength="60" placeholder="Summarise in five points"></label>${B.admin ? `<label class="row" style="gap:8px;font-weight:500"><input type="checkbox" id="f-shared"> Share with everyone who has VanikGPT</label>` : ''}</div>`, actions: [{ label: 'Save', run: async o => { await api('POST', '/api/prompts', { title: $('#f-title', o).value, text: G.draftText, shared: !!($('#f-shared', o) && $('#f-shared', o).checked) }); toast('Prompt saved.'); await refresh(); } }] }); } },
    B.prompts.some(p => p.userId === B.me.id || B.admin) && { label: 'Remove a prompt', icon: 'delete_outline', run: () => menu(el, [{ heading: 'Remove' }, ...B.prompts.filter(p => p.userId === B.me.id || B.admin).map(p => ({ label: p.title, icon: 'delete_outline', danger: true, run: async () => { await api('DELETE', '/api/prompts/' + p.id); await refresh(); } }))]) }]);
};
acts['edit-cancel'] = () => { G.editOf = null; G.draftText = ''; rerender(); };
acts['msg-edit'] = el => { const m = findMsg(el.dataset.id); G.editOf = m.id; G.draftText = m.content; G.focus = true; rerender(); };
// Models in two groups: on this appliance, and outside the network. "Think harder" sits with them.
const outsideOf = id => (S.boot.outsideModels || []).find(m => m.id === id);
acts['pick-model'] = el => {
  const B = S.boot, o = G.chat || G.newOpts, cur = (G.chat ? G.chat.model : G.newOpts.model) || B.app.config.defaultModel, out = B.outsideModels || [];
  menu(el, [{ heading: 'On this appliance' }, ...B.app.config.models.map(id => { const m = B.models.find(x => x.id === id); return { label: id, sub: m && m.status === 'serving' ? (m.note || 'Stays inside your network') : 'Parked. Answers come from documents only.', icon: 'memory', on: id === cur, run: () => setOpt({ model: id }) }; }),
    ...(out.length && !assistantOf(o.assistantId) ? [{ heading: 'Outside your network' }, ...out.map(m => ({ label: m.name, sub: `${m.provider} · ${m.tags.join(', ')} · your question leaves the appliance`, icon: 'public', on: m.id === cur, run: () => setOpt({ model: m.id }) }))] : []),
    '-', { label: 'Think harder', sub: 'More sources and a longer answer. Slower.', icon: 'psychology', on: (o.effort || 'balanced') === 'thorough', run: () => setOpt({ effort: (o.effort || 'balanced') === 'thorough' ? 'balanced' : 'thorough' }) }]);
};
async function ensureChat() {
  if (G.chat) return G.chat;
  G.chat = await api('POST', '/api/chats', G.newOpts); G.chatId = G.chat.id; G.newOpts = { model: null, sources: 'all', assistantId: null, effort: 'balanced' };
  return G.chat;
}
async function attachFiles(files) {
  if (!files.length) return;
  if (!S.boot.app.config.safety.uploads) return toast('Your admin has turned off file uploads in chat.', 'err');
  const c = await ensureChat();
  if (location.hash !== '#/gpt/c/' + c.id) { history.replaceState(null, '', '#/gpt/c/' + c.id); rerender(); }
  await uploadFiles(`/api/chats/${c.id}/files`, files);
  G.chat = await api('GET', '/api/chats/' + c.id); await refresh();
}
acts.attach = async () => attachFiles(await pickFiles());
acts['attach-folder'] = async () => {
  const all = await new Promise(ok => { const i = document.createElement('input'); i.type = 'file'; i.webkitdirectory = true; i.multiple = true; i.onchange = () => ok([...i.files]); i.click(); });
  if (!all.length) return;
  const okExt = FILE_ACCEPT.split(','), good = all.filter(f => okExt.includes('.' + f.name.split('.').pop().toLowerCase())).slice(0, 50);
  if (!good.length) return toast('That folder has no files VanikGPT can read.', 'err');
  if (good.length < all.length) toast(`${all.length - good.length} files left out: a type that cannot be read, or over the 50 file limit.`);
  await attachFiles(good);
};
for (const ev of ['dragover', 'dragleave', 'drop']) document.addEventListener(ev, e => { const z = e.target.closest && e.target.closest('[data-chatdrop]'); if (!z) return; e.preventDefault(); z.classList.toggle('over', ev === 'dragover'); if (ev === 'drop' && e.dataTransfer.files.length) attachFiles([...e.dataTransfer.files]); });
document.addEventListener('paste', e => { if (e.target.id === 'q' && e.clipboardData.files.length) { e.preventDefault(); attachFiles([...e.clipboardData.files]); } });
acts['file-remove'] = async el => { await api('DELETE', '/api/documents/' + el.dataset.id); G.chat = await api('GET', '/api/chats/' + G.chat.id); rerender(); };

// ---------- sending and streaming
async function stream(chat, body, route = 'messages') {
  const st = G.streaming = { chatId: chat.id, text: '', userText: body.content || '', meta: null, activity: [], ctrl: new AbortController() };
  G.toBottom = true; rerender();
  try {
    const r = await fetch(`/api/chats/${chat.id}/${route}`, { method: 'POST', signal: st.ctrl.signal, headers: { 'Content-Type': 'application/json', 'X-User': S.userId }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Could not send.');
    const reader = r.body.getReader(), dec = new TextDecoder(); let buf = '';
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const frame = buf.slice(0, i); buf = buf.slice(i + 2);
        const ev = (frame.match(/^event: (.*)$/m) || [])[1], data = JSON.parse((frame.match(/^data: (.*)$/m) || [, '{}'])[1]);
        if (ev === 'meta') { st.meta = data; chat.title = data.title; if (!body.regenerate && route === 'messages') { chat.messages.push(data.userMessage); st.userText = ''; rerender(); } }
        else if (ev === 'activity') { const k = st.activity.findIndex(x => x.id === data.id); if (k < 0) st.activity.push(data); else st.activity[k] = data; const el = $('#live-act'); if (el) { el.innerHTML = activityHtml(st.activity); const sc = $('#scroll'); sc.scrollTop = sc.scrollHeight; } }
        else if (ev === 'delta') { st.text += data.t; const dd = $('#live-dots'); if (dd) dd.remove(); const el = $('#live-md'); if (el) { const sc = $('#scroll'), near = sc.scrollHeight - sc.scrollTop - sc.clientHeight < 120; el.innerHTML = md(st.text); if (near) sc.scrollTop = sc.scrollHeight; } }
        else if (ev === 'done') { chat.messages.push(data.message); chat.pending = data.message.interrupt ? { id: data.message.interrupt.id } : null; }
      }
    }
  } catch (e) {
    if (e.name !== 'AbortError') toast(e.message, 'err');
    await new Promise(r => setTimeout(r, 250));
    try { const fresh = await api('GET', '/api/chats/' + chat.id); if (G.chat && G.chat.id === chat.id) G.chat = fresh; } catch { /* chat is gone */ }
  }
  G.streaming = null; G.toBottom = true; G.focus = true;
  await refresh();
}
acts.job = async el => { if (G.streaming) return; G.newOpts.assistantId = el.dataset.id; G.draftText = el.dataset.text; await acts.send(); };
acts['temp-toggle'] = () => { G.newOpts.temp = !G.newOpts.temp; rerender(); };
acts.send = async el => {
  if (G.streaming) return;
  const text = (el && el.dataset.text) || G.draftText.trim();
  if (!text) return;
  const c = await ensureChat();
  G.draftText = '';
  if (location.hash !== '#/gpt/c/' + c.id) history.replaceState(null, '', '#/gpt/c/' + c.id);
  const body = { content: text };
  if (G.editOf) { const i = c.messages.findIndex(m => m.id === G.editOf); if (i >= 0) { c.messages.length = i; body.editOf = G.editOf; } G.editOf = null; }
  await stream(c, body);
};
acts.stop = () => { if (G.streaming) G.streaming.ctrl.abort(); };
acts['int-allow'] = async () => { if (G.streaming || !G.chat) return; const box = $('#int-code'), code = box ? box.value.trim() : ''; if (box && !code) { box.focus(); return toast('Type the code first.'); } while (G.chat.messages.length && G.chat.messages[G.chat.messages.length - 1].role === 'assistant') G.chat.messages.pop(); await stream(G.chat, { allow: true, code }, 'resume'); };
acts['int-deny'] = async () => { if (G.streaming || !G.chat) return; while (G.chat.messages.length && G.chat.messages[G.chat.messages.length - 1].role === 'assistant') G.chat.messages.pop(); await stream(G.chat, { allow: false }, 'resume'); };
acts['allow-site'] = async el => { await api('POST', '/api/app/allow-site', { host: el.dataset.host }); toast(el.dataset.host + ' is now allowed. Asking again.'); await load(); acts.regen(); };
// Replays a browser run step by step: each frame fades in, the tap lands where the agent clicked, the caption says what it did.
acts['shot-open'] = el => {
  const fr = FRAMES.get(el.dataset.key) || []; if (!fr.length) return;
  const many = fr.length > 1; let i = -1, playing = many, t = null;
  const m = modal({ title: 'What the browser did', wide: true, cancel: 'Close', body: `<div class="replay"><div class="stage"><img alt=""><img alt=""><i class="tap"></i></div>
    <div class="cap"><span class="num"></span><div class="grow"><b></b><div class="small muted res"></div></div></div><div class="mono ellipsis url"></div>
    ${many ? `<div class="bar"><button class="icon-btn" data-r="prev" aria-label="Previous step">${icon('skip_previous')}</button><button class="icon-btn bordered" data-r="play" aria-label="Play or pause">${icon('pause')}</button><button class="icon-btn" data-r="next" aria-label="Next step">${icon('skip_next')}</button><div class="segs">${fr.map((_, k) => `<button data-r="go" data-k="${k}" aria-label="Step ${k + 1}"><i></i></button>`).join('')}</div></div>` : ''}</div>` });
  const o = m.el, imgs = [...o.querySelectorAll('.stage img')], tap = $('.tap', o), q = x => $(x, o);
  const show = k => {
    if (!o.isConnected) return;
    i = (k + fr.length) % fr.length; const f = fr[i], next = imgs[i % 2], prev = imgs[(i + 1) % 2];
    next.src = f.shot; next.classList.add('on'); prev.classList.remove('on');
    tap.classList.remove('go'); if (f.at) { tap.style.left = f.at[0] / 10.24 + '%'; tap.style.top = f.at[1] / 6.4 + '%'; void tap.offsetWidth; tap.classList.add('go'); }
    q('.num').textContent = many ? `${i + 1}/${fr.length}` : ''; q('.cap b').textContent = f.label; q('.res').textContent = f.result || ''; q('.url').textContent = f.url || '';
    o.querySelectorAll('.segs button').forEach((b, n) => { b.className = n < i ? 'done' : n === i ? (playing ? 'now run' : 'now') : ''; });
    clearTimeout(t); if (playing) t = setTimeout(() => { if (i === fr.length - 1) { playing = false; q('[data-r=play] .mi').textContent = 'replay'; show(i); } else show(i + 1); }, 1900);
  };
  o.addEventListener('click', e => {
    const b = e.target.closest('[data-r]'); if (!b) return;
    if (b.dataset.r === 'play') { playing = !playing; q('[data-r=play] .mi').textContent = playing ? 'pause' : 'play_arrow'; show(playing && i === fr.length - 1 ? 0 : i); }
    else { playing = false; q('[data-r=play] .mi').textContent = 'play_arrow'; show(b.dataset.r === 'go' ? +b.dataset.k : i + (b.dataset.r === 'next' ? 1 : -1)); }
  });
  show(many ? 0 : fr.length - 1);
};
acts.regen = async () => { if (G.streaming || !G.chat) return; while (G.chat.messages.length && G.chat.messages[G.chat.messages.length - 1].role === 'assistant') G.chat.messages.pop(); await stream(G.chat, { regenerate: true }); };

// ---------- messages
const TOOL_ICON = { calculator: 'calculate', gst: 'verified', tables: 'table_chart', browser: 'public', screen: 'mouse', connector: 'hub' };
const FRAMES = new Map();
function activityHtml(list) {
  if (!list || !list.length) return '';
  const shot = [...list].reverse().find(a => a.shot), frames = list.filter(a => a.shot);
  if (shot) FRAMES.set(list[0].id, frames);
  return `<div class="act">${list.map(a => `<div class="act-row ${a.state}"><span class="dot">${a.state === 'done' ? icon('check') : a.state === 'failed' ? icon('close') : a.state === 'waiting' ? icon('pan_tool') : ''}</span>${icon(TOOL_ICON[a.tool] || 'extension')}<span class="grow"><b>${esc(a.label)}</b>${a.result ? `<span class="small muted"> · ${esc(String(a.result).slice(0, 150))}</span>` : ''}</span></div>`).join('')}
    ${shot ? `<button class="shot" data-act="shot-open" data-key="${list[0].id}" aria-label="Replay what the browser did"><img src="${shot.shot}" alt="What the sandboxed browser shows"><span class="row"><span class="mono ellipsis grow">${esc(shot.url || '')}</span>${frames.length > 1 ? `<span class="replay-tag">${icon('play_arrow')}Replay ${frames.length} steps</span>` : ''}</span></button>` : ''}</div>`;
}
const NOTE = {
  model_unreachable: 'The model could not be reached, so this answer is built straight from your documents.',
  model_parked: 'The model for this chat is parked, so this answer is built straight from your documents.',
};
function shownCites(m) { const used = new Set([...String(m.content).matchAll(/\[(\d{1,2})\]/g)].map(x => +x[1])); const c = m.citations || []; const hit = c.filter(x => used.has(x.n)); return hit.length ? hit : c; }
function msgHtml(m, last, readOnly) {
  if (m.role === 'user') return `<div class="msg user"><div class="bubble">${esc(m.content)}</div>${m.pii && m.pii.length ? `<div class="under"><span class="chip ${m.piiMode === 'mask' ? 'ok' : 'warn'} tip-left" tabindex="0" data-tip="${m.piiMode === 'mask' ? 'These were replaced before the question reached the model or was saved.' : 'Your admin has chosen to flag personal data. The question was sent as typed.'}">${icon('shield')}${m.piiMode === 'mask' ? 'Masked' : 'Contains'}: ${esc(m.pii.join(', '))}</span></div>` : ''}${readOnly ? '' : `<div class="under"><button class="icon-btn sm edit tip-left" data-act="msg-edit" data-id="${m.id}" data-tip="Edit and ask again" aria-label="Edit and ask again">${icon('edit')}</button></div>`}</div>`;
  if (m.mode === 'blocked') return `<div class="msg bot" data-mid="${m.id}"><span class="app-ico">${icon('forum')}</span><div class="body"><div class="note">${icon('block')}<span>This question touches a topic your admin has blocked. It was not answered and was not sent to the model.</span></div></div></div>`;
  const cites = m.mode === 'unavailable' ? [] : shownCites(m), secs = m.ms ? (m.ms / 1000).toFixed(1) + ' s' : '';
  const askCard = !m.ask ? '' : last && !readOnly ? `<div class="opts" style="max-width:420px;margin:4px 0 10px">${m.ask.options.map(o => `<button class="opt" data-act="ask-pick" data-send="${esc(o.send)}"><span class="grow"><b>${esc(o.label)}</b></span>${icon('arrow_forward')}</button>`).join('')}<span class="small faint">Or type your own answer below.</span></div>` : '';
  const waiting = m.interrupt && !readOnly && G.chat && G.chat.pending && G.chat.pending.id === m.interrupt.id;
  const gate = !m.interrupt ? '' : waiting ? `<div class="card gate"><div class="row" style="align-items:flex-start">${icon(m.interrupt.kind === 'otp' ? 'pin' : m.interrupt.kind === 'signin' ? 'lock' : 'pan_tool')}<div class="grow"><b>${m.interrupt.kind === 'otp' || m.interrupt.kind === 'signin' ? '' : 'The agent wants to: '}${esc(m.interrupt.reason)}</b><div class="small muted">${esc(m.interrupt.detail || '')}${S.boot.sample && m.interrupt.kind === 'otp' ? ' On the sample portal any 6 digits work.' : ''}</div></div></div><div class="row wrap" style="margin-top:12px">${m.interrupt.kind === 'otp' ? `<input class="input" id="int-code" inputmode="numeric" autocomplete="one-time-code" maxlength="8" placeholder="6 digit code" aria-label="One-time code" style="width:150px">` : ''}<button class="btn" data-act="int-allow">${m.interrupt.kind === 'otp' ? 'Continue' : m.interrupt.kind === 'signin' ? 'I have signed in' : 'Allow once'}</button><button class="btn ghost" data-act="int-deny">${m.interrupt.kind === 'step' || !m.interrupt.kind ? 'Do not allow' : 'Stop'}</button></div></div>` : `<p class="small faint">Asked for a go-ahead: ${esc(m.interrupt.reason)}. No longer waiting.</p>`;
  const toolErr = m.toolError ? `<div class="note">${icon('error_outline')}<span>${esc(m.toolError)}${m.blockedHost && S.boot.admin && !readOnly ? ` <button class="link" data-act="allow-site" data-host="${esc(m.blockedHost)}">Allow ${esc(m.blockedHost)}</button>` : m.blockedHost ? ' An admin can add it in Setup.' : ''}</span></div>` : '';
  const body = m.mode === 'unavailable'
    ? `<div class="note">${icon('error_outline')}<span>The model could not be reached and nothing in your documents matches this question.${S.boot.admin ? ` <a class="link" href="#/os/apps/vanikgpt/overview">Check VanikGPT health</a>` : ' Try again in a bit, or tell your admin.'}</span></div>`
    : `${activityHtml(m.activity)}${toolErr}${m.notice ? `<div class="note">${icon('info_outline')}<span>${NOTE[m.notice]}</span></div>` : ''}${m.content ? `<div class="md">${md(m.content)}</div>` : ''}${askCard}${gate}${last && !readOnly && (m.followUps || []).length ? `<div class="row wrap follow" style="gap:6px;margin:2px 0 10px">${m.followUps.map(q => `<button class="tag" data-act="send" data-text="${esc(q)}">${icon('subdirectory_arrow_right')}${esc(q)}</button>`).join('')}</div>` : ''}${m.stopped ? `<p class="small faint">Stopped.</p>` : ''}`;
  return `<div class="msg bot" data-mid="${m.id}"><span class="app-ico">${icon('forum')}</span><div class="body">${body}
    ${cites.length ? `<div class="sources">${cites.map(c => `<a class="source" href="#/gpt/source/${c.docId}/${c.chunkId}/${G.chat ? G.chat.id : 'x'}" title="${esc(c.snippet)}"><b>${c.n}</b><span class="ellipsis">${esc(c.docName)}${c.page ? ' · p. ' + c.page : ''}</span></a>`).join('')}</div>` : ''}
    ${readOnly ? '' : `<div class="msg-actions">
      ${m.content ? `<button class="icon-btn sm" data-act="msg-copy" data-id="${m.id}" data-tip="Copy" aria-label="Copy">${icon('content_copy')}</button>` : ''}
      ${last ? `<button class="icon-btn sm" data-act="regen" data-tip="Answer again" aria-label="Answer again">${icon('refresh')}</button>` : ''}
      <button class="icon-btn sm ${m.feedback === 'up' ? 'on' : ''}" data-act="msg-up" data-id="${m.id}" data-tip="Helpful" aria-label="Helpful">${icon('thumb_up_off_alt')}</button>
      <button class="icon-btn sm ${m.feedback === 'down' ? 'on' : ''}" data-act="msg-down" data-id="${m.id}" data-tip="Not helpful" aria-label="Not helpful">${icon('thumb_down_off_alt')}</button>
      ${m.content ? `<button class="icon-btn sm" data-act="msg-more" data-id="${m.id}" data-tip="More" aria-label="More">${icon('more_horiz')}</button>` : `<button class="icon-btn sm" data-act="msg-details" data-id="${m.id}" data-tip="How this answer was made" aria-label="How this answer was made">${icon('insights')}</button>`}
      <span class="mono" style="margin-left:8px">${esc([m.outside ? 'outside: ' + String(m.model || '').replace(/^out:[a-z]+\//, '') : m.mode === 'model' ? m.model || '' : m.mode === 'documents' ? 'documents only' : m.mode === 'tool' ? 'abilities' : m.mode === 'search' ? 'search only' : '', m.effort && m.effort !== 'balanced' ? m.effort : '', secs].filter(Boolean).join(' · '))}</span>
    </div>`}</div></div>`;
}
const findMsg = id => G.chat.messages.find(m => m.id === id);
export const chatNow = () => G.chat;
acts['msg-details'] = el => {
  const m = findMsg(el.dataset.id), b = m.budget, c = m.citations || [], VIA = { keyword: 'Keyword', meaning: 'Meaning', both: 'Keyword and meaning' };
  const parts = b ? [['Instructions', b.system, '#8a8b84'], ['Sources', b.passages, '#1fa350'], ['Earlier messages', b.history, '#3b6fd6'], ['Kept for the answer', b.output, '#c79a2b']] : [];
  modal({ title: 'How this answer was made', wide: true, cancel: 'Close', body: `<dl class="kv"><dt>Written by</dt><dd>${m.mode === 'model' ? esc(m.model) : m.mode === 'tool' ? 'Abilities, without the model' : m.mode === 'search' ? 'Search only: passages, no written answer' : 'Built from matching passages, without the model'}</dd><dt>Effort</dt><dd>${EFFORT[m.effort || 'balanced'][0]}</dd>${m.rules || m.memories || m.chatRules ? `<dt>Also given</dt><dd>${[m.chatRules && 'Instructions for this chat', m.rules && 'House rules from your admin', m.memories && `${m.memories} ${m.memories === 1 ? 'thing' : 'things'} you asked it to remember`].filter(Boolean).join(' · ')}</dd>` : ''}${(m.activity || []).length ? `<dt>Steps</dt><dd>${m.activity.map(a => esc(a.label)).join(' → ')}</dd>` : ''}<dt>Time</dt><dd>${m.ms ? (m.ms / 1000).toFixed(1) + ' s' : 'Not recorded'}</dd><dt>Size</dt><dd>${(m.tokensIn || 0).toLocaleString()} tokens in, ${(m.tokensOut || 0).toLocaleString()} out</dd></dl>
    ${c.length ? `<h3 style="margin:18px 0 8px">Passages it was given</h3>${c.map(x => `<div class="set-row"><b class="cite" style="cursor:default">${x.n}</b><div class="grow"><div class="ellipsis">${esc(x.docName)}${x.page ? ' · page ' + x.page : ''}</div><div class="small muted">${esc(x.snippet.slice(0, 110))}…</div></div>${chip(VIA[x.via] || 'Keyword', 'line', false)}${chip(x.strength || 'Good', x.strength === 'Strong' ? 'ok' : x.strength === 'Weak' ? 'warn' : '', false)}</div>`).join('')}` : `<p class="muted" style="margin-top:16px">No passage from your documents matched this question.</p>`}
    ${b ? `<h3 style="margin:18px 0 8px">Room used in the model's memory ${info('The model can read ' + b.context.toLocaleString() + ' tokens at once. Half is kept for sources, a quarter for earlier messages.')}</h3><div class="budget">${parts.map(p => `<i style="width:${Math.max(0.5, 100 * p[1] / b.context)}%;background:${p[2]}"></i>`).join('')}</div><div class="legend">${parts.map(p => `<span style="--c:${p[2]}">${p[0]} ${p[1].toLocaleString()}</span>`).join('')}</div>${b.summarized ? `<p class="small muted" style="margin-top:10px">${b.summarized} earlier messages were folded into a short summary to save room.</p>` : ''}` : ''}` });
};
const tableOf = el => [...el.closest('.tbl').querySelectorAll('tr')].map(r => [...r.children].map(c => c.innerText.trim()));
const csvOf = rows => rows.map(r => r.map(c => /[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c).join(',')).join('\n');
acts['tbl-copy'] = async el => { await navigator.clipboard.writeText(tableOf(el).map(r => r.join('\t')).join('\n')); toast('Table copied. Paste it into a spreadsheet.'); };
acts['tbl-csv'] = el => downloadText('table.csv', csvOf(tableOf(el)), 'text/csv');
document.addEventListener('keydown', e => { if (e.altKey && e.key.toLowerCase() === 'c' && G.chat) { const m = [...G.chat.messages].reverse().find(x => x.role === 'assistant' && x.content); if (m) { e.preventDefault(); navigator.clipboard.writeText(m.content).then(() => toast('Last answer copied.')); } } });
acts.cite = el => { if (!G.chat) return; const m = findMsg(el.closest('.msg').dataset.mid), c = m && (m.citations || []).find(x => x.n === +el.dataset.n); if (c) go(`#/gpt/source/${c.docId}/${c.chunkId}/${G.chat.id}`); };
acts['msg-copy'] = async el => { await navigator.clipboard.writeText(findMsg(el.dataset.id).content); toast('Copied.'); };
const rate = async (id, value, extra = {}) => { await api('POST', `/api/chats/${G.chat.id}/messages/${id}/feedback`, { value, ...extra }); findMsg(id).feedback = value; rerender(); };
acts['msg-up'] = el => rate(el.dataset.id, findMsg(el.dataset.id).feedback === 'up' ? null : 'up');
acts['msg-down'] = el => {
  const id = el.dataset.id; if (findMsg(id).feedback === 'down') return rate(id, null);
  let reason = 'Wrong answer';
  const m = modal({ title: 'What went wrong?', text: 'Your admin sees the reason and your note, not the chat.', body: `<div class="stack"><div class="row wrap" style="gap:6px" id="f-reason">${['Wrong answer', 'Missing source', 'Too slow', 'Other'].map((r, i) => `<button class="tag ${i ? '' : 'on'}" data-v="${r}">${r}</button>`).join('')}</div><textarea class="input" id="f-note" rows="3" placeholder="Anything that helps fix it (optional)"></textarea></div>`,
    actions: [{ label: 'Send', run: o => rate(id, 'down', { reason, note: $('#f-note', o).value }) }] });
  $('#f-reason', m.el).onclick = e => { const b = e.target.closest('button'); if (!b) return; reason = b.dataset.v; [...b.parentNode.children].forEach(x => x.classList.toggle('on', x === b)); };
};

// ---------- chat pages
function pageNew(assistantId) {
  const B = S.boot;
  G.chat = null; G.chatId = null; G.newOpts.assistantId = assistantId && assistantOf(assistantId) ? assistantId : null;
  if (G.newOpts.temp === undefined) G.newOpts.temp = localStorage.getItem('vnk.tempDefault') === '1';
  const as = assistantOf(G.newOpts.assistantId), shared = B.assistants.slice(0, 4);
  G.focus = true;
  return gptShell('', `<div class="gpt-top">${navToggle()}<h3 class="grow">${as ? esc(as.name) : 'New chat'}</h3>${as ? `<a class="btn text" href="#/gpt">${icon('close')}Leave agent</a>` : ''}</div>
    <div class="scroll" id="scroll" style="display:flex;flex-direction:column"><div class="hero">
      <h1>${as ? esc(as.name) : 'What do you want to get done?'}</h1>${as && as.description ? `<p class="muted" style="text-align:center;margin:-14px 24px 22px">${esc(as.description)}</p>` : ''}
      ${composer()}
      ${as && as.workflow ? `<p style="text-align:center;margin-top:14px"><a class="btn ghost" href="#/gpt/flows/new/${as.workflow}">${icon('fact_check')}Run the full check on files</a></p>` : ''}
      <div class="starters">${as ? as.starters.map(s => `<button class="tag" style="padding:7px 12px" data-act="send" data-text="${esc(s)}">${esc(s)}</button>`).join('') : ''}</div>
      ${as ? '' : `<div class="jobs">${B.assistants.filter(a => (a.starters || []).length).slice(0, 3).map(a => `<button class="job" data-act="job" data-id="${a.id}" data-text="${esc(a.starters[0])}"><span class="avatar sq">${icon(a.icon || 'smart_toy')}</span><span class="grow"><span class="small muted">${esc(a.name)}</span><b>${esc((a.starters[0][0] === '/' ? a.description : a.starters[0]).slice(0, 96))}</b></span>${icon('arrow_forward')}</button>`).join('')}</div>`}
    </div></div>`);
}
function pageChat(id) {
  if (G.chatId !== id) { G.chatId = id; G.chat = null; G.editOf = null; G.toBottom = true; G.focus = true; api('GET', '/api/chats/' + id).then(c => { if (G.chatId === id) { G.chat = c; rerender(); } }).catch(() => { toast('That chat no longer exists.', 'err'); go('#/gpt'); }); }
  const c = G.chat;
  if (!c) return gptShell('', `<div class="gpt-top">${navToggle()}<h3>&nbsp;</h3></div><div class="scroll" id="scroll"></div>`);
  const as = assistantOf(c.assistantId), st = G.streaming && G.streaming.chatId === c.id ? G.streaming : null;
  const lastBot = [...c.messages].reverse().find(m => m.role === 'assistant');
  return gptShell('', `<div class="gpt-top">${navToggle()}<h3 class="ellipsis grow">${esc(c.title)}</h3>${c.temp ? chip('Temporary', 'warn', false) : ''}${as ? chip(as.name, 'line', false) : ''}${c.shared ? `<button class="chip ok tip-down tip-left" data-act="share-copy" data-id="${c.id}" data-tip="Anyone with VanikGPT can read this chat with the link. Click to copy it.">${icon('group')}Shared</button>` : ''}<button class="icon-btn" data-act="chat-menu" data-id="${c.id}" aria-label="Chat options">${icon('more_horiz')}</button></div>
    <div class="scroll" id="scroll"><div class="thread">
      ${c.messages.map(m => msgHtml(m, !st && lastBot && m.id === lastBot.id)).join('')}
      ${st && st.userText ? `<div class="msg user"><div class="bubble">${esc(st.userText)}</div></div>` : ''}
      ${st ? `<div class="msg bot"><span class="app-ico">${icon('forum')}</span><div class="body"><div id="live-act">${activityHtml(st.activity)}</div>${st.text || st.activity.length ? '' : `<div class="dots" id="live-dots"><i></i><i></i><i></i></div>`}<div class="md caret" id="live-md">${md(st.text)}</div><div class="msg-actions"></div></div></div>` : ''}
    </div></div>${composer()}`);
}
const shareLink = id => location.origin + '/#/gpt/shared/' + id;
acts['share-copy'] = async el => { await navigator.clipboard.writeText(shareLink(el.dataset.id)); toast('Link copied.'); };
function pageShared(id) {
  if (G.sharedKey !== id) { G.sharedKey = id; G.shared = null; api('GET', '/api/shared/' + id).then(c => { G.shared = c; rerender(); }).catch(e => { G.shared = { error: e.message }; rerender(); }); }
  const c = G.shared;
  if (!c) return gptShell('', `<div class="gpt-top">${navToggle()}<h3>&nbsp;</h3></div><div class="scroll" id="scroll"></div>`);
  if (c.error) return gptShell('', `<div class="gpt-top">${navToggle()}<h3>Shared chat</h3></div><div class="scroll" id="scroll"><div class="page"><div class="empty">${icon('lock')}${esc(c.error)}</div></div></div>`);
  G.chat = null; G.chatId = null;
  const view = { id: c.id };
  return gptShell('', `<div class="gpt-top">${navToggle()}<h3 class="ellipsis grow">${esc(c.title)}</h3>${chip((c.asAdmin ? 'Chat of ' : 'Shared by ') + c.ownerName, c.asAdmin ? 'warn' : 'line', false)}${c.mine ? `<a class="btn ghost" href="#/gpt/c/${c.id}">Open my chat</a>` : ''}</div>
    <div class="scroll" id="scroll"><div class="thread">${c.messages.map(m => msgHtml(m, false, true).replace(/#\/gpt\/source\/([^/]+)\/([^/]+)\/[^"]*/g, '#/gpt/source/$1/$2/shared-' + view.id)).join('')}</div>
    <p class="small faint" style="text-align:center;padding:10px 0 24px">Read-only. Sources open only if you have access to them.</p></div>`);
}
acts['folder-menu'] = el => { const f = S.boot.folders.find(x => x.id === el.dataset.id); menu(el, [{ label: 'Rename', icon: 'edit', run: () => modal({ title: 'Rename folder', body: `<input class="input" id="f-name" maxlength="40" value="${esc(f.name)}" aria-label="Folder name">`, actions: [{ label: 'Save', run: async o => { await api('PUT', '/api/folders/' + f.id, { name: $('#f-name', o).value }); await refresh(); } }] }) }, '-', { label: 'Delete folder', sub: 'Its chats are kept', icon: 'delete_outline', danger: true, run: async () => { await api('DELETE', '/api/folders/' + f.id); await refresh(); } }]); };
// Read an answer aloud with the browser's own voice. Nothing is sent anywhere.
acts['msg-speak'] = el => { const sy = window.speechSynthesis; if (!sy) return toast('This browser cannot read aloud.', 'err'); if (sy.speaking) { sy.cancel(); return; } const u = new SpeechSynthesisUtterance(findMsg(el.dataset.id).content.replace(/```[\s\S]*?```/g, ' code block ').replace(/\|[-| ]+\|/g, ' ').replace(/[*#|`]|\[\d{1,2}\]/g, ' ').slice(0, 4000)); u.lang = navigator.language || 'en-IN'; sy.speak(u); };
acts.regenWith = async model => { if (G.streaming || !G.chat) return; while (G.chat.messages.length && G.chat.messages[G.chat.messages.length - 1].role === 'assistant') G.chat.messages.pop(); G.chat.model = model; await stream(G.chat, { regenerate: true, model }); };
acts['chat-menu'] = el => {
  const id = el.dataset.id, c = S.boot.chats.find(x => x.id === id) || G.chat; if (!c) return;
  const patch = async p => { const r = await api('PATCH', '/api/chats/' + id, p); if (G.chat && G.chat.id === id) G.chat = r; await refresh(); };
  menu(el, [
    { label: 'Rename', icon: 'edit', run: () => modal({ title: 'Rename chat', body: `<input class="input" id="f-title" maxlength="120" value="${esc(c.title)}" aria-label="Chat name">`, actions: [{ label: 'Save', run: o => patch({ title: $('#f-title', o).value }) }] }) },
    { label: c.pinned ? 'Unpin' : 'Pin', icon: 'push_pin', run: () => patch({ pinned: !c.pinned }) },
    { label: 'Move to a folder', icon: 'folder', run: () => menu(el, [...(S.boot.folders || []).map(f => ({ label: f.name, icon: 'folder', on: c.folderId === f.id, run: () => patch({ folderId: f.id }) })), c.folderId && { label: 'No folder', icon: 'folder_off', run: () => patch({ folderId: null }) }, '-', { label: 'New folder', icon: 'create_new_folder', run: () => modal({ title: 'New folder', body: `<input class="input" id="f-name" maxlength="40" placeholder="Supplier reviews" aria-label="Folder name">`, actions: [{ label: 'Create', run: async o => { const f = await api('POST', '/api/folders', { name: $('#f-name', o).value }); await patch({ folderId: f.id }); } }] }) }]) },
    G.chat && G.chat.id === id && { label: 'Instructions for this chat', sub: G.chat.system ? 'Set' : 'Tone, role or limits', icon: 'tune', run: () => modal({ title: 'Instructions for this chat', body: `<label class="field"><span>Followed in this chat only ${info('Added on top of the house rules and the agent, if any. For example: answer as a checklist, or reply in Hindi.')}</span><textarea class="input" id="f-sys" rows="4" maxlength="2000">${esc(G.chat.system || '')}</textarea></label>`, actions: [{ label: 'Save', run: o => patch({ system: $('#f-sys', o).value }) }] }) },
    c.shared ? { label: 'Stop sharing', icon: 'group_off', run: () => patch({ shared: false }) } : { label: 'Share with colleagues', sub: 'Read-only, for people with VanikGPT', icon: 'group', run: async () => { await patch({ shared: true }); await navigator.clipboard.writeText(shareLink(id)).catch(() => {}); toast('Shared. The link is copied.'); } },
    { label: 'Archive', icon: 'inventory_2', run: async () => { await patch({ archived: true }); toast('Archived. Find it under Settings, Archived Chats.'); if (G.chatId === id) { G.chat = null; G.chatId = null; go('#/gpt'); } } },
    { label: 'Export', sub: 'Download as Markdown', icon: 'download', run: async () => { const r = await api('GET', `/api/chats/${id}/export`); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([r.markdown], { type: 'text/markdown' })); a.download = r.name + '.md'; a.click(); URL.revokeObjectURL(a.href); } },
    '-', { label: 'Delete', icon: 'delete_outline', danger: true, run: () => confirmBox('Delete this chat?', 'The chat and any files attached to it are removed. This cannot be undone.', 'Delete', async () => { await api('DELETE', '/api/chats/' + id); await load(); if (G.chatId === id) { G.chat = null; G.chatId = null; go('#/gpt'); } else rerender(); }) },
  ]);
};

// ---------- source viewer (a full page, with a way back)
function pageSource(docId, chunkId, from) {
  const key = docId;
  if (G.docKey !== key) { G.docKey = key; G.doc = null; api('GET', '/api/documents/' + docId).then(d => { if (G.docKey === key) { G.doc = d; rerender(); } }).catch(e => { G.doc = { error: e.message }; rerender(); }); }
  const d = G.doc, inOs = from === 'os';
  const back = !d || d.error ? (inOs ? '#/os/knowledge' : from.startsWith('shared-') ? '#/gpt/shared/' + from.slice(7) : '#/gpt') : inOs ? '#/os/knowledge/' + d.collectionId : from === 'k' ? '#/gpt/knowledge/' + d.collectionId : from.startsWith('shared-') ? '#/gpt/shared/' + from.slice(7) : '#/gpt/c/' + from;
  const backLabel = inOs || from === 'k' ? 'Back to collection' : 'Back to chat';
  let body;
  if (!d) body = `<p class="muted">Loading…</p>`;
  else if (d.error) body = `<div class="empty">${icon('lock')}${esc(d.error)}</div>`;
  else {
    let page = 0;
    body = `<div class="page-head"><span class="avatar sq" style="width:44px;height:44px">${icon('description')}</span><div class="grow"><h1 style="font-size:24px;line-height:1.2">${esc(d.name)}</h1><p class="sub">${esc(d.collectionName)} · ${d.paged ? d.pages + ' pages · ' : ''}${d.chunks} passages · ${bytes(d.size)} · added by ${esc(d.uploadedBy)} ${ago(d.uploadedAt)}</p></div></div>
      <div class="card doc-text">${d.chunkList.map(c => `${d.paged && c.page !== page ? `<div class="page-mark">Page ${page = c.page}</div>` : ''}<div class="passage ${c.id === chunkId ? 'hit' : ''}" ${c.id === chunkId ? 'id="hit"' : ''}>${esc(c.text)}</div>`).join('')}</div>`;
  }
  const content = `<a class="back" href="${back}">${icon('arrow_back')}${backLabel}</a>${body}`;
  return inOs ? osShell('knowledge', 'Knowledge base', content) : gptShell(from === 'k' ? 'knowledge' : '', `<div class="gpt-top">${navToggle()}<h3 class="grow ellipsis">Source</h3></div><div class="scroll" id="scroll"><div class="page">${content}</div></div>`);
}

// ---------- assistants
let AF = null, afFor = '';
const canEdit = a => S.boot.admin || a.createdBy === S.boot.me.id;
function pageAssistants() {
  const B = S.boot;
  if (!G.catalog) { G.catalog = 'loading'; api('GET', '/api/agents/catalog').then(c => { G.catalog = c; rerender(); }).catch(() => { G.catalog = null; }); }
  const tools = a => (a.tools || []).map(t => (B.plugins.find(p => p.id === t) || { name: t }).name), have = new Set(B.assistants.map(a => a.name));
  const card = (a, mine) => `<div class="card app-card flat"><div class="row"><span class="avatar sq">${icon(a.icon || 'smart_toy')}</span><h3 class="grow ellipsis">${esc(a.name)}</h3>${mine && canEdit(a) ? `<button class="icon-btn sm" data-act="as-menu" data-id="${a.id}" aria-label="More">${icon('more_vert')}</button>` : ''}</div>
      <p class="muted small">${esc(a.description || 'No description')}</p><div class="row wrap" style="gap:6px">${mine ? chip(a.shared ? 'Shared · ' + accessLabel(a.access) : 'Only you', 'line', false) : ''}${tools(a).map(t => chip(t, 'line', false)).join('')}${a.workflow ? chip('Runs a check', 'line', false) : ''}</div>
      <div class="foot"><span class="small faint grow ellipsis">${mine ? 'By ' + esc(a.createdByName) : 'Ready-made'}</span>${mine ? `${a.workflow ? `<a class="btn ghost" href="#/gpt/flows/new/${a.workflow}">Run check</a>` : ''}<a class="btn ghost" href="#/gpt/new/${a.id}">Start chat</a>` : have.has(a.name) ? chip('Added', 'ok') : `<button class="btn ghost" data-act="tpl-add" data-key="${a.key}">Add</button>`}</div></div>`;
  return gptShell('assistants', `<div class="gpt-top">${navToggle()}<h3 class="grow">Agents ${info('An agent is a saved way of working: instructions, the knowledge it uses, the plugins it may use and starter questions.', 'tip-down')}</h3><a class="btn" href="#/gpt/assistants/new">${icon('auto_fix_high')}New agent</a></div>
    <div class="scroll" id="scroll"><div class="page">
      <div class="section-title"><h2>Your agents</h2><span class="mono">${B.assistants.length}</span></div>
      ${B.assistants.length ? `<div class="grid">${B.assistants.map(a => card(a, true)).join('')}</div>` : `<div class="empty" style="padding:26px">${icon('smart_toy')}None yet. Add a ready-made one below, or describe a job and get a draft.</div>`}
      <div class="section-title"><h2>Ready-made</h2>${info('Start from one of these. Adding makes your own copy that you can change.')}</div>
      ${G.catalog && G.catalog.templates ? `<div class="grid">${G.catalog.templates.map(t => card(t, false)).join('')}</div>` : '<p class="muted">Loading…</p>'}
    </div></div>`);
}
acts['tpl-add'] = async el => { const t = G.catalog.templates.find(x => x.key === el.dataset.key); const a = await api('POST', '/api/assistants', { ...t, collections: 'all', shared: false }); toast(`${a.name} added to your agents.`); await refresh(); };
acts['af-draft'] = async el => {
  const d = $('#af-job').value.trim(); if (d.length < 10) return toast('Describe the job in a sentence or two.', 'err');
  el.disabled = true; el.textContent = 'Drafting…';
  const r = await api('POST', '/api/agents/draft', { description: d });
  Object.assign(AF, { name: r.name, description: r.description, instructions: r.instructions, starters: r.starters, tools: r.tools, effort: r.effort }); AF.draftedBy = r.by; AF.job = d; rerender();
};
acts['af-tool'] = el => { AF.tools = AF.tools || []; const i = AF.tools.indexOf(el.dataset.id); if (i < 0) AF.tools.push(el.dataset.id); else AF.tools.splice(i, 1); rerender(); };
acts['af-effort'] = el => { AF.effort = el.dataset.v; rerender(); };
acts['as-menu'] = el => { const a = assistantOf(el.dataset.id); menu(el, [{ label: 'Edit', icon: 'edit', run: () => go('#/gpt/assistants/' + a.id) }, { label: 'Model settings', sub: 'Advanced', icon: 'tune', run: () => go('#/gpt/workspace/models/' + a.id) }, '-', { label: 'Delete', icon: 'delete_outline', danger: true, run: () => confirmBox(`Delete "${a.name}"?`, 'Chats that used it are kept and carry on without it.', 'Delete', async () => { await api('DELETE', '/api/assistants/' + a.id); await refresh(); }) }]); };
function pageAssistantForm(id) {
  const B = S.boot, ex = id === 'new' ? null : assistantOf(id);
  if (id !== 'new' && (!ex || !canEdit(ex))) return gptShell('assistants', `<div class="scroll"><div class="page"><a class="back" href="#/gpt/assistants">${icon('arrow_back')}Agents</a><div class="empty">You cannot change this agent.</div></div></div>`);
  if (afFor !== id) { afFor = id; AF = ex ? JSON.parse(JSON.stringify(ex)) : { name: '', description: '', instructions: '', collections: 'all', starters: [], model: null, shared: false, tools: [], effort: 'balanced', access: { mode: 'everyone', teams: [], users: [] } }; if (AF.access.mode === 'restricted' && !AF.shared) AF.access = { mode: 'everyone', teams: [], users: [] }; }
  accessDrafts.as = AF.access;
  const mine = B.collections.filter(c => B.gptCollectionIds.includes(c.id)), st = [0, 1, 2, 3].map(i => AF.starters[i] || '');
  return gptShell('assistants', `<div class="gpt-top">${navToggle()}<h3 class="grow">${ex ? 'Edit agent' : 'Agent details'}</h3><a class="btn ghost" href="#/gpt/assistants" data-act="as-cancel">Cancel</a><button class="btn" data-act="as-save">Save</button></div>
    <div class="scroll" id="scroll"><div class="page"><div class="stack" style="max-width:720px;gap:16px">
      <div class="card stack"><label class="field"><span>Name</span><input class="input" maxlength="60" placeholder="HR policy helper" value="${esc(AF.name)}" data-on="af" data-k="name"></label>
        <label class="field"><span>What it helps with ${info('One line people see when they pick an agent.')}</span><input class="input" maxlength="140" placeholder="Answers leave, travel and expense questions" value="${esc(AF.description)}" data-on="af" data-k="description"></label>
        <label class="field"><span>Instructions ${info('Tell it who it is talking to, what to do and what not to do. Plain language works best.')}</span><textarea class="input" rows="7" placeholder="You help employees with HR policy questions. Answer only from the policy documents. If the policy does not cover it, say so and point to the HR helpdesk." data-on="af" data-k="instructions">${esc(AF.instructions)}</textarea></label></div>
      <div class="card"><div class="card-head"><h3>Knowledge</h3>${info('Where this agent looks for answers.')}</div>
        <div class="seg"><button class="${AF.collections === 'all' ? 'on' : ''}" data-act="af-cols" data-v="all">All knowledge</button><button class="${AF.collections !== 'all' ? 'on' : ''}" data-act="af-cols" data-v="some">Chosen collections</button></div>
        ${AF.collections === 'all' ? '' : `<div class="stack" style="gap:8px;margin-top:12px">${mine.length ? mine.map(c => { const on = AF.collections.includes(c.id); return `<div class="check ${on ? 'on' : ''}" role="checkbox" aria-checked="${on}" tabindex="0" data-act="af-col" data-id="${c.id}"><span class="box">${icon('check')}</span><span class="grow"><b>${esc(c.name)}</b> <span class="mono">${c.docCount} documents</span></span></div>`; }).join('') : `<p class="small muted">There are no collections you can use yet.</p>`}</div>`}</div>
      <div class="card"><div class="card-head"><h3>Abilities</h3>${info('What this agent may use besides the model and the documents. Only abilities your admin has turned on are listed.')}</div>
        <div class="row wrap" style="gap:6px">${B.plugins.filter(p => B.app.config.tools.enabled.includes(p.id)).map(p => `<button class="tag ${(AF.tools || []).includes(p.id) ? 'on' : ''}" data-act="af-tool" data-id="${p.id}" data-tip="${esc(p.what)}">${icon(p.icon)}${p.name}</button>`).join('') || '<span class="small muted">No plugins are turned on.</span>'}</div>
        <div class="set-row" style="margin-top:14px;border-top:1px solid var(--vnk-border);padding-top:14px"><div class="grow"><div class="lbl">Effort ${info('Quick reads fewer sources and answers short. Thorough reads more and answers longer.')}</div></div><div class="seg">${Object.entries(EFFORT).map(([k, v]) => `<button class="${(AF.effort || 'balanced') === k ? 'on' : ''}" data-act="af-effort" data-v="${k}">${v[0]}</button>`).join('')}</div></div></div>
      <div class="card"><div class="card-head"><h3>Starter questions</h3>${info('Shown as one-tap buttons when someone opens the agent. Optional.')}</div><div class="stack" style="gap:8px">${st.map((s, i) => `<input class="input" maxlength="120" placeholder="${['How many casual leaves do I get?', 'What is the travel booking rule?', 'Optional', 'Optional'][i]}" value="${esc(s)}" data-on="af-starter" data-i="${i}" aria-label="Starter question ${i + 1}">`).join('')}</div></div>
      ${B.admin ? `<div class="card"><div class="set-row"><div class="grow"><div class="lbl">Share with other people ${info('Off keeps the agent visible only to you.')}</div></div><button class="switch ${AF.shared ? 'on' : ''}" role="switch" aria-checked="${AF.shared}" data-act="af-share"></button></div>${AF.shared ? `<div style="margin-top:14px">${accessPicker('as', 'Everyone with VanikGPT')}</div>` : ''}</div>` : ''}
      <div class="card"><details class="adv" style="border:0;margin:0;padding:0"><summary>${icon('chevron_right')}Advanced</summary><div><div class="set-row"><div class="grow"><div class="lbl">Model ${info('Leave on default unless this job needs a specific model.')}</div></div><select class="input" style="width:260px" data-change="af-model"><option value="">Default model</option>${B.app.config.models.map(m => `<option ${AF.model === m ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select></div></div></details></div>
    </div></div></div>`);
}
ins.af = el => { AF[el.dataset.k] = el.value; };
ins['af-starter'] = el => { AF.starters[+el.dataset.i] = el.value; };
ins['af-model'] = el => { AF.model = el.value || null; };
acts['af-cols'] = el => { AF.collections = el.dataset.v === 'all' ? 'all' : (Array.isArray(AF.collections) ? AF.collections : []); rerender(); };
acts['af-col'] = el => { const i = AF.collections.indexOf(el.dataset.id); if (i < 0) AF.collections.push(el.dataset.id); else AF.collections.splice(i, 1); rerender(); };
acts['af-share'] = () => { AF.shared = !AF.shared; rerender(); };
acts['as-cancel'] = () => { afFor = ''; };
acts['as-save'] = async () => { const id = afFor; await (id === 'new' ? api('POST', '/api/assistants', AF) : api('PUT', '/api/assistants/' + id, AF)); afFor = ''; toast('Agent saved.'); await load(); go('#/gpt/assistants'); };

// ---------- agent builder: say what you need, answer a few questions, done
const AB = { step: 'ask', job: '', info: null, qi: 0, answers: {}, draft: null, busy: false };
const abReset = () => Object.assign(AB, { step: 'ask', job: '', info: null, qi: 0, answers: {}, draft: null, busy: false });
const AB_EXAMPLES = ['Answer HR policy questions from our handbook', 'Check vendor invoices and GST numbers', 'Summarise contracts and flag risky clauses', 'Look up prices on our supplier portal'];
function pageBuilder() {
  const B = S.boot, top = `<div class="gpt-top">${navToggle()}<h3 class="grow">New agent</h3>${AB.step !== 'ask' ? `<button class="btn text" data-act="ab-reset">${icon('restart_alt')}Start over</button>` : ''}<a class="btn ghost" href="#/gpt/assistants">Close</a></div>`;
  if (AB.step === 'ask') return gptShell('assistants', `${top}<div class="scroll" id="scroll" style="display:flex;flex-direction:column"><div class="hero">
      <h1>What should this agent do?</h1><p class="muted" style="text-align:center;margin:-14px 24px 22px">Say it in your own words. You will get two or three quick questions, then the agent is ready.</p>
      <div class="composer-wrap"><div class="composer"><textarea id="ab-job" rows="2" placeholder="For example: help the accounts team check vendor invoices and GST numbers" aria-label="What the agent should do">${esc(AB.job)}</textarea>
        <div class="tools"><span class="small faint grow">Enter to continue</span><button class="send" data-act="ab-go" aria-label="Continue" ${AB.busy ? 'disabled' : ''}>${icon('arrow_upward')}</button></div></div></div>
      <div class="starters">${AB_EXAMPLES.map(x => `<button class="tag" style="padding:7px 12px" data-act="ab-example" data-t="${esc(x)}">${esc(x)}</button>`).join('')}</div></div></div>`);
  const said = `<div class="msg user"><div class="bubble">${esc(AB.job)}</div></div>`;
  const got = `<div class="msg bot"><span class="app-ico">${icon('auto_fix_high')}</span><div class="body"><div class="md"><p>Here is what I understood.</p><ul>${AB.info.understood.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div></div></div>`;
  const done = AB.info.questions.slice(0, AB.step === 'review' ? 99 : AB.qi).map(q => { const a = AB.answers[q.id] || {}, o = q.options.find(x => x.v === a.v); return `<div class="msg bot"><span class="app-ico">${icon('help_outline')}</span><div class="body"><div class="md"><p>${esc(q.text)}</p></div></div></div><div class="msg user"><div class="bubble">${esc(a.custom || (o && o.label) || '')}</div></div>`; }).join('');
  let now = '';
  if (AB.step === 'questions') {
    const q = AB.info.questions[AB.qi];
    now = `<div class="msg bot ab-in"><span class="app-ico">${icon('help_outline')}</span><div class="body"><div class="row" style="margin-bottom:10px"><b class="grow" style="font-size:15px">${esc(q.text)}</b><span class="mono">${AB.qi + 1} of ${AB.info.questions.length}</span></div>
      <div class="opts">${q.options.map(o => `<button class="opt" data-act="ab-pick" data-v="${o.v}"><span class="grow"><b>${esc(o.label)}</b><span class="small muted">${esc(o.sub || '')}</span></span>${o.suggested ? chip('Suggested', 'ok', false) : ''}${icon('chevron_right')}</button>`).join('')}</div>
      ${q.custom !== undefined ? `<div class="row" style="margin-top:8px"><input class="input" id="ab-custom" placeholder="${esc(q.custom || 'Or type your own answer')}" aria-label="Your own answer"><button class="icon-btn bordered" data-act="ab-custom" aria-label="Use my answer">${icon('arrow_forward')}</button></div>` : ''}
      ${AB.qi ? `<button class="btn text" style="margin-top:8px" data-act="ab-back">${icon('arrow_back')}Back</button>` : ''}</div></div>`;
  }
  if (AB.step === 'review') {
    const d = AB.draft, plug = (d.tools || []).map(t => (B.plugins.find(p => p.id === t) || { name: t }).name);
    now = `<div class="msg bot ab-in"><span class="app-ico">${icon('auto_fix_high')}</span><div class="body"><div class="md"><p>Your agent is ready. Change the name if you like.</p></div>
      <div class="card" style="margin-top:6px"><div class="row"><span class="avatar sq">${icon(d.icon || 'smart_toy')}</span><input class="input grow" id="ab-name" maxlength="60" value="${esc(d.name)}" aria-label="Agent name" style="font-weight:700;font-size:15px"></div>
        <p class="muted small" style="margin:10px 0">${esc(d.description)}</p>
        <div class="row wrap" style="gap:6px">${chip(d.collections === 'all' ? 'Company knowledge' : d.collections.length ? 'One collection' : 'No knowledge base', 'line', false)}${plug.length ? plug.map(x => chip(x, 'line', false)).join('') : chip('No plugins', 'line', false)}${chip({ quick: 'Short answers', balanced: 'Step by step', thorough: 'Thorough' }[d.effort], 'line', false)}${chip(d.shared ? (d.access.mode === 'restricted' ? 'Shared with ' + d.access.teams.join(', ') : 'Shared with everyone') : 'Only you', 'line', false)}</div>
        <div class="row" style="margin-top:16px"><button class="btn lg" data-act="ab-create" ${AB.busy ? 'disabled' : ''}>Create agent</button><button class="btn ghost" data-act="ab-details">Change details</button></div></div></div></div>`;
  }
  G.toBottom = true;
  return gptShell('assistants', `${top}<div class="scroll" id="scroll"><div class="thread">${said}${got}${done}${AB.busy && AB.step === 'questions' && AB.qi >= AB.info.questions.length ? '' : now}${AB.busy ? `<div class="msg bot"><span class="app-ico">${icon('auto_fix_high')}</span><div class="body"><div class="dots"><i></i><i></i><i></i></div></div></div>` : ''}</div></div>`);
}
acts['ab-reset'] = () => { abReset(); rerender(); };
acts['ab-example'] = el => { AB.job = el.dataset.t; rerender(); const q = $('#ab-job'); if (q) q.focus(); };
acts['ab-go'] = async () => {
  AB.job = ($('#ab-job') ? $('#ab-job').value : AB.job).trim(); if (AB.busy) return;
  AB.busy = true;
  try { AB.info = await api('POST', '/api/agents/interview', { description: AB.job }); AB.step = 'questions'; AB.qi = 0; AB.answers = {}; } finally { AB.busy = false; rerender(); }
};
async function abNext() {
  if (++AB.qi < AB.info.questions.length) return rerender();
  AB.busy = true; rerender();
  try { AB.draft = await api('POST', '/api/agents/build', { description: AB.job, answers: AB.answers }); AB.step = 'review'; } catch (e) { AB.qi--; throw e; } finally { AB.busy = false; rerender(); }
}
acts['ab-pick'] = el => { AB.answers[AB.info.questions[AB.qi].id] = { v: el.dataset.v }; return abNext(); };
acts['ab-custom'] = () => { const v = $('#ab-custom').value.trim(); if (!v) return toast('Type your answer first, or pick one above.'); const q = AB.info.questions[AB.qi]; AB.answers[q.id] = { v: q.id === 'share' ? 'team' : (q.options.find(o => o.suggested) || q.options[0]).v, custom: v }; return abNext(); };
acts['ab-back'] = () => { AB.qi = Math.max(0, AB.qi - 1); rerender(); };
acts['ab-create'] = async () => { AB.busy = true; const d = { ...AB.draft, name: $('#ab-name').value.trim() || AB.draft.name }; try { const a = await api('POST', '/api/assistants', d); abReset(); await load(); toast(`${a.name} is ready.`); go('#/gpt/new/' + a.id); } finally { AB.busy = false; } };
acts['ab-details'] = () => { AF = { model: null, starters: [], ...AB.draft, name: $('#ab-name').value.trim() || AB.draft.name }; afFor = 'new'; abReset(); go('#/gpt/assistants/details'); };
document.addEventListener('keydown', e => { if (e.key !== 'Enter' || e.shiftKey) return; if (e.target.id === 'ab-job') { e.preventDefault(); acts['ab-go']().catch(x => toast(x.message, 'err')); } if (e.target.id === 'ab-custom') { e.preventDefault(); acts['ab-custom'](); } });

// ---------- knowledge (read only for app users)
function pageKnowledge(id) {
  const B = S.boot, mine = B.collections.filter(c => B.gptCollectionIds.includes(c.id));
  const manage = B.admin ? `<a class="btn ghost" href="#/os/knowledge">Manage in Vanik OS</a>` : '';
  if (id) {
    const c = mine.find(x => x.id === id);
    if (!c) return gptShell('knowledge', `<div class="scroll"><div class="page"><a class="back" href="#/gpt/knowledge">${icon('arrow_back')}Knowledge</a><div class="empty">You do not have this collection.</div></div></div>`);
    if (!G.colDocs[id]) { G.colDocs[id] = 'loading'; api('GET', `/api/collections/${id}/documents`).then(d => { G.colDocs[id] = d; rerender(); }).catch(e => toast(e.message, 'err')); }
    const docs = G.colDocs[id];
    return gptShell('knowledge', `<div class="gpt-top">${navToggle()}<h3 class="grow ellipsis">${esc(c.name)}</h3>${c.canWrite ? `<button class="btn ghost" data-act="kb-note">${icon('edit_note')}Add a note</button><button class="btn ghost" data-act="kb-add" data-id="${c.id}">${icon('upload_file')}Add files</button>` : ''}${manage}</div><div class="scroll" id="scroll"><div class="page"><a class="back" href="#/gpt/knowledge">${icon('arrow_back')}Knowledge</a>
      <p class="muted" style="margin-bottom:16px">${esc(c.description || '')}</p>
      <div class="card">${!Array.isArray(docs) ? `<p class="muted">Loading…</p>` : docs.length ? `<div id="uploads"></div><table class="list"><tr><th>Document</th><th>Size</th><th>Added</th><th></th></tr>${docs.map(d => `<tr><td>${d.waiting ? esc(d.name) : `<a class="link" href="#/gpt/source/${d.id}/-/k">${esc(d.name)}</a>`} ${d.note ? chip('Note', 'line') : d.waiting ? chip('Waiting for a transcript', 'warn') : d.transcribed ? chip('Recording', 'line') : ''}</td><td class="muted">${bytes(d.size)}</td><td class="muted">${ago(d.uploadedAt)}<div class="small faint">${esc(d.uploadedBy)}</div></td><td class="act">${d.waiting ? '' : `<button class="icon-btn sm tip-left" data-act="doc-tasks" data-id="${d.id}" data-name="${esc(d.name)}" data-tip="Make tasks from this" aria-label="Make tasks from this">${icon('add_task')}</button>`}</td></tr>`).join('')}</table>` : `<p class="muted">This collection has no documents yet.</p>`}</div></div></div>`);
  }
  G.colDocs = {};
  return gptShell('knowledge', `<div class="gpt-top">${navToggle()}<h3 class="grow">Knowledge ${info('The document collections VanikGPT can use for your answers.', 'tip-down')}</h3>${manage}</div>
    <div class="scroll" id="scroll"><div class="page">${mine.length ? `<div class="grid">${mine.map(c => `<a class="card app-card flat" style="min-height:0" href="#/gpt/knowledge/${c.id}"><div class="row"><span class="avatar sq">${esc(initials(c.name))}</span><div class="grow"><h3 class="ellipsis">${esc(c.name)}</h3><span class="mono">${c.docCount} ${c.docCount === 1 ? 'document' : 'documents'}</span></div></div><p class="muted small">${esc(c.description || 'No description')}</p></a>`).join('')}</div>`
    : `<div class="empty">${icon('library_books')}No knowledge yet. ${B.admin ? 'Add documents in Vanik OS so answers can cite them.' : 'Ask an admin to add documents. You can still attach a file to a chat.'}${B.admin ? `<br><a class="btn" href="#/os/knowledge">Open Knowledge base</a>` : ''}</div>`}</div></div>`);
}

export function gptPage(parts) {
  const [a, b, c, d] = parts;
  if (a === 'source') return pageSource(b, c, d || '');
  if (!S.boot.canUseGpt) return blocked();
  if (a === 'c' && b) return pageChat(b);
  if (a === 'shared' && b) return pageShared(b);
  if (a === 'assistants') return b === 'new' ? pageBuilder() : b === 'details' ? pageAssistantForm('new') : b ? pageAssistantForm(b) : (afFor = '', pageAssistants());
  if (a === 'knowledge') return pageKnowledge(b);
  return pageNew(a === 'new' ? b : null);
}
export function gptAfterRender() {
  const q = $('#q'), sc = $('#scroll');
  if (q) { q.style.height = 'auto'; if (q.value) q.style.height = Math.min(200, q.scrollHeight) + 'px'; if (G.focus && !$('.overlay')) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }
  G.focus = false;
  if (G.toBottom && sc && $('.thread')) { sc.scrollTop = sc.scrollHeight; if (G.chat) G.toBottom = false; }
  const hit = $('#hit'); if (hit && G.hitKey !== location.hash) { G.hitKey = location.hash; hit.scrollIntoView({ block: 'center' }); }
}
