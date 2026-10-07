// Vanik OS console pages that VanikGPT touches: Apps, the VanikGPT manage page, Knowledge base, Model Hub, People, Settings.
import { navToggle, S, $, esc, icon, info, chip, initials, LOGO, go, bytes, ago, when, api, load, refresh, rerender, acts, ins, toast, modal, confirmBox, menu, themeButton, userButton, ROLE, accessDrafts, accessChanged, accessPicker, accessLabel, extractFile, pickFiles, downloadText } from './core.js';

const NAV = [['home', 'Home', 'home'], ['apps', 'Apps', 'apps'], ['knowledge', 'Knowledge base', 'library_books'], 'Platform', ['models', 'Model Hub', 'memory'], ['train', 'Train your LLM', 'trending_up'], ['api-gateway', 'API gateway', 'api'], ['connectors', 'Connectors', 'storage'], ['devices', 'Devices', 'dns'], 'Admin', ['people', 'People', 'group'], ['access', 'Access', 'admin_panel_settings'], ['settings', 'Settings', 'settings']];
const OTHER_APPS = [['Intelligent Document Processing', 'Extract structured data from any document, on your own hardware.', 'description'], ['Vanik Desk', 'Customer support with tickets, SLAs and AI assistance, on your own fleet.', 'support_agent'], ['Vanik Echo', 'Live meeting transcription with speaker labels, on your own Vanik Appliance.', 'graphic_eq'], ['Vanik MeasureBook', 'Turn tender drawings into a bid-ready BOQ, with every quantity traceable.', 'straighten'], ['Vanik Scout', 'Rank a backlog of resumes against an ideal job profile, with its reasoning shown.', 'person_search']];
const LIVE_OS = 'https://os.vanikedge.ai/';
const cache = { key: '', usage: null, audit: null, docs: {}, doc: null };
export const osRouteChanged = () => { cache.key = ''; };
function ensure(key, loader) { if (cache.key === key) return; cache.key = key; loader().then(rerender).catch(e => toast(e.message, 'err')); }

export function osShell(active, crumb, content) {
  const B = S.boot;
  return `<div class="shell"><aside class="console-nav">
    <a class="brand" href="#/os/apps">${LOGO}<span>VANIK <em>OS</em></span></a>
    <button class="nav-search" data-act="palette">${icon('search')}Search everything<kbd>Ctrl K</kbd></button>
    ${NAV.map(n => typeof n === 'string' ? `<span class="nav-group-label">${n}</span>` : `<a class="nav-item ${active === n[0] ? 'is-active' : ''}" href="#/os/${n[0]}">${icon(n[2])}<span>${n[1]}</span>${n[0] === 'apps' ? `<span class="count">${B.app.status === 'not_installed' ? 0 : 1}</span>` : ''}</a>`).join('')}
  </aside><div class="main"><header class="topbar">${navToggle()}<span class="crumb">${esc(B.tenant.name)} / <b>${crumb}</b></span><span class="right"></span>
    <span class="pill ${B.device.online ? '' : 'off'} tip-down" data-tip="${B.device.online ? 'Reaching ' + esc(B.device.name) : 'The appliance is offline. Apps and models are stopped.'}"><i></i>Vanik Appliance ${B.device.online ? 'online' : 'offline'}</span>${themeButton()}${userButton()}</header>
    <div class="scroll" id="scroll"><div class="page">${content}</div></div></div></div>`;
}

// ---------- app status
function appStatus() {
  const a = S.boot.app;
  if (a.status !== 'not_installed' && !S.boot.device.online) return ['Offline', 'err'];
  return { not_installed: ['Not installed', ''], needs_setup: ['Needs setup', 'warn'], deploying: ['Deploying', 'warn'], running: ['Running', 'ok'], stopped: ['Stopped', ''] }[a.status];
}
const pendingDeploy = () => { const a = S.boot.app; return a.latestVersion && a.latestVersion !== a.deployedVersion && a.status !== 'deploying'; };

// ---------- Apps
function pageApps() {
  const B = S.boot, a = B.app, installed = a.status !== 'not_installed', st = appStatus();
  const gptCard = installed ? `<div class="card app-card">
      <div class="row"><span class="app-ico">${icon('forum')}</span><span class="right">${chip(st[0], st[1])}</span></div>
      <h3>VanikGPT</h3><p class="muted small">Chat with the models running on your own Vanik Appliance.</p>
      <div class="foot"><span class="mono ellipsis grow">${esc(B.device.name)} · ${a.port}</span>
        ${a.status === 'running' && B.device.online ? `<a class="btn" href="#/gpt">Open</a>` : ''}
        <a class="btn ${a.status === 'running' ? 'ghost' : ''}" href="#/os/apps/vanikgpt/${a.status === 'needs_setup' ? 'setup' : 'overview'}">${a.status === 'needs_setup' ? 'Finish setup' : 'Manage'}</a>
        <button class="icon-btn sm" data-act="app-menu" aria-label="More">${icon('more_vert')}</button></div></div>` : '';
  const avail = (installed ? '' : `<div class="card app-card flat"><div class="row"><span class="app-ico">${icon('forum')}</span></div><h3>VanikGPT</h3><p class="muted small">Chat with the models running on your own Vanik Appliance.</p>
      <div class="foot"><span class="mono grow">Needs ${a.needsGb} GB</span><button class="btn" data-act="app-install">Install</button></div></div>`)
    + OTHER_APPS.map(o => `<div class="card app-card flat"><div class="row"><span class="app-ico">${icon(o[2])}</span></div><h3>${o[0]}</h3><p class="muted small">${o[1]}</p>
      <div class="foot"><span class="grow"></span><a class="btn ghost" href="${LIVE_OS}apps" target="_blank" rel="noopener">Open in Vanik OS ${icon('open_in_new')}</a></div></div>`).join('');
  return osShell('apps', 'Apps', `
    <div class="page-head"><div><h1>Apps</h1><p class="sub">6 apps · ${installed ? 1 : 0} installed · ${installed ? 5 : 6} available</p></div></div>
    <div class="section-title"><h2>On your Vanik Appliance</h2><span class="mono">${installed ? 1 : 0} installed</span></div>
    ${installed ? `<div class="grid">${gptCard}</div>` : `<div class="empty">${icon('apps')}Nothing installed yet. Pick one below to put it on a device.</div>`}
    <div class="section-title"><h2>Available to install</h2></div><div class="grid">${avail}</div>`);
}
acts['app-install'] = () => {
  const B = S.boot;
  modal({ title: 'Install VanikGPT', text: `Reserves ${B.app.needsGb} GB on ${B.device.name}. ${B.device.freeGb} GB is free.`, actions: [{ label: 'Install', run: async () => { await api('POST', '/api/app/install'); await load(); toast('VanikGPT installed. Finish setup to turn it on.'); go('#/os/apps/vanikgpt/setup'); } }] });
};
acts['app-menu'] = el => {
  const a = S.boot.app;
  menu(el, [
    { label: 'Manage', icon: 'tune', run: () => go('#/os/apps/vanikgpt/overview') },
    a.status === 'running' && { label: 'Stop', icon: 'stop_circle', run: () => confirmBox('Stop VanikGPT?', 'People will not be able to chat until you start it again. Chats are kept.', 'Stop', async () => { await api('POST', '/api/app/stop'); await refresh(); }) },
    a.status === 'stopped' && { label: 'Start', icon: 'play_circle', run: async () => { await api('POST', '/api/app/start'); await refresh(); watchDeploy(); } },
    '-',
    { label: 'Uninstall', icon: 'delete_outline', danger: true, run: () => confirmBox('Uninstall VanikGPT?', 'The app is removed from the device and its setup is cleared. Chats and agents are kept if you install it again.', 'Uninstall', async () => { await api('DELETE', '/api/app'); draft = null; await load(); go('#/os/apps'); }) },
  ]);
};

// ---------- VanikGPT manage page
let draft = null, draftBase = '', advOpen = false, allModels = false, actTab = 'versions', pollT = null;
function ensureDraft() { const base = JSON.stringify(S.boot.app.config); if (!draft || draftBase !== base) { draft = JSON.parse(base); draftBase = base; } accessDrafts.app = draft.access; accessChanged.app = saveBar; }
const dirty = () => !!draft && JSON.stringify(draft) !== draftBase;

function deployBox() {
  const a = S.boot.app, d = a.deploy;
  if (a.status === 'deploying' && d) return `<div class="card" style="margin-bottom:20px"><div class="card-head"><h3>Deploying config v${d.v}</h3><span class="mono">${esc(d.note || '')}</span><button class="btn ghost right" data-act="deploy-cancel">Cancel</button></div>
    <div class="steps">${d.steps.map(s => `<div class="step ${s.state}"><span class="dot">${s.state === 'done' ? icon('check') : ''}</span>${s.label}</div>`).join('')}</div></div>`;
  if (d && d.result === 'failed' && a.deployedVersion !== d.v) return `<div class="banner err">${icon('error_outline')}<span><b>Deploy of config v${d.v} did not finish.</b> ${esc(d.reason)}</span><button class="btn" data-act="deploy">Deploy again</button></div>`;
  if (pendingDeploy() && !dirty()) return `<div class="banner">${icon('info_outline')}<span>Setup is saved as config v${a.latestVersion} but is not live yet.</span><button class="btn" data-act="deploy">Deploy</button></div>`;
  return '';
}
export function watchDeploy() {
  if (pollT || !S.boot || S.boot.app.status !== 'deploying') return;
  pollT = setInterval(async () => {
    try { await load(); } catch { return; }
    const a = S.boot.app, box = $('#deploy-box');
    if (a.status === 'deploying') { if (box) box.innerHTML = deployBox(); return; }
    clearInterval(pollT); pollT = null; cache.key = '';
    const d = a.deploy;
    if (d && d.result === 'ok') toast('VanikGPT is running on config v' + d.v + '.'); else if (d && d.result === 'failed') toast('Deploy did not finish.', 'err');
    if (location.hash.startsWith('#/os/')) rerender();
  }, 600);
}
acts.deploy = async () => { await api('POST', '/api/app/deploy'); await refresh(); watchDeploy(); };
acts['deploy-cancel'] = async () => { await api('POST', '/api/app/deploy/cancel'); await refresh(); };

function healthRows() {
  const B = S.boot, a = B.app, c = a.config, st = appStatus();
  const chosen = c.models.map(id => B.models.find(m => m.id === id)).filter(Boolean), serving = chosen.filter(m => m.status === 'serving');
  const cols = B.collections.filter(x => c.collections === 'all' || c.collections.includes(x.id)), docs = cols.reduce((n, x) => n + x.docCount, 0);
  const users = B.users.filter(u => u.role !== 'user' || c.access.mode === 'everyone' || c.access.users.includes(u.id) || (u.teams || []).some(t => c.access.teams.includes(t))).length;
  const row = (ok, label, detail, action = '') => `<div class="set-row"><span class="material-icons mi" style="color:var(--vnk-${ok === true ? 'ok' : ok === false ? 'warn' : 'ink-3'})">${ok === true ? 'check_circle' : ok === false ? 'error_outline' : 'radio_button_unchecked'}</span><div class="grow"><div class="lbl">${label}</div><div class="small muted">${detail}</div></div>${action}</div>`;
  const lastOk = (a.deploys || []).find(d => d.result === 'ok');
  return row(a.status === 'running' && B.device.online, 'App', a.status === 'running' ? (B.device.online ? `Running on ${esc(B.device.name)}, port ${a.port}${lastOk ? ' · live since ' + ago(lastOk.endedAt) : ''}` : 'The appliance is offline, so nobody can reach VanikGPT.') : a.status === 'deploying' ? 'Deploying now.' : a.status === 'stopped' ? 'Stopped. People cannot chat.' : 'Not deployed yet.', chip(st[0], st[1]))
    + row(serving.length > 0, 'Model', !chosen.length ? 'No model chosen yet.' : serving.length ? `Serving: ${serving.map(m => esc(m.id)).join(', ')}` : 'None of the chosen models is serving.', !chosen.length ? `<a class="btn ghost" href="#/os/apps/vanikgpt/setup">Choose</a>` : serving.length ? '' : `<a class="btn ghost" href="#/os/models">Model Hub</a>`)
    + row(B.gateway.ok, `Model gateway ${info('VanikGPT reaches models through the Vanik API gateway. The key is created and rotated for you.')}`, B.gateway.ok ? 'Reachable.' : 'Not reachable. Until it is, answers are built from your documents only.', `<button class="btn ghost" data-act="gw-check">Check again</button>`)
    + row(docs > 0 ? true : null, 'Knowledge', docs ? `${cols.length} ${cols.length === 1 ? 'collection' : 'collections'} · ${docs} ${docs === 1 ? 'document' : 'documents'} can be searched.` : 'No documents yet. Answers will not cite your files.', `<a class="btn ghost" href="#/os/knowledge">Knowledge base</a>`)
    + row(true, 'People', `${accessLabel(c.access)} · ${users} of ${B.users.length} can open it.`, `<a class="btn ghost" href="#/os/people">People</a>`)
    + row(c.safety.pii !== 'off', 'Personal data', { mask: 'Aadhaar, PAN, GSTIN, IFSC, phone and email are masked before a question reaches the model.', flag: 'Questions with personal data are flagged but sent as typed.', off: 'Questions are not checked for personal data.' }[c.safety.pii]);
}
acts['gw-check'] = async el => { el.disabled = true; const r = await api('POST', '/api/app/check'); await refresh(); toast(r.ok ? 'Model gateway is reachable.' : 'Model gateway is still not reachable.', r.ok ? '' : 'err'); };

const stat = (k, v, tip) => `<div class="card flat stat"><span class="k">${k}${tip ? info(tip) : ''}</span><b>${v}</b></div>`;
function tabOverview() {
  const a = S.boot.app, u = cache.usage, wk = u ? u.days.reduce((n, d) => n + d.questions, 0) : '—';
  return `<div class="grid four" style="margin-bottom:20px">${stat('Questions, 7 days', wk)}${stat('People asking', u ? u.activeUsers : '—')}${stat('Average answer time', u ? (u.avgMs ? (u.avgMs / 1000).toFixed(1) + ' s' : '—') : '—')}${stat('Helpful answers', u ? (u.up + u.down ? Math.round(100 * u.up / (u.up + u.down)) + '%' : '—') : '—', 'Share of rated answers that got a thumbs up.')}</div>
    <div class="card"><div class="card-head"><h3>Health</h3>${a.status === 'needs_setup' && !a.latestVersion ? `<a class="btn right" href="#/os/apps/vanikgpt/setup">Finish setup</a>` : ''}</div>${healthRows()}</div>`;
}

function saveBar() {
  const el = $('#savebar'); if (!el) return;
  const a = S.boot.app, d = dirty();
  el.innerHTML = `<span class="grow muted">${d ? 'You have unsaved changes.' : pendingDeploy() ? `Saved as config v${a.latestVersion}. Not live yet.` : a.deployedVersion ? `Config v${a.deployedVersion} is live.` : 'Choose a model, then save and deploy.'}</span>
    ${d ? `<button class="btn text" data-act="cfg-discard">Discard</button><button class="btn ghost" data-act="cfg-save">Save</button><button class="btn" data-act="cfg-save" data-deploy="1">Save and deploy</button>` : pendingDeploy() || (a.status === 'needs_setup' && a.latestVersion) ? `<button class="btn" data-act="deploy">Deploy</button>` : a.status === 'needs_setup' ? `<button class="btn" data-act="cfg-save" data-deploy="1" ${draft.models.length ? '' : 'disabled'}>Save and deploy</button>` : ''}`;
}
function tabSetup() {
  ensureDraft();
  const B = S.boot, c = draft, chat = B.models.filter(m => m.kind === 'chat');
  const sw = (key, on) => `<button class="switch ${on ? 'on' : ''}" role="switch" aria-checked="${on}" data-act="cfg-switch" data-k="${key}"></button>`;
  const mStatus = m => m.status === 'serving' ? chip('Serving', 'ok') : m.status === 'parked' ? chip('Parked', '') : chip('Not on device', '');
  return `<div class="stack" style="gap:16px;max-width:820px">
    <div class="card"><div class="card-head"><h3>Models</h3>${info('People pick from these in chat. A model has to be serving in Model Hub to answer.')}<a class="link small right" href="#/os/models">Model Hub</a></div>
      <div class="stack" style="gap:8px">${chat.filter(m => allModels || m.status !== 'available' || c.models.includes(m.id)).map(m => { const on = c.models.includes(m.id); return `<div class="check ${on ? 'on' : ''}" role="checkbox" aria-checked="${on}" tabindex="0" data-act="cfg-model" data-id="${esc(m.id)}"><span class="box">${icon('check')}</span><span class="grow"><b>${esc(m.id)}</b> <span class="mono">${m.memGb} GB${m.note ? ' · ' + esc(m.note) : ''}</span></span>${on ? `<button class="tag ${c.defaultModel === m.id ? 'on' : ''}" data-act="cfg-default" data-id="${esc(m.id)}" data-stop>${c.defaultModel === m.id ? 'Default' : 'Make default'}</button>` : ''}${mStatus(m)}</div>`; }).join('')}</div>${chat.some(m => m.status === 'available' && !c.models.includes(m.id)) ? `<button class="btn text" style="margin-top:10px" data-act="cfg-allmodels">${icon(allModels ? 'expand_less' : 'expand_more')}${allModels ? 'Show fewer' : `Show ${chat.filter(m => m.status === 'available' && !c.models.includes(m.id)).length} more that are not on the device`}</button>` : ''}</div>
    <div class="card"><div class="card-head"><h3>Knowledge</h3>${info('The document collections VanikGPT may search. People still only see collections they have access to.')}<a class="link small right" href="#/os/knowledge">Knowledge base</a></div>
      <div class="seg"><button class="${c.collections === 'all' ? 'on' : ''}" data-act="cfg-cols" data-v="all">All collections</button><button class="${c.collections !== 'all' ? 'on' : ''}" data-act="cfg-cols" data-v="some">Chosen collections</button></div>
      ${c.collections === 'all' ? '' : `<div class="stack" style="gap:8px;margin-top:12px">${B.collections.length ? B.collections.map(x => { const on = c.collections.includes(x.id); return `<div class="check ${on ? 'on' : ''}" role="checkbox" aria-checked="${on}" tabindex="0" data-act="cfg-col" data-id="${x.id}"><span class="box">${icon('check')}</span><span class="grow"><b>${esc(x.name)}</b> <span class="mono">${x.docCount} documents</span></span></div>`; }).join('') : `<p class="small muted">No collections yet. <a class="link" href="#/os/knowledge">Create one</a></p>`}</div>`}</div>
    <div class="card"><div class="card-head"><h3>People</h3>${info('Who sees VanikGPT on their home screen.')}</div>${accessPicker('app', 'Everyone on this tenant')}</div>
    <div class="card"><div class="card-head"><h3>Plugins</h3>${info('Extra things VanikGPT can do besides answering from the model and your documents. People can turn a plugin off for one chat; they cannot turn on one you left off.')}</div>
      <div class="stack" style="gap:8px">${B.plugins.map(p => { const on = c.tools.enabled.includes(p.id); return `<div class="check ${on ? 'on' : ''}" role="checkbox" aria-checked="${on}" tabindex="0" data-act="cfg-plugin" data-id="${p.id}"><span class="box">${icon('check')}</span>${icon(p.icon)}<span class="grow"><b>${p.name}</b><div class="small muted">${p.what}</div></span></div>`; }).join('')}</div>
      ${c.tools.enabled.includes('browser') || c.tools.enabled.includes('screen') ? `<div class="set-row" style="margin-top:14px;border-top:1px solid var(--vnk-border);padding-top:14px;align-items:flex-start"><div class="grow"><div class="lbl">Sites the browser may open ${info('The sandboxed browser refuses any other site. It always stops and asks before a step that submits, pays, sends or signs in, and it never types a password.')}</div>
        <div style="margin-top:8px"><div class="seg"><button class="${c.tools.browserMode === 'allowed' ? 'on' : ''}" data-act="cfg-bmode" data-v="allowed">Only these sites</button><button class="${c.tools.browserMode === 'any' ? 'on' : ''}" data-act="cfg-bmode" data-v="any">Any site</button></div></div>
        ${c.tools.browserMode === 'allowed' ? `<div class="row wrap" style="gap:6px;margin-top:10px">${c.tools.sites.map(t => `<span class="tag">${esc(t)}<button data-act="cfg-site-del" data-v="${esc(t)}" aria-label="Remove ${esc(t)}">${icon('close')}</button></span>`).join('')}<input class="input" style="width:230px;height:30px" placeholder="intranet.company.com, press Enter" id="site-in" aria-label="Add an allowed site"></div>` : `<p class="small" style="color:var(--vnk-warn);margin-top:10px">The browser can open any address it is given. Use this only on a network you trust.</p>`}</div></div>
      <div class="set-row" style="align-items:flex-start"><div class="grow"><div class="lbl">Sign-ins for sites ${info('For sites that need a sign-in. The appliance signs in from its vault or with the company SSO session; the model never sees a password. A one-time code is asked from the person in chat. Sites without a saved sign-in stop and ask the person to sign in.')}</div>
        ${(c.tools.signins || []).map((x, i) => `<div class="row" style="margin-top:10px"><span class="avatar sq">${icon(x.kind === 'sso' ? 'badge' : 'key')}</span><div class="grow"><b class="ellipsis" style="display:block">${esc(x.host)}</b><div class="small muted ellipsis">${x.kind === 'sso' ? 'Company SSO' : 'Saved account'}${x.account ? ' · ' + esc(x.account) : ''}</div></div><button class="icon-btn sm" data-act="cfg-signin-del" data-i="${i}" data-tip="Remove" aria-label="Remove">${icon('close')}</button></div>`).join('')}
        <button class="btn ghost" style="margin-top:12px" data-act="cfg-signin-add">${icon('add')}Add a sign-in</button></div></div>` : ''}</div>
    <div class="card"><div class="card-head"><h3>Safety</h3></div>
      <div class="set-row"><div class="grow"><div class="lbl">Personal data in questions ${info('Checks each question for Aadhaar, PAN, GSTIN, IFSC, phone numbers and email. Mask replaces them before the model sees the question. Flag sends the question as typed and marks it.')}</div></div><div class="seg">${['off', 'flag', 'mask'].map(v => `<button class="${c.safety.pii === v ? 'on' : ''}" data-act="cfg-pii" data-v="${v}">${v[0].toUpperCase() + v.slice(1)}</button>`).join('')}</div></div>
      <div class="set-row"><div class="grow"><div class="lbl">Keep chats for ${info('Chats older than this are removed for everyone, on the device.')}</div></div><select class="input" style="width:150px" data-change="cfg-keep">${[[0, 'Forever'], [30, '30 days'], [90, '90 days'], [180, '180 days'], [365, '1 year']].map(o => `<option value="${o[0]}" ${c.safety.retentionDays === o[0] ? 'selected' : ''}>${o[1]}</option>`).join('')}</select></div>
      <div class="set-row"><div class="grow"><div class="lbl">File uploads in chat ${info('Lets people attach a file to one chat. The file is searched only in that chat.')}</div></div>${sw('safety.uploads', c.safety.uploads)}</div>
      <div class="set-row"><div class="grow"><div class="lbl">Voice typing ${info('Lets people speak a question. It uses the browser\'s own dictation: in Chrome and Edge the audio goes to the browser maker to be turned into text. Leave off for air-gapped sites.')}</div></div>${sw('safety.voice', c.safety.voice)}</div>
      <div class="set-row"><div class="grow"><div class="lbl">Personal data in documents ${info('Masks the same kinds of personal data in every file as it is added, in collections and in chats. Applies to files added from now on.')}</div></div>${sw('safety.maskDocuments', c.safety.maskDocuments)}</div>
      <div class="set-row" style="align-items:flex-start"><div class="grow"><div class="lbl">Blocked topics ${info('A question that contains one of these words or phrases is not answered and is not sent to the model. The attempt is written to the audit log, without the question.')}</div>
        <div class="row wrap" style="gap:6px;margin-top:8px">${c.safety.blockedTopics.map(t => `<span class="tag">${esc(t)}<button data-act="cfg-topic-del" data-v="${esc(t)}" aria-label="Remove ${esc(t)}">${icon('close')}</button></span>`).join('')}<input class="input" style="width:210px;height:30px" placeholder="Add a word or phrase, press Enter" id="topic-in" aria-label="Add a blocked topic"></div></div></div>
      <details class="adv" ${advOpen ? 'open' : ''}><summary data-act="cfg-adv">${icon('chevron_right')}Advanced</summary><div>
        <div class="set-row"><div class="grow"><div class="lbl">Questions per person per day ${info('Stops one person from using all the capacity. 0 means no limit.')}</div></div><input class="input" style="width:110px" type="number" min="0" max="10000" value="${c.safety.dailyLimit}" data-on="cfg-limit"></div>
        <div class="set-row"><div class="grow"><div class="lbl">Port ${info('The port VanikGPT listens on, on the device.')}</div></div><input class="input" style="width:110px" type="number" min="1024" max="65535" value="${c.advanced.port}" data-on="cfg-port"></div>
        <div class="set-row"><div class="grow"><div class="lbl">Offline mode ${info('The app never calls the internet. Leave on for air-gapped sites.')}</div></div>${sw('advanced.offline', c.advanced.offline)}</div>
        <div class="set-row"><div class="grow"><div class="lbl">Share device health with Vanik Edge ${info('Sends only whether the app is running and how much capacity is left. Never questions, answers or files.')}</div></div>${sw('advanced.telemetry', c.advanced.telemetry)}</div>
        <div class="set-row"><div class="grow"><div class="lbl">Allowed web origin ${info('Only needed when another internal site embeds VanikGPT. Leave empty otherwise.')}</div></div><input class="input" style="width:260px" placeholder="https://intranet.example.com" value="${esc(c.advanced.corsOrigin)}" data-on="cfg-cors"></div>
      </div></details></div>
    <div class="savebar" id="savebar"></div></div>`;
}
const toggle = (l, v) => { const i = l.indexOf(v); if (i < 0) l.push(v); else l.splice(i, 1); };
acts['cfg-model'] = el => { toggle(draft.models, el.dataset.id); if (!draft.models.includes(draft.defaultModel)) draft.defaultModel = draft.models[0] || null; rerender(); };
acts['cfg-default'] = el => { draft.defaultModel = el.dataset.id; rerender(); };
acts['cfg-cols'] = el => { draft.collections = el.dataset.v === 'all' ? 'all' : (Array.isArray(draft.collections) ? draft.collections : []); rerender(); };
acts['cfg-col'] = el => { toggle(draft.collections, el.dataset.id); rerender(); };
acts['cfg-pii'] = el => { draft.safety.pii = el.dataset.v; rerender(); };
acts['cfg-switch'] = el => { const [a, b] = el.dataset.k.split('.'); draft[a][b] = !draft[a][b]; rerender(); };
acts['cfg-allmodels'] = () => { allModels = !allModels; rerender(); };
acts['cfg-adv'] = () => { advOpen = !advOpen; };
acts['cfg-discard'] = () => { draft = null; rerender(); };
ins['cfg-keep'] = el => { draft.safety.retentionDays = +el.value; saveBar(); };
acts['cfg-plugin'] = el => { toggle(draft.tools.enabled, el.dataset.id); rerender(); };
acts['cfg-bmode'] = el => { draft.tools.browserMode = el.dataset.v; rerender(); };
acts['cfg-signin-del'] = el => { draft.tools.signins.splice(+el.dataset.i, 1); rerender(); };
acts['cfg-signin-add'] = () => modal({ title: 'Add a sign-in', body: `<div class="stack"><label class="field"><span>Site</span><input class="input" id="f-host" placeholder="portal.supplier.com"></label>
  <label class="field"><span>How it signs in ${info('Company SSO: the site has a "Sign in with" button and the appliance browser holds your company session. Saved account: a shared service account whose password is typed once on the appliance and kept in its vault. This build keeps no passwords, so saved accounts work on the sample portal only.')}</span><select class="input" id="f-kind"><option value="sso">Company SSO</option><option value="vault">Saved account</option></select></label>
  <label class="field"><span>Account</span><input class="input" id="f-acct" placeholder="buyer@company.com"></label></div>`,
  actions: [{ label: 'Add', run: o => { const host = $('#f-host', o).value.trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0]; if (!/^[a-z0-9.-]+\.[a-z0-9-]+$/.test(host)) { toast('Enter the site, for example portal.supplier.com.', 'err'); return false; } draft.tools.signins = [...(draft.tools.signins || []).filter(x => x.host !== host), { host, kind: $('#f-kind', o).value, account: $('#f-acct', o).value.trim() }]; if (draft.tools.browserMode === 'allowed' && !draft.tools.sites.includes(host)) draft.tools.sites.push(host); rerender(); } }] });
acts['cfg-site-del'] = el => { draft.tools.sites = draft.tools.sites.filter(t => t !== el.dataset.v); rerender(); };
document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'site-in') { const v = e.target.value.trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0]; if (/^[a-z0-9.-]+$/.test(v) && !draft.tools.sites.includes(v)) draft.tools.sites.push(v); rerender(); setTimeout(() => { const i = $('#site-in'); if (i) i.focus(); }, 0); } });
ins['cfg-limit'] = el => { draft.safety.dailyLimit = Math.max(0, +el.value || 0); saveBar(); };
acts['cfg-topic-del'] = el => { draft.safety.blockedTopics = draft.safety.blockedTopics.filter(t => t !== el.dataset.v); rerender(); };
document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'topic-in') { const v = e.target.value.trim().toLowerCase(); if (v && !draft.safety.blockedTopics.includes(v)) draft.safety.blockedTopics.push(v); rerender(); setTimeout(() => { const i = $('#topic-in'); if (i) i.focus(); }, 0); } });
ins['cfg-port'] = el => { draft.advanced.port = +el.value || 9016; saveBar(); };
ins['cfg-cors'] = el => { draft.advanced.corsOrigin = el.value.trim(); saveBar(); };
acts['cfg-save'] = async el => {
  const deploy = !!el.dataset.deploy;
  if (deploy && !draft.models.length) throw new Error('Pick at least one model before you deploy.');
  await api('PUT', '/api/app/config', { config: draft, deploy });
  draft = null; cache.key = ''; await load();
  if (deploy) { toast('Saved. Deploying now.'); go('#/os/apps/vanikgpt/overview'); watchDeploy(); } else { toast('Setup saved.'); rerender(); }
};

function tabUsage() {
  const u = cache.usage;
  if (!u) return `<p class="muted">Loading…</p>`;
  if (!u.questions) return `<div class="empty">${icon('insights')}No questions asked yet. Numbers show up here once people start chatting.</div>`;
  const max = Math.max(1, ...u.days.map(d => d.questions)), answers = u.modes.model + u.modes.documents + u.modes.unavailable + (u.modes.tool || 0) + (u.modes.search || 0) || 1;
  const share = (n, label, tip) => `<div class="set-row"><div class="grow"><div class="lbl">${label} ${info(tip)}</div><div class="meter" style="margin-top:8px"><i style="width:${Math.round(100 * n / answers)}%"></i></div></div><b>${n}</b></div>`;
  return `<div class="grid four" style="margin-bottom:16px">${stat('Questions, all time', u.questions)}${stat('People asking', u.activeUsers)}${stat('Average answer time', u.avgMs ? (u.avgMs / 1000).toFixed(1) + ' s' : '—')}${stat('Tokens', u.tokens.toLocaleString(), 'Input and output combined. Estimated when the model does not report it.')}</div>
    <div class="grid two">
      <div class="card"><div class="card-head"><h3>Questions per day</h3><span class="mono">last 7 days</span></div><div class="bars">${u.days.map(d => `<div><span class="mono">${d.questions || ''}</span><i style="height:${Math.round(100 * d.questions / max)}%"></i><span class="mono">${new Date(d.day).toLocaleDateString(undefined, { weekday: 'short' })}</span></div>`).join('')}</div></div>
      <div class="card"><div class="card-head"><h3>How answers were made</h3></div>${share(u.modes.model, 'By the model', 'The model wrote the answer, using your documents when they matched.')}${share(u.modes.documents, 'From documents only', 'The model could not be reached, so the answer was built from matching passages.')}${share(u.modes.unavailable, 'No answer', 'The model could not be reached and no document matched.')}${share((u.modes.tool || 0) + (u.modes.search || 0), 'By a plugin or search', 'An exact plugin result, a browser run, or passages only.')}</div>
      <div class="card"><div class="card-head"><h3>Feedback</h3><span class="right row">${chip(u.up + ' helpful', 'ok', false)}${chip(u.down + ' not helpful', u.down ? 'warn' : '', false)}</span></div>
        ${Object.keys(u.reasons).length ? Object.entries(u.reasons).map(([r, n]) => `<div class="set-row"><span class="grow">${esc(r)}</span><b>${n}</b></div>`).join('') : `<p class="small muted">No thumbs down yet.</p>`}
        ${u.notes.length ? `<div style="margin-top:14px" class="stack">${u.notes.map(n => `<div class="small"><span class="faint">${esc(n.userName)} · ${when(n.at)} · ${esc(n.reason)}</span><br>${esc(n.note)}</div>`).join('')}</div>` : ''}
        <p class="small faint" style="margin-top:14px">Admins see ratings and notes. Chat content stays with the person who wrote it.</p></div>
      <div class="card"><div class="card-head"><h3>Collections cited</h3></div>${u.collections.length ? u.collections.map(c => `<div class="set-row"><span class="grow">${esc(c.name)}</span><b>${c.n}</b></div>`).join('') : `<p class="small muted">No answer has cited a document yet.</p>`}</div>
    </div>
    <div class="card" style="margin-top:16px"><div class="card-head"><h3>People</h3></div><table class="list"><tr><th>Name</th><th>Questions</th><th>Last asked</th></tr>${u.people.map(p => `<tr><td>${esc(p.name)}</td><td>${p.questions}</td><td class="muted">${ago(p.last)}</td></tr>`).join('')}</table></div>`;
}

function diff(a, b) {
  if (!b) return ['First setup'];
  const out = [], names = ids => ids === 'all' ? 'all collections' : ids.length + ' chosen';
  if (a.models.join() !== b.models.join()) out.push('Models: ' + (a.models.join(', ') || 'none'));
  if (a.defaultModel !== b.defaultModel) out.push('Default model: ' + (a.defaultModel || 'none'));
  if (JSON.stringify(a.collections) !== JSON.stringify(b.collections)) out.push('Knowledge: ' + names(a.collections));
  if (JSON.stringify(a.access) !== JSON.stringify(b.access)) out.push('People: ' + accessLabel(a.access));
  if (a.safety.pii !== b.safety.pii) out.push('Personal data: ' + a.safety.pii);
  if (a.safety.retentionDays !== b.safety.retentionDays) out.push('Keep chats: ' + (a.safety.retentionDays ? a.safety.retentionDays + ' days' : 'forever'));
  if (a.safety.uploads !== b.safety.uploads) out.push('File uploads: ' + (a.safety.uploads ? 'on' : 'off'));
  if (!!a.safety.maskDocuments !== !!b.safety.maskDocuments) out.push('Mask documents: ' + (a.safety.maskDocuments ? 'on' : 'off'));
  if ((a.safety.blockedTopics || []).join() !== (b.safety.blockedTopics || []).join()) out.push('Blocked topics: ' + ((a.safety.blockedTopics || []).length || 'none'));
  if ((a.safety.dailyLimit || 0) !== (b.safety.dailyLimit || 0)) out.push('Daily limit: ' + (a.safety.dailyLimit || 'none'));
  if (!!a.safety.voice !== !!b.safety.voice) out.push('Voice typing: ' + (a.safety.voice ? 'on' : 'off'));
  if (a.tools && b.tools && a.tools.enabled.join() !== b.tools.enabled.join()) out.push('Plugins: ' + (a.tools.enabled.length || 'none'));
  if (a.tools && b.tools && (a.tools.browserMode !== b.tools.browserMode || a.tools.sites.join() !== b.tools.sites.join())) out.push('Browser sites: ' + (a.tools.browserMode === 'any' ? 'any' : a.tools.sites.length));
  if (JSON.stringify(a.advanced) !== JSON.stringify(b.advanced)) out.push('Advanced settings');
  return out.length ? out : ['No setting changed'];
}
function tabActivity() {
  const a = S.boot.app;
  const seg = `<div class="seg" style="margin-bottom:18px"><button class="${actTab === 'versions' ? 'on' : ''}" data-act="act-tab" data-v="versions">Versions and deploys</button><button class="${actTab === 'audit' ? 'on' : ''}" data-act="act-tab" data-v="audit">Audit log</button></div>`;
  if (actTab === 'audit') {
    const rows = cache.audit || [];
    return seg + `<div class="card"><div class="card-head"><h3>Audit log</h3>${info('Every change by your team, with who and when. Question and answer text is never written here.')}<span class="right"></span><input class="input" style="width:200px;height:34px" placeholder="Filter" data-on="audit-filter" aria-label="Filter the log"><button class="btn ghost tip-left" data-act="audit-verify" data-tip="Each entry carries a fingerprint of the one before it. Verify re-checks the whole chain.">Verify</button><button class="btn ghost" data-act="audit-export">Export</button></div>
      <table class="list"><tr><th>When</th><th>Who</th><th>What</th><th>On</th><th>Detail</th></tr><tbody id="audit-rows">${auditRows(rows, '')}</tbody></table></div>`;
  }
  const items = [...a.versions.map((v, i) => ({ t: v.at, kind: 'v', v, prev: a.versions[i + 1] })), ...a.deploys.map(d => ({ t: d.startedAt, kind: 'd', d }))].sort((x, y) => y.t.localeCompare(x.t));
  if (!items.length) return seg + `<div class="empty">${icon('history')}Nothing yet. Saved setups and deploys show up here.</div>`;
  const dchip = d => d.result === 'ok' ? chip('Went live', 'ok') : d.result === 'failed' ? chip('Did not finish', 'err') : d.result === 'cancelled' ? chip('Cancelled', '') : chip('In progress', 'warn');
  return seg + `<div class="card"><div class="timeline">${items.map(it => it.kind === 'v' ? `<div class="tl"><span class="ico">${icon('tune')}</span><div class="grow"><div class="row wrap"><b>config v${it.v.v}</b>${it.v.v === a.deployedVersion ? chip('Live', 'ok') : ''}${it.v.v === a.latestVersion && it.v.v !== a.deployedVersion ? chip('Not live', 'warn') : ''}</div>
        <div class="small muted">${when(it.v.at)} · ${esc(it.v.by)}${it.v.note ? ' · ' + esc(it.v.note) : ''}</div><div class="row wrap" style="gap:6px;margin-top:8px">${diff(it.v.config, it.prev && it.prev.config).map(x => `<span class="tag">${esc(x)}</span>`).join('')}</div></div>
        ${it.v.v !== a.latestVersion && a.status !== 'deploying' ? `<button class="btn ghost" data-act="rollback" data-v="${it.v.v}">Roll back</button>` : ''}</div>`
    : `<div class="tl"><span class="ico">${icon('rocket_launch')}</span><div class="grow"><div class="row wrap"><b>Deploy of config v${it.d.v}</b>${dchip(it.d)}</div>
        <div class="small muted">${when(it.d.startedAt)} · ${esc(it.d.by)}${it.d.endedAt ? ' · took ' + Math.max(1, Math.round((new Date(it.d.endedAt) - new Date(it.d.startedAt)) / 1000)) + ' s' : ''}${it.d.note ? ' · ' + esc(it.d.note) : ''}</div>${it.d.reason && it.d.result !== 'ok' ? `<div class="small" style="margin-top:6px;color:var(--vnk-err)">${esc(it.d.reason)}</div>` : ''}</div></div>`).join('')}</div></div>`;
}
const auditRows = (rows, f) => { const q = f.toLowerCase(); const r = rows.filter(x => !q || (x.userName + x.action + x.target + x.detail).toLowerCase().includes(q)); return r.length ? r.map(x => `<tr><td class="muted" style="white-space:nowrap">${when(x.at)}</td><td>${esc(x.userName)}</td><td>${esc(x.action)}</td><td>${esc(x.target)}</td><td class="muted">${esc(x.detail)}</td></tr>`).join('') : `<tr><td colspan="5" class="muted">Nothing matches.</td></tr>`; };
ins['audit-filter'] = el => { $('#audit-rows').innerHTML = auditRows(cache.audit || [], el.value); };
acts['audit-verify'] = async () => { const r = await api('GET', '/api/admin/audit/verify'); toast(r.ok ? `The log is intact. ${r.checked} entries checked.` : `Entry ${r.brokenAt} was changed or removed.`, r.ok ? '' : 'err'); };
acts['audit-export'] = async () => { const r = await api('GET', '/api/admin/audit/export'); downloadText(r.name + '.csv', r.csv, 'text/csv'); };
acts['act-tab'] = el => { actTab = el.dataset.v; rerender(); };
acts.rollback = el => confirmBox(`Roll back to config v${el.dataset.v}?`, 'A new config with those settings is saved and deployed. The current one stays in the list.', 'Roll back', async () => { await api('POST', '/api/app/rollback', { v: +el.dataset.v }); cache.key = ''; await refresh(); watchDeploy(); }, false);

function pageManage(tab) {
  const B = S.boot, a = B.app;
  if (a.status === 'not_installed') return osShell('apps', 'Apps', `<a class="back" href="#/os/apps">${icon('arrow_back')}Apps</a><div class="empty">${icon('forum')}VanikGPT is not installed on this appliance.<br><button class="btn" data-act="app-install">Install</button></div>`);
  const st = appStatus(), tabs = [['overview', 'Overview'], ['setup', 'Setup'], ['usage', 'Usage'], ['activity', 'Activity']];
  if (!tabs.some(t => t[0] === tab)) tab = 'overview';
  ensureDraft();
  ensure('manage:' + tab, async () => { if (tab === 'activity') cache.audit = await api('GET', '/api/admin/audit'); else cache.usage = await api('GET', '/api/admin/usage'); });
  watchDeploy();
  const html = osShell('apps', `<a href="#/os/apps">Apps</a> / VanikGPT`, `
    <a class="back" href="#/os/apps">${icon('arrow_back')}Apps</a>
    <div class="page-head"><span class="app-ico" style="width:48px;height:48px;border-radius:13px">${icon('forum')}</span>
      <div class="grow"><div class="row"><h1 style="font-size:28px">VanikGPT</h1>${chip(st[0], st[1])}</div><p class="mono" style="margin-top:9px">${esc(B.device.name)} · port ${a.port}${a.deployedVersion ? ' · config v' + a.deployedVersion : ''} · ${esc(a.image)}</p></div>
      ${a.status === 'running' && B.device.online ? `<a class="btn lg" href="#/gpt">Open VanikGPT</a>` : ''}<button class="icon-btn bordered" data-act="app-menu" aria-label="More">${icon('more_vert')}</button></div>
    <div id="deploy-box">${deployBox()}</div>
    <nav class="tabs">${tabs.map(t => `<a class="${t[0] === tab ? 'on' : ''}" href="#/os/apps/vanikgpt/${t[0]}">${t[1]}</a>`).join('')}</nav>
    ${{ overview: tabOverview, setup: tabSetup, usage: tabUsage, activity: tabActivity }[tab]()}`);
  if (tab === 'setup') queueMicrotask(saveBar);
  return html;
}

// ---------- Knowledge base
const usedByGpt = id => { const a = S.boot.app; return a.status !== 'not_installed' && (a.config.collections === 'all' || a.config.collections.includes(id)); };
function pageKnowledge() {
  const B = S.boot, docs = B.collections.reduce((n, c) => n + c.docCount, 0), size = B.collections.reduce((n, c) => n + c.bytes, 0);
  return osShell('knowledge', 'Knowledge base', `
    <div class="page-head"><div class="grow"><h1>Knowledge base</h1><p class="sub">Document collections your apps search. Everything stays on the Vanik Appliance.</p></div><button class="btn lg" data-act="col-new">New collection</button></div>
    ${B.collections.length ? `<div class="grid">${B.collections.map(c => `<a class="card app-card" href="#/os/knowledge/${c.id}">
      <div class="row"><span class="avatar sq">${esc(initials(c.name))}</span><div class="grow"><h3 class="ellipsis">${esc(c.name)}</h3><span class="mono">${c.docCount} ${c.docCount === 1 ? 'document' : 'documents'} · ${bytes(c.bytes)}</span></div><button class="icon-btn sm" data-act="col-menu" data-id="${c.id}" data-stop aria-label="More">${icon('more_vert')}</button></div>
      <div class="row wrap" style="gap:6px">${chip(c.docCount ? 'Searchable' : 'Empty', c.docCount ? 'ok' : '')}${chip(accessLabel(c.access), 'line', false)}${usedByGpt(c.id) ? chip('Used by VanikGPT', 'line', false) : chip('Not used by an app yet', 'line', false)}</div>
      <div class="foot"><span class="small faint grow">Updated ${ago(c.updatedAt)}</span><span class="small" style="font-weight:600">${c.docCount ? 'Open' : 'Add documents'} →</span></div></a>`).join('')}</div>
      <p class="mono" style="margin-top:18px">${B.collections.length} ${B.collections.length === 1 ? 'collection' : 'collections'} · ${docs} ${docs === 1 ? 'document' : 'documents'} · ${bytes(size)}</p>`
    : `<div class="empty">${icon('library_books')}No collections yet. A collection is a set of documents an app can search.<br><button class="btn" data-act="col-new">New collection</button></div>`}`);
}
acts['col-new'] = () => modal({ title: 'New collection', body: `<div class="stack"><label class="field"><span>Name</span><input class="input" id="f-name" maxlength="80" placeholder="HR policies"></label><label class="field"><span>What is in it ${info('Shown to people when they choose where answers come from.')}</span><input class="input" id="f-desc" maxlength="140" placeholder="Leave, travel and expense rules"></label></div>`,
  actions: [{ label: 'Create', run: async o => { const c = await api('POST', '/api/collections', { name: $('#f-name', o).value, description: $('#f-desc', o).value }); await load(); go('#/os/knowledge/' + c.id); } }] });
const colDelete = c => confirmBox(`Delete "${c.name}"?`, `Its ${c.docCount} ${c.docCount === 1 ? 'document is' : 'documents are'} removed from the appliance. Answers will stop citing them. This cannot be undone.`, 'Delete', async () => { await api('DELETE', '/api/collections/' + c.id); await load(); go('#/os/knowledge'); });
const colRename = c => modal({ title: 'Rename collection', body: `<div class="stack"><label class="field"><span>Name</span><input class="input" id="f-name" maxlength="80" value="${esc(c.name)}"></label><label class="field"><span>What is in it</span><input class="input" id="f-desc" maxlength="140" value="${esc(c.description)}"></label></div>`, actions: [{ label: 'Save', run: async o => { await api('PATCH', '/api/collections/' + c.id, { name: $('#f-name', o).value, description: $('#f-desc', o).value }); await refresh(); } }] });
acts['col-menu'] = el => { const c = S.boot.collections.find(x => x.id === el.dataset.id); menu(el, [{ label: 'Rename', icon: 'edit', run: () => colRename(c) }, '-', { label: 'Delete', icon: 'delete_outline', danger: true, run: () => colDelete(c) }]); };

export async function uploadFiles(url, files, extra = {}) {
  let ok = 0; const bad = [];
  for (const f of files) {
    const say = t => { const box = $('#uploads'); if (box) box.innerHTML = `<div class="banner plain">${icon('upload_file')}<span>${esc(t)}</span></div>`; };
    say(`Reading ${f.name} (${ok + bad.length + 1} of ${files.length})…`);
    try { await api('POST', url, { ...(await extractFile(f, say)), ...extra }); ok++; } catch (e) { bad.push(e.message); }
  }
  const box = $('#uploads'); if (box) box.innerHTML = '';
  if (ok) toast(`${ok} ${ok === 1 ? 'document' : 'documents'} added.`);
  bad.forEach(m => toast(m, 'err'));
  return ok;
}
let colAccessFor = '';
function pageCollection(id) {
  const B = S.boot, c = B.collections.find(x => x.id === id);
  if (!c) return osShell('knowledge', 'Knowledge base', `<a class="back" href="#/os/knowledge">${icon('arrow_back')}Knowledge base</a><div class="empty">This collection no longer exists.</div>`);
  ensure('col:' + id, async () => { cache.docs[id] = await api('GET', `/api/collections/${id}/documents`); });
  if (colAccessFor !== id + JSON.stringify(c.access)) { colAccessFor = id + JSON.stringify(c.access); accessDrafts.col = JSON.parse(JSON.stringify(c.access)); }
  accessChanged.col = () => { const b = $('#acc-save'); if (b) b.classList.toggle('hidden', JSON.stringify(accessDrafts.col) === JSON.stringify(c.access)); };
  const docs = cache.docs[id];
  return osShell('knowledge', `<a href="#/os/knowledge">Knowledge base</a> / ${esc(c.name)}`, `
    <a class="back" href="#/os/knowledge">${icon('arrow_back')}Knowledge base</a>
    <div class="page-head"><span class="avatar sq" style="width:48px;height:48px;font-size:15px">${esc(initials(c.name))}</span><div class="grow"><h1 style="font-size:28px">${esc(c.name)}</h1><p class="sub">${esc(c.description || 'No description')} · ${c.docCount} ${c.docCount === 1 ? 'document' : 'documents'} · ${bytes(c.bytes)}</p></div>
      <button class="btn lg" data-act="doc-add" data-id="${id}">${icon('add')}Add documents</button><button class="icon-btn bordered" data-act="col-menu" data-id="${id}" aria-label="More">${icon('more_vert')}</button></div>
    <div id="uploads"></div>
    <div class="grid two" style="align-items:start;grid-template-columns:minmax(0,1.7fr) minmax(0,1fr)">
      <div class="card"><div class="card-head"><h3>Documents</h3></div>
        ${!docs ? `<p class="muted">Loading…</p>` : docs.length ? `<table class="list"><tr><th>Name</th><th>Size</th><th>Added</th><th></th></tr>${docs.map(d => `<tr><td><a class="link" href="#/gpt/source/${d.id}/-/os">${esc(d.name)}</a><div class="mono">${d.paged ? d.pages + ' pages · ' : ''}${d.chunks} passages</div>
          <div class="row wrap" style="gap:5px;margin-top:5px">${[d.purpose && 'For: ' + d.purpose, d.expiresOn && 'Keep until ' + d.expiresOn, d.restrict.length && 'Only ' + d.restrict.join(', '), d.pii.length && 'Masked: ' + d.pii.join(', '), d.ocr && 'Read from a scan', d.synced && 'From a folder', d.note && 'Note from chat', d.transcribed && 'Recording with transcript', d.waiting && 'Waiting for a transcript'].filter(Boolean).map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div></td><td class="muted">${bytes(d.size)}</td><td class="muted">${ago(d.uploadedAt)}<div class="small faint">${esc(d.uploadedBy)}</div></td><td class="act">${d.waiting ? `<button class="icon-btn sm" data-act="doc-transcript" data-id="${d.id}" data-name="${esc(d.name)}" data-tip="Add the transcript" aria-label="Add the transcript">${icon('subtitles')}</button>` : ''}<button class="icon-btn sm" data-act="doc-edit" data-id="${d.id}" data-col="${id}" data-tip="Purpose, keep until, teams" aria-label="Document rules">${icon('tune')}</button><button class="icon-btn sm" data-act="doc-del" data-id="${d.id}" data-name="${esc(d.name)}" data-tip="Remove" aria-label="Remove">${icon('delete_outline')}</button></td></tr>`).join('')}</table>` : ''}
        <div class="drop" data-drop="${id}" style="margin-top:${docs && docs.length ? 16 : 0}px">${icon('upload_file')} Drop files here, or <button class="link" data-act="doc-add" data-id="${id}">choose files</button><div class="small faint" style="margin-top:6px">PDF, Word, Excel, text, code, CSV, HTML, images of scans and recordings. Files are read and stored on the appliance.</div></div></div>
      <div class="stack" style="gap:16px">
        <div class="card"><div class="card-head"><h3>Who can use it</h3>${info('Only these people get answers from this collection, in any app.')}</div>${accessPicker('col', 'Everyone on this tenant')}<button class="btn hidden" id="acc-save" style="margin-top:14px" data-act="col-access" data-id="${id}">Save</button></div>
        <div class="card"><div class="card-head"><h3>Search</h3>${info('Keyword search always works. Meaning-based search is added when an embedding model is serving, so a question can find a passage that uses different words.')}</div>
          <div class="row">${chip('Keyword', 'ok')}${c.embedded ? chip(`Meaning: ${c.embedded} of ${c.passages} passages`, c.embedded === c.passages ? 'ok' : 'warn') : chip('Meaning: off', '')}<span class="grow"></span>${B.embeddingReady && c.embedded < c.passages ? `<button class="btn ghost" data-act="col-reindex" data-id="${id}">Build</button>` : ''}</div>
          ${!B.embeddingReady && !c.embedded ? `<p class="small muted" style="margin-top:10px">Meaning-based search turns on when an embedding model is serving in <a class="link" href="#/os/models">Model Hub</a> and the model gateway is reachable.</p>` : ''}</div>
        <div class="card"><div class="card-head"><h3>Try a search</h3>${info('Shows the passages an app would get for a question.')}</div><input class="input" id="try-q" placeholder="Type a question and press Enter" data-id="${id}"><div id="try-res" class="stack" style="margin-top:12px;gap:10px"></div></div>
        <div class="card flat"><div class="row">${icon('apps')}<span class="grow">${usedByGpt(id) ? 'Used by VanikGPT' : 'Not used by an app yet'}</span>${B.app.status !== 'not_installed' ? `<a class="link small" href="#/os/apps/vanikgpt/setup">Change</a>` : ''}</div></div>
      </div></div>`);
}
acts['doc-add'] = async el => { const files = await pickFiles(); if (!files.length) return; await uploadFiles(`/api/collections/${el.dataset.id}/documents`, files); cache.key = ''; await refresh(); };
acts['col-reindex'] = async el => { el.disabled = true; el.textContent = 'Building…'; await api('POST', `/api/collections/${el.dataset.id}/reindex`); toast('Meaning-based search is ready for this collection.'); await refresh(); };
acts['doc-edit'] = el => {
  const d = (cache.docs[el.dataset.col] || []).find(x => x.id === el.dataset.id), teams = S.boot.teams; if (!d) return;
  const m = modal({ title: 'Rules for this document', text: d.name, body: `<div class="stack"><label class="field"><span>What it is for ${info('The purpose this document may be used for. Shown to admins and kept in the audit log.')}</span><input class="input" id="f-purpose" maxlength="120" value="${esc(d.purpose)}" placeholder="Vendor onboarding"></label>
    <label class="field"><span>Keep until ${info('After this date the document is no longer searched and is removed from the appliance.')}</span><input class="input" id="f-exp" type="date" value="${esc(d.expiresOn)}"></label>
    <div><div class="small" style="font-weight:600;margin-bottom:8px">Only these teams ${info('Leave empty to follow the collection. Owners and admins always have access.')}</div><div class="row wrap" style="gap:6px" id="f-teams">${teams.length ? teams.map(t => `<button class="tag ${d.restrict.includes(t) ? 'on' : ''}" data-v="${esc(t)}">${esc(t)}</button>`).join('') : '<span class="small muted">No teams yet. Add them on the People page.</span>'}</div></div></div>`,
    actions: [{ label: 'Save', run: async o => { await api('PATCH', '/api/documents/' + d.id, { purpose: $('#f-purpose', o).value, expiresOn: $('#f-exp', o).value, restrict: [...o.querySelectorAll('#f-teams .on')].map(b => b.dataset.v) }); cache.key = ''; await refresh(); } }] });
  $('#f-teams', m.el).onclick = e => { const b = e.target.closest('button'); if (b) b.classList.toggle('on'); };
};
acts['doc-transcript'] = el => modal({ title: 'Transcript for ' + el.dataset.name, wide: true, text: 'A recording is transcribed on the appliance when a speech model is serving. None is serving now, so paste the transcript here to make it searchable.', body: `<textarea class="input" id="f-tr" rows="10" placeholder="Speaker: what was said…"></textarea>`,
  actions: [{ label: 'Save', run: async o => { await api('POST', `/api/documents/${el.dataset.id}/transcript`, { text: $('#f-tr', o).value }); cache.key = ''; toast('Transcript added. The recording can now be searched.'); await refresh(); } }] });
acts['doc-del'] = el => confirmBox(`Remove "${el.dataset.name}"?`, 'Answers will stop citing this document.', 'Remove', async () => { await api('DELETE', '/api/documents/' + el.dataset.id); cache.key = ''; await refresh(); });
acts['col-access'] = async el => { await api('PATCH', '/api/collections/' + el.dataset.id, { access: accessDrafts.col }); toast('Access saved.'); await refresh(); };
document.addEventListener('keydown', async e => {
  if (e.key !== 'Enter' || e.target.id !== 'try-q') return;
  const res = $('#try-res'), hits = await api('POST', '/api/search', { q: e.target.value, collectionId: e.target.dataset.id });
  res.innerHTML = hits.length ? hits.map(h => `<a class="card flat" style="padding:12px" href="#/gpt/source/${h.docId}/${h.chunkId}/os"><div class="small faint ellipsis">${esc(h.docName)}${h.page ? ' · page ' + h.page : ''} · matched by ${h.via === 'both' ? 'keyword and meaning' : h.via}</div><div class="small" style="margin-top:4px">${esc(h.text.slice(0, 220))}${h.text.length > 220 ? '…' : ''}</div></a>`).join('') : `<p class="small muted">Nothing in this collection matches.</p>`;
});
for (const ev of ['dragover', 'dragleave', 'drop']) document.addEventListener(ev, async e => {
  const z = e.target.closest && e.target.closest('[data-drop]'); if (!z) return;
  e.preventDefault(); z.classList.toggle('over', ev === 'dragover');
  if (ev === 'drop' && e.dataTransfer.files.length) { await uploadFiles(`/api/collections/${z.dataset.drop}/documents`, [...e.dataTransfer.files]); cache.key = ''; await refresh(); }
});

// ---------- Model Hub
function pageModels() {
  const B = S.boot, d = B.device, used = id => B.app.status !== 'not_installed' && B.app.config.models.includes(id);
  watchModels();
  const order = { serving: 0, starting: 0, parked: 1, available: 2 }, list = [...B.models].sort((a, b) => order[a.status] - order[b.status] || a.memGb - b.memGb);
  return osShell('models', 'Model Hub', `
    <div class="page-head"><div><h1>Model Hub</h1><p class="sub">${B.models.length} models · ${d.serving} serving</p></div></div>
    <div class="card" style="margin-bottom:18px"><div class="row"><div class="grow"><div class="stat"><span class="k">GPU memory ${info('Memory in use by serving models and installed apps.')}</span></div><div class="row" style="margin-top:8px"><b style="font-size:22px">${d.usedGb}</b><span class="muted">/ ${d.memGb} GB</span><span class="right muted small">${d.freeGb} GB free · ${d.serving} of ${d.slots} model slots in use</span></div><div class="meter" style="margin-top:10px"><i style="width:${Math.min(100, Math.round(100 * d.usedGb / d.memGb))}%"></i></div></div></div></div>
    <div class="card"><table class="list"><tr><th>Model</th><th>Type</th><th>Memory</th><th>Context</th><th>Status</th><th></th></tr>
    ${list.map(m => `<tr><td><div class="row"><span class="avatar sq">${esc(m.id.slice(0, 2).toUpperCase())}</span><div><b>${esc(m.id)}</b>${m.note ? `<div class="small faint">${esc(m.note)}</div>` : ''}${used(m.id) ? `<div class="small faint">Used by VanikGPT</div>` : ''}</div></div></td>
      <td>${m.kind === 'chat' ? 'Text generation' : 'Embeddings'}</td><td>${m.memGb} GB</td><td class="muted">${m.context ? m.context.toLocaleString() : '—'}</td>
      <td>${m.status === 'serving' ? chip('Serving', 'ok') + ` <span class="mono">port ${m.port}</span>` : m.status === 'starting' ? chip('Starting', 'warn') : m.status === 'parked' ? chip('Parked', '') : chip('Not on device', '')}${m.testedAt && m.status === 'serving' ? `<div class="small faint">Test question passed ${ago(m.testedAt)}</div>` : ''}</td>
      <td class="act">${m.status === 'serving' ? `<button class="btn ghost" data-act="model-park" data-id="${esc(m.id)}">Park</button>` : m.status === 'starting' ? `<button class="btn ghost" data-act="model-cancel" data-id="${esc(m.id)}">Cancel</button>` : `<button class="btn" data-act="model-serve" data-id="${esc(m.id)}">Serve</button>`}</td></tr>`).join('')}</table></div>`);
}
let modelT = null;
function watchModels() {
  if (modelT || !S.boot.models.some(m => m.status === 'starting')) return;
  const ids = S.boot.models.filter(m => m.status === 'starting').map(m => m.id);
  modelT = setInterval(async () => {
    try { await load(); } catch { return; }
    if (S.boot.models.some(m => m.status === 'starting')) return;
    clearInterval(modelT); modelT = null;
    ids.forEach(id => { const m = S.boot.models.find(x => x.id === id); toast(m.status === 'serving' ? id + ' is serving.' : id + ' did not start. See Devices for the reason.', m.status === 'serving' ? '' : 'err'); });
    if (location.hash.startsWith('#/os/')) rerender();
  }, 500);
}
acts['model-serve'] = async el => { el.disabled = true; await api('POST', `/api/models/${encodeURIComponent(el.dataset.id)}/serve`); await refresh(); };
acts['model-cancel'] = async el => { await api('POST', `/api/models/${encodeURIComponent(el.dataset.id)}/park`); clearInterval(modelT); modelT = null; await refresh(); };
acts['model-park'] = el => {
  const B = S.boot, id = el.dataset.id, park = async () => { await api('POST', `/api/models/${encodeURIComponent(id)}/park`); toast(id + ' is parked. Its memory is free.'); await refresh(); };
  const cfg = B.app.config, last = B.app.status !== 'not_installed' && cfg.models.includes(id) && !cfg.models.some(x => x !== id && B.models.some(m => m.id === x && m.status === 'serving'));
  return last ? confirmBox(`Park ${id}?`, 'VanikGPT has no other serving model. Until you serve one, answers are built from documents only.', 'Park', park) : park();
};

// ---------- People
function pagePeople() {
  const B = S.boot;
  return osShell('people', 'People', `
    <div class="page-head"><div class="grow"><h1>People</h1><p class="sub">Who can reach this tenant, and what they can do.</p></div><button class="btn lg" data-act="user-invite">Invite someone</button></div>
    <div class="card"><table class="list"><tr><th>Name</th><th>Email</th><th>Role ${info('Owners and admins run the appliance. App users only use the apps they are given.')}</th><th>Teams ${info('Use teams to give a group of people an app or a collection in one go.')}</th><th>Last active</th><th></th></tr>
    ${B.users.map(u => `<tr><td><div class="row"><span class="avatar">${esc(initials(u.name))}</span><b>${esc(u.name)}</b>${u.id === B.me.id ? `<span class="faint small">you</span>` : ''}</div></td><td class="muted">${esc(u.email)}</td>
      <td>${u.role === 'owner' ? ROLE.owner : `<select class="input" style="height:32px;width:130px" data-change="user-role" data-id="${u.id}"><option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option><option value="user" ${u.role === 'user' ? 'selected' : ''}>App user</option></select>`}</td>
      <td><div class="row wrap" style="gap:5px">${(u.teams || []).map(t => `<span class="tag">${esc(t)}</span>`).join('')}<button class="icon-btn sm" data-act="user-teams" data-id="${u.id}" data-tip="Edit teams" aria-label="Edit teams">${icon('edit')}</button></div></td>
      <td class="muted">${u.status === 'invited' ? chip('Invited', 'warn') : ago(u.lastActiveAt)}</td>
      <td class="act"><button class="icon-btn sm tip-left" data-act="user-erase" data-id="${u.id}" data-tip="Erase their chats and files" aria-label="Erase data">${icon('cleaning_services')}</button>${u.role === 'owner' ? '' : `<button class="icon-btn sm" data-act="user-remove" data-id="${u.id}" data-tip="Remove" aria-label="Remove">${icon('person_remove')}</button>`}</td></tr>`).join('')}</table></div>
    <p class="mono" style="margin-top:18px">${B.users.length} ${B.users.length === 1 ? 'user' : 'users'}</p>`);
}
const teamsOf = v => v.split(',').map(s => s.trim()).filter(Boolean);
acts['user-invite'] = () => {
  let role = 'user';
  const m = modal({ title: 'Invite someone', body: `<div class="stack"><label class="field"><span>Name</span><input class="input" id="f-name" placeholder="Asha Verma"></label><label class="field"><span>Work email</span><input class="input" id="f-email" type="email" placeholder="asha@company.com"></label>
    <div class="field"><span class="row" style="gap:5px;font-size:12.5px;font-weight:600">Role</span><div style="margin-top:6px"><div class="seg" id="f-role"><button class="on" data-v="user">App user</button><button data-v="admin">Admin</button></div></div></div>
    <label class="field"><span>Teams ${info('Optional. Separate with commas.')}</span><input class="input" id="f-teams" placeholder="Finance, Legal"></label></div>`,
    actions: [{ label: 'Send invite', run: async o => { await api('POST', '/api/users', { name: $('#f-name', o).value, email: $('#f-email', o).value, role, teams: teamsOf($('#f-teams', o).value) }); toast('Invite sent.'); await refresh(); } }] });
  $('#f-role', m.el).onclick = e => { const b = e.target.closest('button'); if (!b) return; role = b.dataset.v; [...b.parentNode.children].forEach(x => x.classList.toggle('on', x === b)); };
};
ins['user-role'] = async el => { await api('PATCH', '/api/users/' + el.dataset.id, { role: el.value }); toast('Role changed.'); await refresh(); };
acts['user-teams'] = el => { const u = S.boot.users.find(x => x.id === el.dataset.id); modal({ title: 'Teams for ' + u.name, body: `<label class="field"><span>Teams ${info('Separate with commas.')}</span><input class="input" id="f-teams" value="${esc((u.teams || []).join(', '))}" placeholder="Finance, Legal"></label>`, actions: [{ label: 'Save', run: async o => { await api('PATCH', '/api/users/' + u.id, { teams: teamsOf($('#f-teams', o).value) }); await refresh(); } }] }); };
acts['user-erase'] = el => { const u = S.boot.users.find(x => x.id === el.dataset.id); confirmBox(`Erase ${u.name}'s data?`, 'Their chats, files attached in chats, saved prompts, private agents and feedback are removed for good. The account stays.', 'Erase', async () => { const r = await api('POST', `/api/users/${u.id}/erase`); const n = (c, w) => `${c} ${w}${c === 1 ? "" : "s"}`; toast(`Erased ${n(r.chats, "chat")}, ${n(r.files, "file")} and ${n(r.prompts, "prompt")}.`); await refresh(); }); };
acts['user-remove'] = el => { const u = S.boot.users.find(x => x.id === el.dataset.id); confirmBox(`Remove ${u.name}?`, 'They lose access to every app straight away. Their chats are deleted.', 'Remove', async () => { await api('DELETE', '/api/users/' + u.id); await refresh(); }); };

// ---------- Settings and unchanged pages
function pageSettings() {
  const d = S.boot.device;
  return osShell('settings', 'Settings', `
    <div class="page-head"><div><h1>Settings</h1><p class="sub">Tenant-wide configuration.</p></div></div>
    <div class="card" style="max-width:820px"><div class="row"><div class="grow"><h3>${d.online ? 'Take Vanik Appliance offline' : 'Bring Vanik Appliance online'}</h3><p class="small muted">${d.online ? 'Stops all running apps and model servers on ' + esc(d.name) + '.' : esc(d.name) + ' is offline. Apps and models are stopped.'}</p></div><button class="btn ${d.online ? 'danger' : ''}" data-act="device-toggle">${d.online ? 'Go offline' : 'Go online'}</button></div></div>
    <div class="banner plain" style="max-width:820px;margin-top:16px">${icon('info_outline')}<span>Tenant name, ports and agent updates work as they do in Vanik OS today.</span><a class="btn ghost" href="${LIVE_OS}settings" target="_blank" rel="noopener">Open in Vanik OS ${icon('open_in_new')}</a></div>`);
}
acts['device-toggle'] = () => { const on = S.boot.device.online, run = async () => { await api('POST', '/api/device/online', { online: !on }); await refresh(); }; return on ? confirmBox('Take the appliance offline?', 'Every app stops and nobody can chat until you bring it back.', 'Go offline', run) : run(); };
function pageSame(key) {
  const n = NAV.find(x => x[0] === key) || ['home', 'Home', 'home'];
  return osShell(n[0], n[1], `<div class="page-head"><div><h1>${n[1]}</h1></div></div><div class="empty" style="max-width:820px">${icon(n[2])}${n[1]} works as it does in Vanik OS today. VanikGPT does not change this page.<br><a class="btn ghost" href="${LIVE_OS}${n[0]}" target="_blank" rel="noopener">Open in Vanik OS ${icon('open_in_new')}</a></div>`);
}

// ---------- command palette
acts.palette = () => {
  const B = S.boot, items = [
    ...(B.admin ? NAV.filter(n => typeof n !== 'string').map(n => ({ label: n[1], icon: n[2], hash: '#/os/' + n[0] })) : []),
    ...(B.admin && B.app.status !== 'not_installed' ? [{ label: 'VanikGPT setup', icon: 'tune', hash: '#/os/apps/vanikgpt/setup' }] : []),
    ...(B.canUseGpt ? [{ label: 'New chat', icon: 'add_comment', hash: '#/gpt' }, { label: 'Agents', icon: 'smart_toy', hash: '#/gpt/assistants' }, { label: 'Workflows', icon: 'fact_check', hash: '#/gpt/flows' }] : []),
    ...(B.admin ? B.collections.map(c => ({ label: c.name, icon: 'library_books', hash: '#/os/knowledge/' + c.id, sub: 'Collection' })) : []),
    ...(B.canUseGpt ? B.chats.map(c => ({ label: c.title, icon: 'chat_bubble_outline', hash: '#/gpt/c/' + c.id, sub: 'Chat' })) : []),
  ];
  const o = document.createElement('div'); o.className = 'overlay'; o.style.placeItems = 'start center'; o.style.paddingTop = '12vh';
  o.innerHTML = `<div class="modal wide palette"><input placeholder="Search pages, collections and chats" aria-label="Search"><div class="res"></div></div>`;
  const inp = $('input', o), res = $('.res', o), close = () => o.remove();
  const draw = () => { const q = inp.value.toLowerCase(), r = items.filter(i => i.label.toLowerCase().includes(q)).slice(0, 12); res.innerHTML = r.length ? r.map((i, n) => `<button class="${n ? '' : 'sel'}" data-h="${esc(i.hash)}">${icon(i.icon)}<span class="grow ellipsis">${esc(i.label)}</span>${i.sub ? `<span class="mono">${i.sub}</span>` : ''}</button>`).join('') : `<p class="small muted" style="padding:10px">Nothing matches.</p>`; };
  inp.oninput = draw; res.onclick = e => { const b = e.target.closest('button'); if (b) { close(); go(b.dataset.h); } };
  o.onmousedown = e => { if (e.target === o) close(); };
  o.onkeydown = e => { if (e.key === 'Escape') close(); if (e.key === 'Enter') { const b = $('.res button', o); if (b) { close(); go(b.dataset.h); } } };
  document.body.appendChild(o); draw(); inp.focus();
};
document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey || e.altKey) && e.key.toLowerCase() === 'k' && S.boot) { e.preventDefault(); if (!$('.palette')) acts.palette(); } });
// space/enter on role=checkbox rows
document.addEventListener('keydown', e => { if ((e.key === ' ' || e.key === 'Enter') && e.target.matches && e.target.matches('.check[tabindex]')) { e.preventDefault(); e.target.click(); } });

export function osPage(parts) {
  if (!S.boot.admin) return null;
  const [p, a, b] = parts;
  if (p === 'apps' && a === 'vanikgpt') return pageManage(b || 'overview');
  if (p === 'apps') return pageApps();
  if (p === 'knowledge') return a ? pageCollection(a) : pageKnowledge();
  if (p === 'models') return pageModels();
  if (p === 'people') return pagePeople();
  if (p === 'settings') return pageSettings();
  return pageSame(p);
}
