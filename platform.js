// Vanik OS platform pages: Home, Devices, API gateway (keys, playground, webhooks) and Connectors.
import { S, $, esc, icon, info, chip, go, ago, when, api, refresh, rerender, acts, toast, modal, confirmBox, downloadText } from './core.js';
import { osShell } from './os.js';

const P = { data: null, mcp: null, key: '', timer: null, tab: 'keys', play: { text: '', out: '', busy: false, model: '', ctx: false } };
export const platformRouteChanged = () => { P.key = ''; clearInterval(P.timer); P.timer = null; };
async function loadPlatform() { [P.data, P.mcp] = await Promise.all([api('GET', '/api/platform'), api('GET', '/api/mcp')]); }
function ensure(key, live) {
  if (P.key !== key) { P.key = key; loadPlatform().then(rerender).catch(e => toast(e.message, 'err')); }
  clearInterval(P.timer); P.timer = null;
  if (live) P.timer = setInterval(async () => { if (!location.hash.startsWith('#/os/' + key.split(':')[0])) return platformRouteChanged(); try { await loadPlatform(); if (!$('.overlay') && !$('.menu')) rerender(); } catch { /* next tick */ } }, 1500);
}
const reload = async () => { await loadPlatform(); await refresh(); };
const stat = (k, v, sub = '') => `<div class="card flat stat"><span class="k">${k}</span><b>${v}</b>${sub ? `<span class="small muted">${sub}</span>` : ''}</div>`;
const stepList = steps => `<div class="steps" style="margin-top:10px">${steps.map(s => `<div class="step ${s.state}"><span class="dot">${s.state === 'done' ? icon('check') : s.state === 'failed' ? icon('close') : ''}</span>${esc(s.label)}</div>`).join('')}</div>`;

// ---------- Home
function pageHome() {
  const B = S.boot, d = B.device, a = B.app, h = new Date().getHours(), up = a.status === 'running' && d.online;
  const st = a.status === 'not_installed' ? null : !d.online ? ['Offline', 'err'] : { needs_setup: ['Needs setup', 'warn'], deploying: ['Deploying', 'warn'], running: ['Running', 'ok'], stopped: ['Stopped', ''] }[a.status];
  return osShell('home', 'Home', `
    <div class="row" style="margin-bottom:6px"><span class="mono" style="letter-spacing:.12em;text-transform:uppercase">${esc(B.tenant.name)} · Vanik Appliance</span>${chip(B.attention.length ? B.attention.length + ' to look at' : 'Healthy', B.attention.length ? 'warn' : 'ok')}</div>
    <div class="page-head"><div><h1>${h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'}, ${esc(B.me.name.split(' ')[0])}</h1><p class="sub">${up ? 'VanikGPT is running.' : a.status === 'not_installed' ? 'No app is installed yet.' : 'VanikGPT is not running.'}</p></div></div>
    <div class="grid four" style="margin-bottom:18px">${stat('Devices', `${d.online ? 1 : 0} online / 1`)}${stat('Apps running', up ? 1 : 0)}${stat('Models serving', `${d.serving} / ${d.slots}`)}${stat('Agent', esc(d.agent))}</div>
    <div class="grid two" style="align-items:start">
      <div class="card"><div class="card-head"><h3>Needs attention</h3><span class="mono">${B.attention.length}</span></div>
        ${B.attention.length ? B.attention.map(x => `<div class="set-row"><span class="material-icons mi" style="color:var(--vnk-warn)">error_outline</span><span class="grow">${esc(x.text)}</span><a class="btn ghost" href="${esc(x.href)}">${esc(x.action)}</a></div>`).join('') : `<p class="muted">Nothing needs you right now.</p>`}</div>
      <div class="stack" style="gap:16px">
        <div class="card"><div class="card-head"><h3>Your apps</h3><a class="link small right" href="#/os/apps">See all</a></div>
          ${st ? `<div class="row"><span class="app-ico">${icon('forum')}</span><div class="grow"><b>VanikGPT</b><div class="mono">${esc(d.name)} · ${a.port}</div></div>${chip(st[0], st[1])}${up ? `<a class="btn" href="#/gpt">Open</a>` : `<a class="btn ghost" href="#/os/apps/vanikgpt/overview">Manage</a>`}</div>` : `<p class="muted">Nothing installed yet. <a class="link" href="#/os/apps">Open Apps</a></p>`}</div>
        <div class="card"><div class="card-head"><h3>Appliance capacity</h3><a class="link small right" href="#/os/models">Model Hub</a></div>
          <div class="stat"><span class="k">GPU memory</span></div><div class="row" style="margin-top:6px"><b style="font-size:20px">${d.usedGb}</b><span class="muted">/ ${d.memGb} GB</span><span class="right small muted">${d.freeGb} GB free</span></div><div class="meter" style="margin:8px 0 16px"><i style="width:${Math.min(100, Math.round(100 * d.usedGb / d.memGb))}%"></i></div>
          <div class="stat"><span class="k">Model slots</span></div><div class="row" style="margin-top:6px"><b style="font-size:20px">${d.serving}</b><span class="muted">/ ${d.slots} serving</span></div><div class="meter" style="margin-top:8px"><i style="width:${Math.round(100 * d.serving / d.slots)}%"></i></div></div>
      </div></div>`);
}

// ---------- Devices
function pageDevices() {
  const B = S.boot, d = B.device, D = P.data;
  ensure('devices', true);
  const tone = { ok: 'ok', down: 'err', idle: '' }, word = { ok: 'Healthy', down: 'Problem', idle: 'Idle' };
  return osShell('devices', 'Devices', `
    <div class="page-head"><div><h1>Devices</h1><p class="sub">1 registered · ${d.online ? '1 online' : '0 online'}</p></div></div>
    <div class="card" style="margin-bottom:16px"><div class="row"><span class="avatar sq">${icon('dns')}</span><div class="grow"><b>${esc(d.name)}</b><div class="mono">${esc(d.ip)} · agent ${esc(d.agent)}</div></div>${chip(d.online ? 'Online' : 'Offline', d.online ? 'ok' : 'err')}
      <div style="min-width:220px"><div class="small muted">${d.usedGb} of ${d.memGb} GB · ${d.serving} of ${d.slots} model slots</div><div class="meter" style="margin-top:6px"><i style="width:${Math.min(100, Math.round(100 * d.usedGb / d.memGb))}%"></i></div></div></div></div>
    <div class="section-title"><h2>Vanik OS stack</h2><span class="mono">checked every few seconds</span></div>
    <div class="grid four">${!D ? '<p class="muted">Loading…</p>' : D.probes.map(p => `<div class="card flat"><div class="row"><b class="grow ellipsis">${esc(p.name)}</b>${chip(word[p.state], tone[p.state])}</div><p class="small muted" style="margin-top:6px">${esc(p.detail)}</p></div>`).join('')}</div>
    <div class="section-title"><h2>Commands sent to the device</h2>${info('Every install, deploy, serve and park is a command the device agent picks up. Each shows its steps and result.')}</div>
    <div class="card">${!D ? '<p class="muted">Loading…</p>' : D.commands.length ? `<div class="timeline">${D.commands.map(c => `<div class="tl"><span class="ico">${icon(c.type === 'Deploy app' ? 'rocket_launch' : c.type === 'Park model' ? 'pause_circle' : 'memory')}</span><div class="grow"><div class="row wrap"><b>${esc(c.type)}</b><span class="mono">${esc(c.target)}</span>${c.result === 'ok' ? chip('Done', 'ok') : c.result === 'failed' ? chip('Did not finish', 'err') : c.result === 'cancelled' ? chip('Cancelled', '') : chip('In progress', 'warn')}</div>
        <div class="small muted">${when(c.startedAt)} · ${esc(c.by)}${c.endedAt ? ' · took ' + Math.max(1, Math.round((new Date(c.endedAt) - new Date(c.startedAt)) / 1000)) + ' s' : ''}</div>${c.reason && c.result !== 'ok' ? `<div class="small" style="color:var(--vnk-err);margin-top:4px">${esc(c.reason)}</div>` : ''}${c.result ? '' : stepList(c.steps)}</div></div>`).join('')}</div>` : '<p class="muted">No commands yet. Serve a model or deploy an app to see one here.</p>'}</div>`);
}

// ---------- API gateway
function pageGateway(tab) {
  const B = S.boot, D = P.data, tabs = [['keys', 'Keys'], ['playground', 'Playground'], ['webhooks', 'Webhooks']];
  if (!tabs.some(t => t[0] === tab)) tab = 'keys';
  ensure('api-gateway:' + tab, tab === 'webhooks');
  const base = location.origin + new URL('./', location).pathname.replace(/\/$/, '') + '/gateway/v1', serving = B.models.filter(m => m.status === 'serving');
  let body = '<p class="muted">Loading…</p>';
  if (D && tab === 'keys') {
    const live = D.keys.filter(k => !k.revokedAt);
    body = `<div class="grid four" style="margin-bottom:16px">${stat('Active keys', live.length)}${stat('Requests', D.keys.reduce((a, k) => a + k.requests, 0).toLocaleString())}${stat('Tokens', D.keys.reduce((a, k) => a + k.tokens, 0).toLocaleString())}${stat('Models served', serving.length, esc(serving.map(m => m.id).join(', ')))}</div>
      <div class="card" style="margin-bottom:16px"><div class="card-head"><h3>Base URL</h3>${info('OpenAI-compatible. Existing SDKs work by changing the base URL and the key. Each key is limited to 60 requests a minute.')}</div>
        <div class="row"><code class="mono grow" style="font-size:13px;color:var(--vnk-ink)">${esc(base)}</code><button class="btn ghost" data-act="copy" data-text="${esc(base)}">Copy</button></div>
        <pre class="code" style="margin-top:14px">curl ${esc(base)}/chat/completions \\
  -H "Authorization: Bearer $VANIK_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"model": "${esc((serving.find(m => m.kind === 'chat') || { id: 'model-id' }).id)}", "messages": [{"role": "user", "content": "Hello"}]}'</pre>
        <table class="list" style="margin-top:14px"><tr><th>Also on this address</th><th>What it does</th></tr>
          ${[['GET /models', 'Models serving now'], ['POST /embeddings', 'Vectors for text'], ['POST /chat/completions with "use_context": true', 'Adds matching passages from the key\'s collections before the model answers'], ['POST /chunks', 'Matching passages with document and page, no answer'], ['POST /summarize', 'A short summary of text you send'], ['POST /count_tokens', 'Size of a request before you send it'], ['GET /gateway/health', 'Whether the appliance and model server are up']].map(r => `<tr><td class="mono" style="color:var(--vnk-ink)">${r[0]}</td><td class="muted">${r[1]}</td></tr>`).join('')}
          <tr><td class="mono" style="color:var(--vnk-ink)">POST /api/agui/run</td><td class="muted">A full agent run as an AG-UI event stream: steps, tool calls, text, and a pause when a go-ahead is needed</td></tr></table></div>
      <div class="card"><div class="card-head"><h3>API keys</h3><button class="btn right" data-act="key-new">${icon('add')}Create API key</button></div>
        ${D.keys.length ? `<table class="list"><tr><th>Name</th><th>Key</th><th>Can read</th><th>Created</th><th>Last used</th><th>Requests</th><th>Tokens</th><th></th></tr>${D.keys.map(k => `<tr><td><b>${esc(k.name)}</b>${k.system ? `<div class="small faint">Managed by Vanik OS</div>` : ''}</td><td class="mono">…${esc(k.last4)}</td><td class="muted">${k.knowledge === 'all' ? 'Models, all knowledge' : Array.isArray(k.knowledge) && k.knowledge.length ? `Models, ${k.knowledge.length} ${k.knowledge.length === 1 ? 'collection' : 'collections'}` : 'Models only'}</td><td class="muted">${ago(k.createdAt)}<div class="small faint">${esc(k.createdBy)}</div></td><td class="muted">${k.lastUsedAt ? ago(k.lastUsedAt) : 'Never'}</td><td>${k.requests}</td><td>${k.tokens.toLocaleString()}</td>
          <td class="act">${k.revokedAt ? chip('Revoked', '') : k.system ? `<span class="info tip-left" tabindex="0" data-tip="Created when the app was installed. Revoked when it is uninstalled.">${icon('lock')}</span>` : `<button class="btn ghost" data-act="key-revoke" data-id="${k.id}" data-name="${esc(k.name)}">Revoke</button>`}</td></tr>`).join('')}</table>` : '<p class="muted">No keys yet.</p>'}</div>`;
  }
  if (D && tab === 'playground') {
    const chat = serving.filter(m => m.kind === 'chat'); if (!P.play.model && chat[0]) P.play.model = chat[0].id;
    body = `<div class="card" style="max-width:820px"><div class="card-head"><h3>Try a request</h3>${info('Sends one chat request through the gateway as you, without a key.')}<select class="input right" style="width:240px" data-change="play-model">${chat.map(m => `<option ${m.id === P.play.model ? 'selected' : ''}>${esc(m.id)}</option>`).join('') || '<option>No model serving</option>'}</select></div>
      <textarea class="input" rows="4" id="play-text" placeholder="Write a message">${esc(P.play.text)}</textarea>
      <div class="row" style="margin-top:12px"><button class="btn" data-act="play-send" ${P.play.busy || !chat.length ? 'disabled' : ''}>${P.play.busy ? 'Waiting…' : 'Send'}</button><span class="small muted grow ellipsis">POST ${esc(base)}/chat/completions</span><span class="small">Use the knowledge base ${info('Adds matching passages from your collections before the model answers. Sent as "use_context": true.')}</span><button class="switch ${P.play.ctx ? 'on' : ''}" role="switch" aria-checked="${P.play.ctx}" aria-label="Use the knowledge base" data-act="play-ctx"></button></div>
      ${P.play.out ? `<pre class="code" style="margin-top:14px;white-space:pre-wrap" id="play-out">${esc(P.play.out)}</pre>` : ''}</div>`;
  }
  if (D && tab === 'webhooks') {
    body = `<div class="card" style="margin-bottom:16px"><div class="card-head"><h3>Webhooks</h3>${info('Vanik OS calls your address when something happens. Each call is signed: header X-Vanik-Signature is sha256= followed by the HMAC-SHA256 of the body with your secret. A failed call is retried twice.')}<button class="btn right" data-act="hook-new">${icon('add')}Add webhook</button></div>
        ${D.webhooks.length ? D.webhooks.map(h => `<div class="set-row"><div class="grow"><div class="lbl ellipsis">${esc(h.url)}</div><div class="row wrap" style="gap:5px;margin-top:6px">${h.events.map(e => `<span class="tag">${esc(e)}</span>`).join('')}</div></div>
          <button class="switch ${h.active ? 'on' : ''}" role="switch" aria-checked="${h.active}" aria-label="Active" data-act="hook-toggle" data-id="${h.id}" data-on="${h.active ? '' : '1'}"></button><button class="btn ghost" data-act="hook-test" data-id="${h.id}">Send test</button><button class="icon-btn sm" data-act="hook-del" data-id="${h.id}" data-tip="Remove" aria-label="Remove">${icon('delete_outline')}</button></div>`).join('') : '<p class="muted">No webhooks yet. Add one to get a call when a document is added, a deploy finishes or a workflow needs a decision.</p>'}</div>
      <div class="card"><div class="card-head"><h3>Recent deliveries</h3></div>${D.deliveries.length ? `<table class="list"><tr><th>When</th><th>Event</th><th>To</th><th>Result</th><th>Tries</th></tr>${D.deliveries.map(x => `<tr><td class="muted" style="white-space:nowrap">${when(x.at)}</td><td class="mono">${esc(x.event)}</td><td class="muted ellipsis" style="max-width:260px">${esc(x.url)}</td><td>${x.status === 'delivered' ? chip('Delivered', 'ok') : x.status === 'failed' ? chip('Failed', 'err') : chip('Retrying', 'warn')} <span class="mono">${x.code || 'no reply'}</span></td><td>${x.attempts}</td></tr>`).join('')}</table>` : '<p class="muted">Nothing sent yet.</p>'}</div>`;
  }
  return osShell('api-gateway', 'API gateway', `
    <div class="page-head"><div><h1>API gateway</h1><p class="sub">Call the models running on your Vanik Appliance from anywhere inside the network.</p></div></div>
    <nav class="tabs">${tabs.map(t => `<a class="${t[0] === tab ? 'on' : ''}" href="#/os/api-gateway/${t[0]}">${t[1]}</a>`).join('')}</nav>${body}`);
}
acts.copy = async el => { await navigator.clipboard.writeText(el.dataset.text); toast('Copied.'); };
const showSecret = (title, text, secret) => modal({ title, text, cancel: 'Done', body: `<div class="row"><code class="mono grow" style="font-size:12.5px;color:var(--vnk-ink);overflow-wrap:anywhere">${esc(secret)}</code><button class="btn ghost" data-act="copy" data-text="${esc(secret)}">Copy</button></div>` });
acts['key-new'] = () => modal({ title: 'Create API key', body: `<div class="stack"><label class="field"><span>Name ${info('What will use this key, for example ERP bridge.')}</span><input class="input" id="f-name" maxlength="40" placeholder="ERP bridge"></label>
  <label class="field"><span>Can read ${info('Models only: chat and embeddings. With knowledge: the key can also fetch passages from the collections you pick, through /chunks and use_context.')}</span><select class="input" id="f-know"><option value="none">Models only</option><option value="all">Models and all knowledge</option>${S.boot.collections.map(c => `<option value="${c.id}">Models and ${esc(c.name)}</option>`).join('')}</select></label></div>`, actions: [{ label: 'Create', run: async o => { const kv = $('#f-know', o).value; const k = await api('POST', '/api/gateway/keys', { name: $('#f-name', o).value, knowledge: kv === 'none' || kv === 'all' ? kv : [kv] }); await reload(); showSecret('Copy your key now', 'This is the only time the key is shown. Vanik OS keeps a fingerprint, not the key.', k.key); } }] });
acts['key-revoke'] = el => confirmBox(`Revoke "${el.dataset.name}"?`, 'Anything using this key stops working straight away. This cannot be undone.', 'Revoke', async () => { await api('DELETE', '/api/gateway/keys/' + el.dataset.id); await reload(); });
acts['hook-new'] = () => {
  const ev = P.data.events;
  modal({ title: 'Add webhook', wide: true, body: `<div class="stack"><label class="field"><span>Address</span><input class="input" id="f-url" placeholder="https://erp.example.com/hooks/vanik" value="${S.boot.sample ? 'sample://erp/hooks/vanik' : ''}"></label><div><div class="small" style="font-weight:600;margin-bottom:8px">Call it when</div><div class="row wrap" style="gap:6px" id="f-events">${ev.map(e => `<button class="tag" data-v="${e}">${e}</button>`).join('')}</div></div></div>`,
    actions: [{ label: 'Add', run: async o => { const h = await api('POST', '/api/webhooks', { url: $('#f-url', o).value, events: [...o.querySelectorAll('#f-events .on')].map(b => b.dataset.v) }); await reload(); showSecret('Copy the signing secret now', 'Use it to check the X-Vanik-Signature header. It is not shown again.', h.secret); } }] })
    .el.querySelector('#f-events').onclick = e => { const b = e.target.closest('button'); if (b) b.classList.toggle('on'); };
};
acts['hook-toggle'] = async el => { await api('PATCH', '/api/webhooks/' + el.dataset.id, { active: !!el.dataset.on }); await reload(); };
acts['hook-test'] = async el => { await api('POST', `/api/webhooks/${el.dataset.id}/test`); toast('Test sent. It shows under Recent deliveries.'); setTimeout(reload, 900); };
acts['hook-del'] = el => confirmBox('Remove this webhook?', 'Vanik OS stops calling this address.', 'Remove', async () => { await api('DELETE', '/api/webhooks/' + el.dataset.id); await reload(); });
import { ins } from './core.js';
ins['play-model'] = el => { P.play.model = el.value; };
acts['play-ctx'] = () => { P.play.text = $('#play-text').value; P.play.ctx = !P.play.ctx; rerender(); };
acts['play-send'] = async () => {
  P.play.text = $('#play-text').value.trim(); if (!P.play.text) return;
  P.play.busy = true; P.play.out = ''; rerender();
  try {
    const r = await fetch('/gateway/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-User': S.userId }, body: JSON.stringify({ model: P.play.model, stream: true, ...(P.play.ctx ? { use_context: true } : {}), messages: [{ role: 'user', content: P.play.text }] }) });
    if (!r.ok) { const j = await r.json().catch(() => ({})); P.play.out = `${r.status}  ${(j.error && j.error.message) || 'Request failed.'}`; }
    else {
      const reader = r.body.getReader(), dec = new TextDecoder(); let buf = '';
      for (;;) { const { done, value } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true }); let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (line.startsWith('data:') && !line.includes('[DONE]')) try { const t = JSON.parse(line.slice(5)).choices[0].delta.content; if (t) { P.play.out += t; const o = $('#play-out'); if (o) o.textContent = P.play.out; else rerender(); } } catch { /* partial */ } } }
    }
  } catch (e) { P.play.out = e.message; }
  P.play.busy = false; rerender();
};

// ---------- Connectors
function pageConnectors() {
  const B = S.boot, D = P.data;
  ensure('connectors', true);
  const other = [['Google Drive', 'Sync shared drives and folders into a collection.', 'add_to_drive'], ['SharePoint', 'Pull document libraries from a Microsoft 365 tenant.', 'grid_view'], ['Confluence', 'Index spaces and pages from Atlassian Confluence.', 'menu_book']];
  return osShell('connectors', 'Connectors', `
    <div class="page-head"><div><h1>Connectors</h1><p class="sub">Where your apps read documents from. Files are copied onto the Vanik Appliance and indexed there.</p></div></div>
    <div class="card" style="margin-bottom:16px"><div class="card-head"><span class="avatar sq">${icon('folder_open')}</span><div class="grow"><h3>Folder on the appliance</h3><p class="small muted">Watches a folder or a mounted network share and keeps a collection in step with it.</p></div><button class="btn" data-act="cn-new">Connect a folder</button></div>
      ${!D ? '<p class="muted">Loading…</p>' : D.connectors.length ? D.connectors.map(c => `<div class="set-row"><div class="grow"><div class="lbl"><span class="mono" style="font-size:12.5px;color:var(--vnk-ink)">${esc(c.path)}</span></div><div class="small muted" style="margin-top:4px">Into <a class="link" href="#/os/knowledge/${c.collectionId}">${esc(c.collectionName)}</a> · every ${c.everyMinutes} min · ${c.lastSyncAt ? 'checked ' + ago(c.lastSyncAt) : 'not checked yet'}${c.stats ? ` · ${c.stats.files} files${c.stats.skipped ? ', ' + c.stats.skipped + ' skipped' : ''}` : ''}</div>${c.error ? `<div class="small" style="color:var(--vnk-err);margin-top:4px">${esc(c.error)}</div>` : ''}</div>
        ${c.stats && c.stats.skipped ? `<span class="info tip-left" tabindex="0" data-tip="Skipped files are types this connector cannot read (it reads TXT, MD, CSV, HTML, JSON) or are over 5 MB.">${icon('info_outline')}</span>` : ''}<button class="btn ghost" data-act="cn-sync" data-id="${c.id}">Sync now</button><button class="icon-btn sm" data-act="cn-del" data-id="${c.id}" data-tip="Disconnect" aria-label="Disconnect">${icon('link_off')}</button></div>`).join('') : '<p class="muted">No folder connected yet.</p>'}</div>
    <div class="card" style="margin-bottom:16px"><div class="card-head"><span class="avatar sq">${icon('hub')}</span><div class="grow"><h3>Tool connectors ${info('Links VanikGPT to another system through the Model Context Protocol (MCP). People run a tool by typing /use in chat. A tool that changes something waits for a go-ahead unless you let it run freely.')}</h3><p class="small muted">Give chats tools from your own systems, such as an ERP, a ticket desk or a database.</p></div><button class="btn" data-act="mcp-new">Add a tool connector</button></div>
      ${!P.mcp ? '<p class="muted">Loading…</p>' : P.mcp.length ? P.mcp.map(m => `<div class="set-row" style="align-items:flex-start"><div class="grow"><div class="lbl">${esc(m.name)} ${m.error ? chip('Not reachable', 'err') : chip(m.tools.length + ' tools', 'ok')}</div><div class="mono" style="margin-top:3px">${esc(m.url)}${m.hasToken ? ' · token set' : ''}</div>${m.error ? `<div class="small" style="color:var(--vnk-err);margin-top:4px">${esc(m.error)}</div>` : ''}
        <div class="stack" style="gap:6px;margin-top:10px">${m.tools.map(t => `<div class="row"><span class="mono" style="color:var(--vnk-ink);min-width:150px">${esc(t.name)}</span><span class="small muted grow ellipsis">${esc(t.description)}</span><span class="small muted">Ask first</span><button class="switch ${t.ask ? 'on' : ''}" role="switch" aria-checked="${t.ask}" aria-label="Ask before running ${esc(t.name)}" data-act="mcp-ask" data-id="${m.id}" data-tool="${esc(t.name)}" data-on="${t.ask ? '' : '1'}"></button></div>`).join('')}</div></div>
        <button class="btn ghost" data-act="mcp-refresh" data-id="${m.id}">Check</button><button class="icon-btn sm" data-act="mcp-del" data-id="${m.id}" data-tip="Remove" aria-label="Remove">${icon('link_off')}</button></div>`).join('') : '<p class="muted">No tool connector yet.</p>'}</div>
    <div class="grid">
      <div class="card flat app-card" style="min-height:0"><div class="row"><span class="avatar sq">${icon('upload_file')}</span><h3 class="grow">From your computer</h3>${chip('Always on', 'ok')}</div><p class="small muted">Upload PDF, Word, Excel, text and scanned images straight into a collection.</p><div class="foot"><span class="grow"></span><a class="btn ghost" href="#/os/knowledge">Knowledge base</a></div></div>
      ${other.map(o => `<div class="card flat app-card" style="min-height:0"><div class="row"><span class="avatar sq">${icon(o[2])}</span><h3 class="grow">${o[0]}</h3>${chip('Not connected', '')}</div><p class="small muted">${o[1]} Needs your tenant's sign in, so it is set up in Vanik OS.</p><div class="foot"><span class="grow"></span><a class="btn ghost" href="https://os.vanikedge.ai/connectors" target="_blank" rel="noopener">Open in Vanik OS ${icon('open_in_new')}</a></div></div>`).join('')}
    </div>`);
}
acts['mcp-new'] = () => modal({ title: 'Add a tool connector', text: 'Vanik OS connects, lists the tools and shows them here.', body: `<div class="stack"><label class="field"><span>Name</span><input class="input" id="f-name" maxlength="40" placeholder="ERP"></label><label class="field"><span>Address ${info('The MCP endpoint of the other system, reachable from this appliance.')}</span><input class="input" id="f-url" placeholder="http://erp.internal:8080/mcp" value="${S.boot.sample ? 'sample://erp' : ''}"></label><label class="field"><span>Access token ${info('Optional. Sent as a bearer token. Stored on the appliance and never shown again.')}</span><input class="input" id="f-token" autocomplete="off" placeholder="Leave empty if the system needs none"></label></div>`,
  actions: [{ label: 'Connect', run: async o => { const m = await api('POST', '/api/mcp', { name: $('#f-name', o).value, url: $('#f-url', o).value, token: $('#f-token', o).value }); toast(`Connected. ${m.tools.length} tools found.`); await reload(); } }] });
acts['mcp-refresh'] = async el => { const m = await api('POST', `/api/mcp/${el.dataset.id}/refresh`); toast(m.error ? 'Not reachable: ' + m.error : `Reachable. ${m.tools.length} tools.`, m.error ? 'err' : ''); await reload(); };
acts['mcp-ask'] = async el => { await api('PATCH', `/api/mcp/${el.dataset.id}/tools/${encodeURIComponent(el.dataset.tool)}`, { ask: !!el.dataset.on }); await reload(); };
acts['mcp-del'] = el => confirmBox('Remove this tool connector?', 'Chats can no longer use its tools.', 'Remove', async () => { await api('DELETE', '/api/mcp/' + el.dataset.id); await reload(); });
acts['cn-new'] = () => {
  const cols = S.boot.collections;
  if (!cols.length) return modal({ title: 'Make a collection first', text: 'A folder is copied into a collection. Create one in Knowledge base, then come back.', actions: [{ label: 'Open Knowledge base', run: () => go('#/os/knowledge') }] });
  modal({ title: 'Connect a folder', body: `<div class="stack"><label class="field"><span>Folder path on the appliance ${info('A local folder or a mounted network share, for example /mnt/finance or D:\\\\Shared\\\\Policies.')}</span><input class="input" id="f-path" placeholder="/mnt/shared/policies" value="${S.boot.sample ? 'sample://finance-share' : ''}"></label>
    <label class="field"><span>Copy into</span><select class="input" id="f-col">${cols.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></label>
    <label class="field"><span>Check for changes every</span><select class="input" id="f-every"><option value="1">1 minute</option><option value="15" selected>15 minutes</option><option value="60">1 hour</option><option value="1440">1 day</option></select></label></div>`,
    actions: [{ label: 'Connect', run: async o => { const c = await api('POST', '/api/connectors', { path: $('#f-path', o).value, collectionId: $('#f-col', o).value, everyMinutes: +$('#f-every', o).value }); toast(`Connected. ${c.stats ? c.stats.added : 0} files copied in.`); await reload(); } }] });
};
acts['cn-sync'] = async el => { const c = await api('POST', `/api/connectors/${el.dataset.id}/sync`); toast(c.error || `Checked. ${c.stats.added} added, ${c.stats.updated} updated, ${c.stats.removed} removed.`, c.error ? 'err' : ''); await reload(); };
acts['cn-del'] = el => confirmBox('Disconnect this folder?', 'Vanik OS stops watching it. Documents already copied stay in the collection.', 'Disconnect', async () => { await api('DELETE', '/api/connectors/' + el.dataset.id); await reload(); });

export function platformPage(parts) {
  if (!S.boot.admin) return null;
  const [p, a] = parts;
  if (p === 'home') return pageHome();
  if (p === 'devices') return pageDevices();
  if (p === 'api-gateway') return pageGateway(a || 'keys');
  if (p === 'connectors') return pageConnectors();
  return undefined;
}
export { downloadText };
