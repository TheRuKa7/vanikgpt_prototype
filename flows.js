// Workflows: checks on documents that follow fixed rules and stop for a person when something is off.
import { S, $, esc, icon, info, chip, go, ago, when, api, rerender, acts, ins, toast, modal, extractFile, pickFiles, downloadText, navToggle } from './core.js';
import { gptShell } from './gpt.js';

const TYPES = {
  three_way: { name: 'Three-way match', icon: 'receipt_long', what: 'Checks an invoice against its purchase order and goods receipt, line by line.', slots: [['po', 'Purchase order'], ['grn', 'Goods receipt'], ['invoice', 'Invoice']] },
  kyc: { name: 'Vendor KYC check', icon: 'verified_user', what: 'Reads a vendor\'s documents and checks PAN, GSTIN, bank and identity details against each other.', many: 'Vendor documents', role: 'doc' },
  quotes: { name: 'Quote comparison', icon: 'compare_arrows', what: 'Lines up quotes from several suppliers and points to the lowest complete one.', many: 'Supplier quotes', role: 'quote' },
};
const F = { list: null, key: '', run: null, runKey: '', type: 'three_way', files: [], tolerance: 1, busy: false };
export const flowsRouteChanged = () => { F.key = ''; F.runKey = ''; };
const STATUS = { completed: 'ok', needs_approval: 'warn', rejected: 'err' };
const statusChip = w => chip(w.status === 'needs_approval' ? 'Waiting for a decision' : w.outcome, STATUS[w.status] || '');
const money = n => n === null || n === undefined ? '' : Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });

function pageList() {
  if (F.key !== 'list') { F.key = 'list'; api('GET', '/api/workflows').then(l => { F.list = l; rerender(); }).catch(e => toast(e.message, 'err')); }
  const l = F.list;
  return gptShell('flows', `<div class="gpt-top">${navToggle()}<h3 class="grow">Workflows ${info('Checks that follow fixed rules, not guesses. When something is off, the run stops for a person to decide.', 'tip-down')}</h3><a class="btn" href="#/gpt/flows/new">${icon('add')}New check</a></div>
    <div class="scroll" id="scroll"><div class="page">
      <div class="grid" style="margin-bottom:22px">${Object.entries(TYPES).map(([k, t]) => `<a class="card flat app-card" style="min-height:0" href="#/gpt/flows/new/${k}"><div class="row"><span class="avatar sq">${icon(t.icon)}</span><h3 class="grow">${t.name}</h3></div><p class="small muted">${t.what}</p></a>`).join('')}</div>
      <div class="card"><div class="card-head"><h3>Runs</h3></div>${!l ? '<p class="muted">Loading…</p>' : l.length ? `<table class="list"><tr><th>What</th><th>Check</th><th>Result</th><th>By</th><th>When</th></tr>${l.map(w => `<tr><td><a class="link" href="#/gpt/flows/${w.id}">${esc(w.title)}</a></td><td class="muted">${esc(w.typeName)}</td><td>${statusChip(w)}</td><td class="muted">${esc(w.createdByName)}</td><td class="muted">${ago(w.createdAt)}</td></tr>`).join('')}</table>` : '<p class="muted">No runs yet. Pick a check above to start one.</p>'}</div>
    </div></div>`);
}

function pageNew(type) {
  if (TYPES[type] && F.type !== type) { F.type = type; F.files = []; }
  const t = TYPES[F.type], slot = (role, label) => { const f = F.files.find(x => x.role === role); return `<div class="slot ${f ? 'filled' : ''}">${icon(f ? 'description' : 'upload_file')}<div class="grow"><b>${label}</b><div class="small muted ellipsis">${f ? esc(f.name) : 'PDF, Excel, CSV or text'}</div></div>${f ? `<button class="icon-btn sm" data-act="wf-remove" data-name="${esc(f.name)}" aria-label="Remove">${icon('close')}</button>` : `<button class="btn ghost" data-act="wf-pick" data-role="${role}">Choose file</button>`}</div>`; };
  const ready = t.slots ? t.slots.every(s => F.files.some(f => f.role === s[0])) : F.files.length >= (F.type === 'quotes' ? 2 : 1);
  return gptShell('flows', `<div class="gpt-top">${navToggle()}<h3 class="grow">New check</h3><a class="btn ghost" href="#/gpt/flows">Cancel</a><button class="btn" data-act="wf-run" ${ready && !F.busy ? '' : 'disabled'}>${F.busy ? 'Checking…' : 'Run check'}</button></div>
    <div class="scroll" id="scroll"><div class="page"><div class="stack" style="max-width:720px;gap:16px">
      <div class="card"><div class="card-head"><h3>What to check</h3></div><div class="seg">${Object.entries(TYPES).map(([k, x]) => `<button class="${k === F.type ? 'on' : ''}" data-act="wf-type" data-v="${k}">${x.name}</button>`).join('')}</div><p class="small muted" style="margin-top:12px">${t.what}</p></div>
      <div class="card"><div class="card-head"><h3>Documents</h3>${info('Tables are read from Excel, CSV and text files with item, quantity, rate and amount columns. Scanned PDFs are read with OCR first.')}</div><div id="uploads"></div>
        <div class="stack" style="gap:10px">${t.slots ? t.slots.map(s => slot(s[0], s[1])).join('') : `${F.files.map(f => `<div class="slot filled">${icon('description')}<div class="grow ellipsis"><b>${esc(f.name)}</b></div><button class="icon-btn sm" data-act="wf-remove" data-name="${esc(f.name)}" aria-label="Remove">${icon('close')}</button></div>`).join('')}<div class="slot">${icon('upload_file')}<div class="grow"><b>${t.many}</b><div class="small muted">${F.type === 'quotes' ? 'One file per supplier, at least two' : 'PAN, GST certificate, bank letter, identity'}</div></div><button class="btn ghost" data-act="wf-pick" data-role="${t.role}" data-many="1">Add files</button></div>`}</div></div>
      ${F.type === 'three_way' ? `<div class="card"><div class="set-row"><div class="grow"><div class="lbl">Allowed difference in rate ${info('A billed rate within this share of the ordered rate passes without a flag.')}</div></div><select class="input" style="width:110px" data-change="wf-tol">${[0, 1, 2, 5].map(v => `<option value="${v}" ${F.tolerance === v ? 'selected' : ''}>${v}%</option>`).join('')}</select></div></div>` : ''}
    </div></div></div>`);
}
acts['wf-type'] = el => { F.type = el.dataset.v; F.files = []; go('#/gpt/flows/new/' + F.type); };
ins['wf-tol'] = el => { F.tolerance = +el.value; };
acts['wf-remove'] = el => { F.files = F.files.filter(f => f.name !== el.dataset.name); rerender(); };
acts['wf-pick'] = async el => {
  const files = await pickFiles(!!el.dataset.many), say = t => { const b = $('#uploads'); if (b) b.innerHTML = `<div class="banner plain">${icon('upload_file')}<span>${esc(t)}</span></div>`; };
  for (const f of files) { try { say('Reading ' + f.name + '…'); const x = await extractFile(f, say); F.files = F.files.filter(o => o.name !== f.name && (el.dataset.many || o.role !== el.dataset.role)); F.files.push({ role: el.dataset.role, name: f.name, text: x.pages.join('\n') }); } catch (e) { toast(e.message, 'err'); } }
  rerender();
};
async function start(again) {
  F.busy = true; rerender();
  try { const w = await api('POST', '/api/workflows', { type: F.type, inputs: F.files, options: { tolerance: F.tolerance }, again }); F.files = []; F.busy = false; go('#/gpt/flows/' + w.id); }
  catch (e) {
    F.busy = false; rerender();
    if (e.status === 409) { const id = (await api('GET', '/api/workflows')).find(w => w.type === F.type && w.status !== 'rejected'); modal({ title: 'This was already checked', text: 'The same documents were checked before. Open that run, or check again on purpose.', actions: [{ label: 'Check again', ghost: true, run: () => { start(true); } }, { label: 'Open earlier run', run: () => { if (id) go('#/gpt/flows/' + id.id); } }] }); }
    else toast(e.message, 'err');
  }
}
acts['wf-run'] = () => start(false);

function resultHtml(r) {
  const fi = { ok: ['check_circle', 'ok'], warn: ['error_outline', 'warn'], info: ['info_outline', 'ink-3'] };
  let table = '';
  if (r.kind === 'three_way') table = `<div class="tbl"><div class="tbl-tools"><button data-act="wf-csv">Download CSV</button></div><table class="list"><tr><th>Item</th><th>Ordered</th><th>Received</th><th>Billed</th><th>Rate ordered</th><th>Rate billed</th><th>Amount</th><th>Check</th></tr>${r.lines.map(l => `<tr><td>${esc(l.item)}</td><td>${l.poQty ?? ''}</td><td>${l.grnQty ?? ''}</td><td>${l.invQty ?? ''}</td><td>${money(l.poRate)}</td><td>${money(l.invRate)}</td><td>${money(l.invAmount)}</td><td>${l.flags.length ? l.flags.map(f => `<span class="flag">${esc(f)}</span>`).join('') : chip('Matches', 'ok')}</td></tr>`).join('')}</table></div>`;
  if (r.kind === 'quotes') table = `<div class="tbl"><div class="tbl-tools"><button data-act="wf-csv">Download CSV</button></div><table class="list"><tr><th>Item</th>${r.suppliers.map(s => `<th>${esc(s.supplier)}${s.supplier === r.recommended ? ' ★' : ''}</th>`).join('')}</tr>${r.lines.map(l => `<tr><td>${esc(l.item)}</td>${l.cells.map((c, i) => `<td class="${i === l.best ? 'best' : ''}">${c ? money(c.rate) : '<span class="faint">Not quoted</span>'}</td>`).join('')}</tr>`).join('')}<tr><td><b>Total</b></td>${r.suppliers.map(s => `<td><b>${money(s.total)}</b></td>`).join('')}</tr></table></div>`;
  return `<div class="grid two" style="align-items:start"><div class="card"><div class="card-head"><h3>Summary</h3></div><dl class="kv">${r.summary.map(s => `<dt>${esc(s[0])}</dt><dd>${esc(s[1])}</dd>`).join('')}</dl></div>
    <div class="card"><div class="card-head"><h3>What was checked</h3></div>${r.findings.map(f => `<div class="row" style="align-items:flex-start;margin-bottom:9px"><span class="material-icons mi" style="color:var(--vnk-${fi[f.level][1]})">${fi[f.level][0]}</span><span class="grow">${esc(f.text)}</span></div>`).join('')}</div></div>
    ${table ? `<div class="card" style="margin-top:16px"><div class="card-head"><h3>${r.kind === 'quotes' ? 'Rates by supplier' : 'Line by line'}</h3></div>${table}</div>` : ''}`;
}
function pageRun(id) {
  if (F.runKey !== id) { F.runKey = id; F.run = null; api('GET', '/api/workflows/' + id).then(w => { F.run = w; rerender(); }).catch(e => { F.run = { error: e.message }; rerender(); }); }
  const w = F.run;
  if (!w || w.error) return gptShell('flows', `<div class="gpt-top">${navToggle()}<h3>Workflows</h3></div><div class="scroll" id="scroll"><div class="page"><a class="back" href="#/gpt/flows">${icon('arrow_back')}Workflows</a>${w ? `<div class="empty">${icon('lock')}${esc(w.error)}</div>` : '<p class="muted">Loading…</p>'}</div></div>`);
  const big = w.amount > 1000000;
  return gptShell('flows', `<div class="gpt-top">${navToggle()}<h3 class="ellipsis grow">${esc(w.title)}</h3>${statusChip(w)}</div>
    <div class="scroll" id="scroll"><div class="page"><a class="back" href="#/gpt/flows">${icon('arrow_back')}Workflows</a>
      <div class="page-head"><span class="avatar sq" style="width:44px;height:44px">${icon(TYPES[w.type].icon)}</span><div class="grow"><h1 style="font-size:24px;line-height:1.2">${esc(w.title)}</h1><p class="sub">${esc(w.typeName)} · ${esc(w.createdByName)} · ${when(w.createdAt)} · ${w.inputs.map(i => esc(i.name)).join(', ')}</p></div></div>
      ${w.status === 'needs_approval' ? `<div class="card" style="margin-bottom:16px;border-color:var(--vnk-warn)"><div class="card-head"><span class="material-icons mi" style="color:var(--vnk-warn)">pan_tool</span><h3 class="grow">Waiting for a person to decide</h3></div>
        ${w.canDecide ? `<textarea class="input" id="wf-note" rows="2" placeholder="Reason for your decision (kept in the audit log)"></textarea>${big ? `<label class="field" style="margin-top:10px"><span>This is above 10 lakh rupees. Type APPROVE to confirm.</span><input class="input" id="wf-confirm" style="width:200px" autocomplete="off"></label>` : ''}<div class="row" style="margin-top:12px"><button class="btn" data-act="wf-decide" data-v="1">Approve</button><button class="btn ghost" data-act="wf-decide" data-v="">Reject</button></div>` : '<p class="muted">An owner or admin has to approve or reject this run. They see it under Needs attention on their home screen.</p>'}</div>` : ''}
      ${w.decision ? `<div class="banner ${w.decision.approve ? 'ok' : 'err'}">${icon(w.decision.approve ? 'check_circle' : 'cancel')}<span><b>${w.decision.approve ? 'Approved' : 'Rejected'} by ${esc(w.decision.by)}</b> · ${when(w.decision.at)}${w.decision.note ? ' · ' + esc(w.decision.note) : ''}</span></div>` : ''}
      ${resultHtml(w.result)}
      <div class="card" style="margin-top:16px"><div class="card-head"><h3>Steps</h3>${info('Run key: ' + w.key + '. The same documents are never processed twice by accident.')}</div><div class="steps">${w.steps.map(s => `<div class="step done"><span class="dot">${icon('check')}</span><span>${esc(s.label)}</span><span class="small muted">${esc(s.detail || '')}</span></div>`).join('')}</div></div>
    </div></div>`);
}
acts['wf-decide'] = async el => { const w = await api('POST', `/api/workflows/${F.run.id}/decision`, { approve: !!el.dataset.v, note: $('#wf-note').value, confirm: $('#wf-confirm') ? $('#wf-confirm').value.trim() : '' }); toast(w.outcome + '.'); F.runKey = ''; rerender(); };
acts['wf-csv'] = el => downloadText('check-result.csv', [...el.closest('.tbl').querySelectorAll('tr')].map(r => [...r.children].map(c => '"' + c.innerText.trim().replace(/\s+/g, ' ').replace(/"/g, '""') + '"').join(',')).join('\n'), 'text/csv');

export function flowsPage(parts) {
  const [a, b] = parts;
  if (a === 'new') return pageNew(b);
  if (a) return pageRun(a);
  return pageList();
}
