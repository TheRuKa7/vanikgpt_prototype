// Running the appliance, in Vanik OS: a home card that says how to reach it, Devices tabs for network, storage, monitoring
// and support, updates and power in Settings, a company directory in People, and models from outside the network in Model Hub.
// In VanikGPT: a person's own API page. Ideas taken from a review of Locai One.
import { S, $, esc, icon, info, chip, go, ago, when, api, refresh, rerender, acts, ins, toast, modal, confirmBox, navToggle, downloadText } from './core.js';
import { osShell } from './os.js';
import { gptShell } from './gpt.js';

const X = { d: null, key: '', prov: 'openrouter', my: null, myKey: '' };
export const edgeRouteChanged = () => { X.key = ''; X.myKey = ''; };
const load = () => api('GET', '/api/edge').then(d => { X.d = d; rerender(); }).catch(() => {});
const need = () => { if (X.key !== 'edge') { X.key = 'edge'; load(); } return X.d; };
const put = async (path, body, method = 'PUT') => { X.d = await api(method, path, body); rerender(); };
const copy = t => `<button class="icon-btn sm" data-act="copy" data-text="${esc(t)}" data-tip="Copy" aria-label="Copy">${icon('content_copy')}</button>`;
acts.copy = async el => { try { await navigator.clipboard.writeText(el.dataset.text); toast('Copied.'); } catch { toast('Could not copy. Select the text instead.', 'err'); } };
const tabs = (items, on, base) => `<nav class="tabs" style="margin-bottom:20px">${items.map(t => `<a class="${t[0] === on ? 'on' : ''}" href="${base}${t[0] ? '/' + t[0] : ''}">${t[1]}</a>`).join('')}</nav>`;
const DEV = [['', 'Overview'], ['network', 'Network'], ['storage', 'Storage'], ['monitoring', 'Monitoring'], ['support', 'Support']], HUB = [['', 'On this appliance'], ['outside', 'Outside your network']];
const bar = (used, total) => `<div class="meter"><i style="width:${Math.min(100, Math.max(1, used / total * 100)).toFixed(1)}%"></i></div>`;

// ---------- pieces added to pages that already exist
function hero() {
  const B = S.boot, d = B.device, n = (X.d || {}).network || B.network || {}, local = 'https://' + (n.local || 'vanik.local'), up = d.online;
  return `<div class="hero-card"><div class="row"><span class="cap">Vanik Appliance</span>${chip(up ? 'Healthy' : 'Offline', up ? 'ok' : 'err')}<a class="btn ghost right" href="#/os/devices/network">Network</a></div>
    <h2>${esc(d.name)}</h2>
    <div class="facts"><div><span class="cap">Vanik OS</span><b>${esc(d.agent)}</b></div><div><span class="cap">People</span><b>${B.users.length}</b></div><div><span class="cap">Models serving</span><b>${d.serving} of ${d.slots}</b></div><div><span class="cap">GPU memory</span><b>${d.usedGb} / ${d.memGb} GB</b></div></div>
    <div class="addr"><div><span class="cap">Inside the office</span><div class="row"><span class="mono">${esc(local)}</span>${copy(local)}</div></div>${n.publicOn && n.domain ? `<div><span class="cap">From anywhere</span><div class="row"><span class="mono">https://${esc(n.domain)}</span>${copy('https://' + n.domain)}</div></div>` : `<div><span class="cap">From anywhere</span><div class="small" style="opacity:.7;margin-top:4px">Closed. Only the office network can reach it.</div></div>`}</div></div>`;
}
function directoryCard() {
  const dir = (X.d || {}).directory;
  return `<div class="card" style="margin-bottom:16px"><div class="row"><span class="avatar sq">${icon('badge')}</span><div class="grow"><b>Company directory</b><div class="small muted">${dir ? `${esc(dir.provider)} · ${dir.people} people · synced ${ago(dir.syncedAt)}` : 'Bring people in from the directory your company already has, instead of inviting them one by one.'}</div></div>${dir ? `<button class="btn ghost" data-act="dir-sync">Sync now</button><button class="btn ghost" data-act="dir-off">Disconnect</button>` : `<button class="btn ghost" data-act="dir-on">Connect</button>`}</div></div>`;
}
acts['dir-on'] = () => modal({ title: 'Connect a directory', text: 'People and their teams are kept in step with the directory. This build has no directory to call, so it marks the people already here as coming from it.', body: `<select class="input" id="d-prov"><option>Microsoft Entra ID</option><option>Google Workspace</option><option>Okta</option></select>`, actions: [{ label: 'Connect', run: async o => { await put('/api/edge/directory', { provider: $('#d-prov', o).value }, 'POST'); toast('Directory connected.'); } }] });
acts['dir-sync'] = async () => { await put('/api/edge/directory/sync', {}, 'POST'); toast('Synced.'); };
acts['dir-off'] = () => confirmBox('Disconnect the directory?', 'People stay as they are. New joiners will have to be invited by hand.', 'Disconnect', () => put('/api/edge/directory', null, 'DELETE'), false);
function systemCards() {
  const d = X.d; if (!d) return '';
  const u = d.updates, a = d.about;
  return `<div class="stack" style="max-width:820px;gap:16px;margin-bottom:16px">
    <div class="card"><div class="card-head"><h3>This appliance</h3></div><dl class="kv"><dt>Name</dt><dd>${esc(a.name)}</dd><dt>Address</dt><dd class="mono">${esc(a.ip)}</dd><dt>GPU memory</dt><dd>${esc(a.gpuMemory)}</dd><dt>Disk</dt><dd>${esc(a.disk)}</dd><dt>Model slots</dt><dd>${a.slots}</dd><dt>Vanik OS</dt><dd>${esc(u.version)}</dd></dl></div>
    <div class="card"><div class="row"><div class="grow"><h3>${u.latest === u.version ? 'Vanik OS is up to date' : 'An update is ready'}</h3><p class="small muted">Version ${esc(u.version)}${u.checkedAt ? ' · checked ' + ago(u.checkedAt) : ''}</p></div><button class="btn ghost" data-act="up-check">Check again</button></div>
      <div class="set-row" style="margin-top:12px"><div class="grow"><div class="lbl">Go back to the version before</div><div class="small muted">${u.previous.length ? 'Version ' + esc(u.previous[0]) + '. Apps and data are kept.' : 'No earlier version on this appliance.'}</div></div><button class="btn ghost" data-act="up-back" ${u.previous.length ? '' : 'disabled'}>Roll back</button></div></div>
    <div class="card"><div class="card-head"><h3>Power</h3></div>
      <div class="set-row"><div class="grow"><div class="lbl">Restart</div><div class="small muted">Apps and models stop for a few seconds, then come back.</div></div><button class="btn ghost" data-act="pw" data-v="restart">Restart</button></div>
      <div class="set-row"><div class="grow"><div class="lbl">Shut down</div><div class="small muted">Stays off until someone powers it on.</div></div><button class="btn danger" data-act="pw" data-v="shutdown">Shut down</button></div>
      <div class="set-row"><div class="grow"><div class="lbl">Factory reset ${info('Erases people, chats, documents and downloaded models. Vanik OS stays. This build asks for the confirmation but does not erase anything.')}</div><div class="small muted">Erases everything except Vanik OS.</div></div><button class="btn danger" data-act="pw" data-v="reset">Reset</button></div></div></div>`;
}
acts['up-check'] = async () => { await put('/api/edge/updates/check', {}, 'POST'); toast('Vanik OS is up to date.'); };
acts['up-back'] = () => confirmBox('Roll back Vanik OS?', `It goes back to version ${X.d.updates.previous[0]}. Apps and data are kept.`, 'Roll back', async () => { await put('/api/edge/updates/rollback', {}, 'POST'); await refresh(); }, false);
acts.pw = el => { const v = el.dataset.v;
  if (v === 'reset') return modal({ title: 'Factory reset', text: 'Everything except Vanik OS is erased: people, chats, documents, downloaded models. This cannot be undone.', body: `<label class="field"><span>Type ERASE to confirm</span><input class="input" id="pw-c" autocomplete="off"></label>`, actions: [{ label: 'Reset', danger: true, run: async o => { const r = await api('POST', '/api/edge/power', { action: 'reset', confirm: $('#pw-c', o).value.trim() }); toast(r.skipped ? 'Recorded. This build does not erase anything.' : 'Reset started.'); } }] });
  confirmBox(v === 'restart' ? 'Restart the appliance?' : 'Shut the appliance down?', v === 'restart' ? 'Every app and model stops for a few seconds.' : 'Nobody can use it until someone powers it on again.', v === 'restart' ? 'Restart' : 'Shut down', async () => { await api('POST', '/api/edge/power', { action: v }); toast(v === 'restart' ? 'Restarting. Back in a few seconds.' : 'Shut down.'); await refresh(); if (v === 'restart') setTimeout(refresh, 7000); }, v !== 'restart'); };
// Adds the pieces above to the page a person asked for.
export function edgeDecorate(parts, html) {
  if (!S.boot || !S.boot.admin || typeof html !== 'string') return html;
  const [p, a] = parts, after = add => html.replace(/(<div class="page-head">.*)/, (m) => m + add);
  if (p === 'home') { need(); return after(hero()); }
  if (p === 'devices' && !a) return after(tabs(DEV, '', '#/os/devices'));
  if (p === 'models' && !a) return after(tabs(HUB, '', '#/os/models'));
  if (p === 'people') { need(); return after(directoryCard()); }
  if (p === 'settings') { need(); return after(systemCards()); }
  return html;
}

// ---------- Devices: Network, Storage, Monitoring, Support
function spark(s, name) {
  const w = 300, h = 70, max = s.max || Math.max(...s.points) * 1.2 || 1, pts = s.points.map((v, i) => [i * w / (s.points.length - 1), h - 4 - (v / max) * (h - 10)]), line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' '), last = s.points[s.points.length - 1];
  return `<div class="card flat"><div class="row"><span class="cap grow">${name}</span><b>${last} ${s.unit}</b></div><svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" class="spark" role="img" aria-label="${name} over the last 24 hours"><path d="${line} L ${w} ${h} L 0 ${h} Z" class="a"/><path d="${line}" class="l"/></svg><div class="row small faint"><span class="grow">24 hours ago</span><span>now</span></div></div>`;
}
acts['net-save'] = async () => { await put('/api/edge/network', { domain: $('#n-domain').value }); toast('Saved.'); };
acts['net-public'] = async () => { try { await put('/api/edge/network', { domain: $('#n-domain') ? $('#n-domain').value : undefined, publicOn: !X.d.network.publicOn }); await refresh(); } catch (e) { toast(e.message, 'err'); } };
acts['sup-open'] = async () => { try { await put('/api/edge/support', { minutes: +$('#s-min').value, reason: $('#s-why').value }, 'POST'); toast('Access is open. It ends by itself.'); } catch (e) { toast(e.message, 'err'); } };
acts['sup-end'] = el => put(`/api/edge/support/${el.dataset.id}/end`, {}, 'POST');
acts['sup-diag'] = async () => downloadText('vanik-diagnostics.json', JSON.stringify(await api('GET', '/api/edge/diagnostics'), null, 2), 'application/json');
ins['ret-days'] = async el => { await put('/api/edge/settings', { logsDays: +el.value }); toast('Saved.'); };
function devicesPage(sub) {
  const d = need(), head = `<div class="page-head"><div><h1>Devices</h1><p class="sub">${{ network: 'How this appliance is reached, from the office and from outside.', storage: 'What is filling the disk.', monitoring: 'How the appliance has behaved over the last day.', support: 'Let a Vanik engineer in for a set time, when you need help.' }[sub]}</p></div></div>${tabs(DEV, sub, '#/os/devices')}`;
  if (!d) return osShell('devices', 'Devices', head + '<p class="muted">Loading…</p>');
  let body = '';
  if (sub === 'network') { const n = d.network, local = 'https://' + n.local;
    body = `<div class="stack" style="max-width:820px;gap:16px">
      <div class="card"><div class="row"><span class="pill ${S.boot.device.online ? '' : 'off'}"><i></i>${esc(n.link)}</span><span class="mono grow">${esc(d.about.ip)}</span></div>
        <div class="set-row" style="margin-top:12px"><div class="grow"><div class="lbl">Inside the office</div><div class="mono">${esc(local)}</div></div>${copy(local)}</div></div>
      <div class="card"><div class="card-head"><h3>Company domain</h3>${info('A name you own, so people open the appliance at an address they recognise. Your network team points the name at the appliance.')}</div>
        <div class="row"><input class="input grow" id="n-domain" placeholder="ai.yourcompany.com" value="${esc(n.domain)}"><button class="btn ghost" data-act="net-save">Save</button></div>
        <div class="set-row" style="margin-top:12px"><div class="grow"><div class="lbl">Allow access from the internet ${info('Off: only the office network reaches the appliance. On: people can open it from anywhere at the company domain, after signing in. Every change here is in the audit log.')}</div><div class="small muted">${n.publicOn ? 'Open at https://' + esc(n.domain) : 'Closed'}</div></div><button class="switch ${n.publicOn ? 'on' : ''}" role="switch" aria-checked="${n.publicOn}" aria-label="Allow access from the internet" data-act="net-public"></button></div></div>
      <div class="card"><div class="card-head"><h3>Office certificate</h3>${info('Install this on company laptops so browsers trust the office address without a warning. A company domain with a public certificate does not need it.')}</div><div class="row"><span class="mono grow ellipsis">SHA-256 ${esc(n.ca)}</span>${copy(n.ca)}</div></div></div>`; }
  if (sub === 'storage') { const s = d.storage;
    body = `<div class="stack" style="max-width:820px;gap:16px"><div class="card"><div class="row"><b class="grow">${s.used} GB of ${s.total.toLocaleString('en-IN')} GB used</b><span class="small muted">${(s.total - s.used).toLocaleString('en-IN')} GB free</span></div>${bar(s.used, s.total)}</div>
      <div class="card">${s.rows.map(r => `<div class="set-row"><div class="grow"><div class="lbl">${esc(r.name)}</div><div class="small muted">${esc(r.what)}</div></div><b>${r.gb} GB</b>${r.name === 'Model files' ? `<a class="btn ghost" href="#/os/models">Manage</a>` : r.name === 'Knowledge' ? `<a class="btn ghost" href="#/os/knowledge">Manage</a>` : ''}</div>`).join('')}</div>
      <div class="card"><div class="set-row"><div class="grow"><div class="lbl">Keep logs for ${info('Older audit entries and delivery records are removed by themselves. Chats follow the setting in VanikGPT setup.')}</div></div><select class="input" style="width:140px" data-change="ret-days">${[7, 14, 30, 90, 365].map(v => `<option value="${v}" ${d.retention.logsDays === v ? 'selected' : ''}>${v === 365 ? 'One year' : v + ' days'}</option>`).join('')}</select></div></div></div>`; }
  if (sub === 'monitoring') { const h = d.history;
    body = `<div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(300px,1fr))">${spark(h.gpuMemory, 'GPU memory')}${spark(h.gpuUse, 'GPU in use')}${spark(h.gpuHeat, 'GPU temperature')}${spark(h.cpu, 'Processor')}${spark(h.memory, 'Memory')}</div><p class="small faint" style="margin-top:14px">This build has no sensors. The lines are drawn from what the appliance is doing now.</p>`; }
  if (sub === 'support') { const open = d.support.find(s => s.status === 'open');
    body = `<div class="stack" style="max-width:640px;gap:16px"><div class="card">${open ? `<div class="banner ok" style="margin-bottom:0">${icon('lock_open')}<span class="grow"><b>Access is open for ${esc(open.engineer)}</b><br><span class="small">Until ${when(open.endsAt)} · ${esc(open.reason)}</span></span><button class="btn ghost" data-act="sup-end" data-id="${open.id}">End now</button></div>` : `<div class="row" style="gap:12px;align-items:flex-end"><label class="field"><span>For how long</span><select class="input" id="s-min"><option value="30">30 minutes</option><option value="60">1 hour</option><option value="120">2 hours</option><option value="240">4 hours</option></select></label><label class="field grow"><span>Why</span><input class="input" id="s-why" placeholder="Deploy is stuck on step 3"></label><button class="btn" data-act="sup-open">Give access</button></div><p class="small faint" style="margin-top:10px">Access ends by itself. You can end it sooner here. Every session is in the audit log.</p>`}</div>
      <div class="card"><div class="set-row"><div class="grow"><div class="lbl">Diagnostics report ${info('Versions, health checks, storage and counts. No chats, documents, keys or passwords.')}</div><div class="small muted">Send this to support without opening the appliance to anyone.</div></div><button class="btn ghost" data-act="sup-diag">Download</button></div></div>
      <div class="card"><div class="card-head"><h3>Past sessions</h3></div>${d.support.length ? d.support.map(s => `<div class="set-row"><div class="grow"><div class="lbl">${esc(s.engineer)}</div><div class="small muted">Opened by ${esc(s.by)} · ${s.minutes} minutes · ${when(s.openedAt)} · ${esc(s.reason)}</div></div>${chip(s.status === 'open' ? 'Open' : 'Ended', s.status === 'open' ? 'warn' : 'line', false)}</div>`).join('') : '<p class="muted">None yet.</p>'}</div></div>`; }
  return osShell('devices', `<a href="#/os/devices">Devices</a> / ${DEV.find(t => t[0] === sub)[1]}`, head + body);
}

// ---------- Model Hub: models outside the network
acts['out-prov'] = el => { X.prov = el.dataset.id; rerender(); };
acts['out-key'] = async () => { try { await put('/api/edge/outside/' + X.prov, { key: $('#o-key').value, base: $('#o-base') ? $('#o-base').value : undefined }); await refresh(); toast('Key saved. It stays on the appliance.'); } catch (e) { toast(e.message, 'err'); } };
acts['out-remove'] = () => confirmBox('Remove this provider?', 'Its models disappear from everyone\'s picker straight away.', 'Remove', async () => { await put('/api/edge/outside/' + X.prov, { remove: true }); await refresh(); });
acts['out-model'] = async el => { try { await put(`/api/edge/outside/${X.prov}/models`, { id: el.dataset.id || $('#o-id').value, on: el.dataset.on !== '0' }, 'POST'); await refresh(); } catch (e) { toast(e.message, 'err'); } };
acts['out-docs'] = async () => { await put('/api/edge/settings', { outsideDocs: !X.d.outsideDocs }); };
function outsidePage() {
  const d = need(), head = `<div class="page-head"><div><h1>Model Hub</h1><p class="sub">Models from other companies, used through this appliance. A question sent to one leaves your network.</p></div></div>${tabs(HUB, 'outside', '#/os/models')}`;
  if (!d) return osShell('models', 'Model Hub', head + '<p class="muted">Loading…</p>');
  const p = d.outside.find(x => x.id === X.prov) || d.outside[0], on = new Set(p.models.map(m => m.id));
  return osShell('models', 'Model Hub', head + `<div class="banner plain" style="margin-bottom:16px">${icon('public')}<span class="grow">Each outside model is switched on one at a time. People see it in a separate group in the model picker, the chat says the question leaves the appliance, and every use is in the audit log.</span></div>
    <div class="two-pane"><div class="side-tabs">${d.outside.map(x => `<a class="${x.id === p.id ? 'on' : ''}" data-act="out-prov" data-id="${x.id}" style="cursor:pointer;display:flex"><span class="grow">${esc(x.name)}</span><span class="small faint">${x.connected ? x.models.length + ' on' : ''}</span></a>`).join('')}</div>
      <div class="grow stack" style="gap:16px;min-width:0"><div class="card"><div class="card-head"><h3>${esc(p.name)}</h3>${p.connected ? chip('Connected · key ends ' + esc(p.last4), 'ok', false) : ''}</div>
          <div class="row"><input class="input grow" id="o-key" type="password" autocomplete="off" placeholder="${p.connected ? 'Paste a new key to replace the saved one' : 'API key. Use the word sample to try it without one'}">${p.id === 'custom' || p.id === 'azure' ? `<input class="input" id="o-base" style="width:260px" placeholder="https://host/v1" value="${esc(p.base)}">` : ''}<button class="btn" data-act="out-key">Save</button>${p.connected ? `<button class="btn ghost" data-act="out-remove">Remove</button>` : ''}</div><p class="small faint" style="margin-top:8px">The key stays on this appliance and is never shown again.</p></div>
        ${p.connected ? `<div class="card"><div class="card-head"><h3>Models people can use</h3></div>${[...p.catalog, ...p.models.filter(m => !p.catalog.some(c => c.id === m.id))].map(m => `<div class="set-row"><div class="grow"><span class="mono" style="color:var(--vnk-ink)">${esc(m.id)}</span> ${m.tags.map(t => `<span class="tag">${esc(t)}</span>`).join(' ')}</div><button class="switch ${on.has(m.id) ? 'on' : ''}" role="switch" aria-checked="${on.has(m.id)}" aria-label="${esc(m.id)}" data-act="out-model" data-id="${esc(m.id)}" data-on="${on.has(m.id) ? 0 : 1}"></button></div>`).join('') || '<p class="muted">No models listed for this provider.</p>'}
          <div class="row" style="margin-top:12px"><input class="input grow" id="o-id" placeholder="Add another by its id, as the provider writes it"><button class="btn ghost" data-act="out-model">Add</button></div></div>` : ''}
        <div class="card"><div class="set-row"><div class="grow"><div class="lbl">Send passages from your documents to outside models ${info('Off: an outside model gets the question and the chat so far, never your documents, so its answer cannot cite them. On: matching passages are sent too.')}</div></div><button class="switch ${d.outsideDocs ? 'on' : ''}" role="switch" aria-checked="${d.outsideDocs}" aria-label="Send passages to outside models" data-act="out-docs"></button></div></div></div></div>`);
}
export function edgeOsPage(parts) {
  if (!S.boot.admin) return undefined;
  const [p, a] = parts;
  if (p === 'devices' && ['network', 'storage', 'monitoring', 'support'].includes(a)) return devicesPage(a);
  if (p === 'models' && a === 'outside') return outsidePage();
  return undefined;
}

// ---------- VanikGPT: what an admin switches on, and a person's own API page
acts['ed-set'] = async el => { await put('/api/edge/settings', { [el.dataset.k]: !X.d[el.dataset.k] }); toast('Saved.'); };
ins['ed-calls'] = async el => { await put('/api/edge/settings', { calls: +el.value }); toast('Saved.'); };
export function adminExtra() {
  const d = need(); if (!d) return '';
  return `<div class="card"><div class="card-head"><h3>Outside and developers</h3></div>
    <div class="set-row"><div class="grow"><div class="lbl">People can create their own API keys ${info('Each person gets an API page under Settings, with up to five keys for the models on this appliance.')}</div></div><button class="switch ${d.userKeys ? 'on' : ''}" role="switch" aria-checked="${d.userKeys}" aria-label="Personal API keys" data-act="ed-set" data-k="userKeys"></button></div>
    <div class="set-row"><div class="grow"><div class="lbl">Models outside your network</div><div class="small muted">${d.outside.reduce((a, p) => a + (p.connected ? p.models.length : 0), 0)} switched on</div></div><a class="btn ghost" href="#/os/models/outside">Open</a></div>
    <div class="set-row"><div class="grow"><div class="lbl">Most steps an ability may take for one message ${info('Stops a browser or computer run that asks for more steps than this.')}</div></div><input class="input" type="number" min="1" max="50" style="width:90px" value="${d.limits.calls}" data-change="ed-calls" aria-label="Steps per message"></div></div>`;
}
acts['my-key-new'] = () => modal({ title: 'New API key', body: `<input class="input" id="k-name" maxlength="40" placeholder="What will use it, for example my laptop" aria-label="Name">`, actions: [{ label: 'Create', run: async o => { const r = await api('POST', '/api/my/api/keys', { name: $('#k-name', o).value }); X.my.keys = r.keys; rerender(); modal({ title: 'Copy the key now', text: 'It is not shown again.', cancel: 'Done', body: `<div class="row"><span class="mono grow" style="overflow-wrap:anywhere;color:var(--vnk-ink)">${esc(r.key)}</span>${copy(r.key)}</div>` }); } }] });
acts['my-key-del'] = el => confirmBox('Revoke this key?', 'Anything using it stops working straight away.', 'Revoke', async () => { X.my.keys = (await api('DELETE', '/api/my/api/keys/' + el.dataset.id)).keys; rerender(); });
export function apiPage() {
  if (X.myKey !== 'api') { X.myKey = 'api'; api('GET', '/api/my/api').then(m => { X.my = m; rerender(); }).catch(e => toast(e.message, 'err')); }
  const m = X.my, base = location.origin + new URL('./', location).pathname.replace(/\/$/, '') + '/gateway/v1', live = m ? m.keys.filter(k => !k.revokedAt) : [];
  const body = !m ? '<p class="muted">Loading…</p>' : !m.allowed ? `<div class="empty">${icon('key')}Personal API keys are off. An admin can turn them on under Admin.</div>` : `<div class="stack" style="gap:16px">
    <div class="card"><div class="set-row" style="border-top:0;padding-top:0"><div class="grow"><div class="lbl">Address</div><div class="mono">${esc(base)}</div></div>${copy(base)}</div><div class="set-row"><div class="grow"><div class="lbl">Model</div><div class="mono">${esc(m.models[0] || 'None serving')}</div></div>${m.models[0] ? copy(m.models[0]) : ''}</div></div>
    <div class="card"><div class="card-head"><h3>Your keys</h3><span class="mono">${live.length} of 5</span></div>${live.length ? live.map(k => `<div class="set-row"><div class="grow"><div class="lbl">${esc(k.name)} <span class="mono">…${esc(k.last4)}</span></div><div class="small muted">Made ${ago(k.createdAt)}${k.lastUsedAt ? ' · last used ' + ago(k.lastUsedAt) : ' · not used yet'} · ${k.requests} requests</div></div><button class="btn ghost" data-act="my-key-del" data-id="${k.id}">Revoke</button></div>`).join('') : '<p class="muted">No keys yet.</p>'}</div>
    <div class="card"><div class="card-head"><h3>Try it</h3>${copy(`curl ${base}/chat/completions -H "Authorization: Bearer $VANIK_API_KEY" -H "Content-Type: application/json" -d '{"model":"${m.models[0] || ''}","messages":[{"role":"user","content":"Hello"}]}'`)}</div><pre class="code" style="white-space:pre-wrap">curl ${esc(base)}/chat/completions \\
  -H "Authorization: Bearer $VANIK_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"model": "${esc(m.models[0] || '')}", "messages": [{"role": "user", "content": "Hello"}]}'</pre><p class="small faint" style="margin-top:8px">It speaks the OpenAI format, so existing tools work by changing the address and the key.</p></div></div>`;
  return gptShell('settings', `<div class="gpt-top">${navToggle()}<h3 class="grow"><a href="#/gpt/settings">Settings</a> / Your API</h3>${m && m.allowed ? `<button class="btn" data-act="my-key-new">${icon('add')}New key</button>` : ''}</div><div class="scroll" id="scroll"><div class="page" style="max-width:760px">${body}</div></div>`);
}
