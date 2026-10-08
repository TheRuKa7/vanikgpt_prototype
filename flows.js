// Workflows: checks on documents that follow fixed rules and stop for a person when something is off.
import { S, $, esc, icon, info, chip, go, ago, when, api, rerender, acts, ins, toast, modal, menu, confirmBox, extractFile, pickFiles, downloadText, navToggle } from './core.js';
import { gptShell } from './gpt.js';

const TYPES = {
  three_way: { name: 'Three-way match', icon: 'receipt_long', what: 'Checks an invoice against its purchase order and goods receipt, line by line.', slots: [['po', 'Purchase order'], ['grn', 'Goods receipt'], ['invoice', 'Invoice']] },
  kyc: { name: 'Vendor KYC check', icon: 'verified_user', what: 'Reads a vendor\'s documents and checks PAN, GSTIN, bank and identity details against each other.', many: 'Vendor documents', role: 'doc' },
  quotes: { name: 'Quote comparison', icon: 'compare_arrows', what: 'Lines up quotes from several suppliers and points to the lowest complete one.', many: 'Supplier quotes', role: 'quote' },
};
const F = { list: null, key: '', run: null, runKey: '', type: 'three_way', files: [], tolerance: 1, busy: false, custom: null };
export const flowsRouteChanged = () => { F.key = ''; F.runKey = ''; };
const loadCustom = () => api('GET', '/api/workflow-types').then(t => { F.custom = t; rerender(); }).catch(e => toast(e.message, 'err'));
// The three built in, then the ones people made here.
const types = () => ({ ...TYPES, ...Object.fromEntries((F.custom || []).map(t => ['custom:' + t.id, { name: t.name, icon: t.icon, what: t.description || `${t.rules.length} ${t.rules.length === 1 ? 'rule' : 'rules'} on ${t.docs.map(d => d.label.toLowerCase()).join(' and ')}.`, slots: t.docs.map(d => [d.role, d.label]), def: t }])) });
const mayEdit = t => S.boot.admin || t.createdBy === S.boot.me.id;
const STATUS = { completed: 'ok', needs_approval: 'warn', rejected: 'err' };
const statusChip = w => chip(w.status === 'needs_approval' ? 'Waiting for a decision' : w.outcome, STATUS[w.status] || '');
const money = n => n === null || n === undefined ? '' : Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });

function pageList() {
  if (F.key !== 'list') { F.key = 'list'; api('GET', '/api/workflows').then(l => { F.list = l; rerender(); }).catch(e => toast(e.message, 'err')); }
  const l = F.list;
  return gptShell('flows', `<div class="gpt-top">${navToggle()}<h3 class="grow">Checks ${info('Checks that follow fixed rules, not guesses. When something is off, the run stops for a person to decide.', 'tip-down')}</h3><a class="btn ghost" href="#/gpt/flows/build">${icon('tune')}Build a check</a><a class="btn" href="#/gpt/flows/new">${icon('add')}Run a check</a></div>
    <div class="scroll" id="scroll"><div class="page">
      <div class="grid" style="margin-bottom:22px">${Object.entries(types()).map(([k, t]) => `<a class="card flat app-card" style="min-height:0" href="#/gpt/flows/new/${encodeURIComponent(k)}"><div class="row"><span class="avatar sq">${icon(t.icon)}</span><h3 class="grow ellipsis">${esc(t.name)}</h3>${t.def ? `${chip('Yours', 'line')}${mayEdit(t.def) ? `<button class="icon-btn sm" data-act="ft-menu" data-stop data-id="${t.def.id}" aria-label="More">${icon('more_vert')}</button>` : ''}` : ''}</div><p class="small muted">${esc(t.what)}</p></a>`).join('')}
        <a class="card flat app-card add" style="min-height:0" href="#/gpt/flows/build"><div class="row"><span class="avatar sq">${icon('add')}</span><h3 class="grow">Build your own</h3></div><p class="small muted">List the documents and the rules. It runs the same way every time.</p></a></div>
      <div class="card"><div class="card-head"><h3>Runs</h3></div>${!l ? '<p class="muted">Loading…</p>' : l.length ? `<table class="list"><tr><th>What</th><th>Check</th><th>Result</th><th>By</th><th>When</th></tr>${l.map(w => `<tr><td><a class="link" href="#/gpt/flows/${w.id}">${esc(w.title)}</a></td><td class="muted">${esc(w.typeName)}</td><td>${statusChip(w)}</td><td class="muted">${esc(w.createdByName)}</td><td class="muted">${ago(w.createdAt)}</td></tr>`).join('')}</table>` : '<p class="muted">No runs yet. Pick a check above to start one.</p>'}</div>
    </div></div>`);
}

function pageNew(type) {
  const all = types();
  if (all[type] && F.type !== type) { F.type = type; F.files = []; }
  if (!all[F.type]) F.type = 'three_way';
  const t = all[F.type], slot = (role, label) => { const f = F.files.find(x => x.role === role); return `<div class="slot ${f ? 'filled' : ''}">${icon(f ? 'description' : 'upload_file')}<div class="grow"><b>${label}</b><div class="small muted ellipsis">${f ? esc(f.name) : 'PDF, Excel, CSV or text'}</div></div>${f ? `<button class="icon-btn sm" data-act="wf-remove" data-name="${esc(f.name)}" aria-label="Remove">${icon('close')}</button>` : `<button class="btn ghost" data-act="wf-pick" data-role="${role}">Choose file</button>`}</div>`; };
  const ready = t.slots ? t.slots.every(s => F.files.some(f => f.role === s[0])) : F.files.length >= (F.type === 'quotes' ? 2 : 1);
  return gptShell('flows', `<div class="gpt-top">${navToggle()}<h3 class="grow">New check</h3><a class="btn ghost" href="#/gpt/flows">Cancel</a><button class="btn" data-act="wf-run" ${ready && !F.busy ? '' : 'disabled'}>${F.busy ? 'Checking…' : 'Run check'}</button></div>
    <div class="scroll" id="scroll"><div class="page"><div class="stack" style="max-width:720px;gap:16px">
      <div class="card"><div class="card-head"><h3>What to check</h3></div><div class="row wrap" style="gap:6px">${Object.entries(all).map(([k, x]) => `<button class="tag ${k === F.type ? 'on' : ''}" data-act="wf-type" data-v="${esc(k)}">${esc(x.name)}</button>`).join('')}</div><p class="small muted" style="margin-top:12px">${esc(t.what)}</p></div>
      <div class="card"><div class="card-head"><h3>Documents</h3>${info('Tables are read from Excel, CSV and text files with item, quantity, rate and amount columns. Scanned PDFs are read with OCR first.')}</div><div id="uploads"></div>
        <div class="stack" style="gap:10px">${t.slots ? t.slots.map(s => slot(s[0], s[1])).join('') : `${F.files.map(f => `<div class="slot filled">${icon('description')}<div class="grow ellipsis"><b>${esc(f.name)}</b></div><button class="icon-btn sm" data-act="wf-remove" data-name="${esc(f.name)}" aria-label="Remove">${icon('close')}</button></div>`).join('')}<div class="slot">${icon('upload_file')}<div class="grow"><b>${t.many}</b><div class="small muted">${F.type === 'quotes' ? 'One file per supplier, at least two' : 'PAN, GST certificate, bank letter, identity'}</div></div><button class="btn ghost" data-act="wf-pick" data-role="${t.role}" data-many="1">Add files</button></div>`}</div></div>
      ${F.type === 'three_way' ? `<div class="card"><div class="set-row"><div class="grow"><div class="lbl">Allowed difference in rate ${info('A billed rate within this share of the ordered rate passes without a flag.')}</div></div><select class="input" style="width:110px" data-change="wf-tol">${[0, 1, 2, 5].map(v => `<option value="${v}" ${F.tolerance === v ? 'selected' : ''}>${v}%</option>`).join('')}</select></div></div>` : ''}
    </div></div></div>`);
}
acts['wf-type'] = el => { F.type = el.dataset.v; F.files = []; go('#/gpt/flows/new/' + encodeURIComponent(F.type)); };
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
  if (!w || w.error) return gptShell('flows', `<div class="gpt-top">${navToggle()}<h3>Checks</h3></div><div class="scroll" id="scroll"><div class="page"><a class="back" href="#/gpt/routines">${icon('arrow_back')}Routines</a>${w ? `<div class="empty">${icon('lock')}${esc(w.error)}</div>` : '<p class="muted">Loading…</p>'}</div></div>`);
  const big = w.amount > 1000000;
  return gptShell('flows', `<div class="gpt-top">${navToggle()}<h3 class="ellipsis grow">${esc(w.title)}</h3>${statusChip(w)}</div>
    <div class="scroll" id="scroll"><div class="page"><a class="back" href="#/gpt/routines">${icon('arrow_back')}Routines</a>
      <div class="page-head"><span class="avatar sq" style="width:44px;height:44px">${icon((types()[w.type] || { icon: 'rule' }).icon)}</span><div class="grow"><h1 style="font-size:24px;line-height:1.2">${esc(w.title)}</h1><p class="sub">${esc(w.typeName)} · ${esc(w.createdByName)} · ${when(w.createdAt)} · ${w.inputs.map(i => esc(i.name)).join(', ')}</p></div></div>
      ${w.status === 'needs_approval' ? `<div class="card" style="margin-bottom:16px;border-color:var(--vnk-warn)"><div class="card-head"><span class="material-icons mi" style="color:var(--vnk-warn)">pan_tool</span><h3 class="grow">Waiting for a person to decide</h3></div>
        ${w.canDecide ? `<textarea class="input" id="wf-note" rows="2" placeholder="Reason for your decision (kept in the audit log)"></textarea>${big ? `<label class="field" style="margin-top:10px"><span>This is above 10 lakh rupees. Type APPROVE to confirm.</span><input class="input" id="wf-confirm" style="width:200px" autocomplete="off"></label>` : ''}<div class="row" style="margin-top:12px"><button class="btn" data-act="wf-decide" data-v="1">Approve</button><button class="btn ghost" data-act="wf-decide" data-v="">Reject</button></div>` : '<p class="muted">An owner or admin has to approve or reject this run. They see it under Needs attention on their home screen.</p>'}</div>` : ''}
      ${w.decision ? `<div class="banner ${w.decision.approve ? 'ok' : 'err'}">${icon(w.decision.approve ? 'check_circle' : 'cancel')}<span><b>${w.decision.approve ? 'Approved' : 'Rejected'} by ${esc(w.decision.by)}</b> · ${when(w.decision.at)}${w.decision.note ? ' · ' + esc(w.decision.note) : ''}</span></div>` : ''}
      ${resultHtml(w.result)}
      <div class="card" style="margin-top:16px"><div class="card-head"><h3>Steps</h3>${info('Run key: ' + w.key + '. The same documents are never processed twice by accident.')}</div><div class="steps">${w.steps.map(s => `<div class="step done"><span class="dot">${icon('check')}</span><span>${esc(s.label)}</span><span class="small muted">${esc(s.detail || '')}</span></div>`).join('')}</div></div>
    </div></div>`);
}
acts['wf-decide'] = async el => { const w = await api('POST', `/api/workflows/${F.run.id}/decision`, { approve: !!el.dataset.v, note: $('#wf-note').value, confirm: $('#wf-confirm') ? $('#wf-confirm').value.trim() : '' }); toast(w.outcome + '.'); F.runKey = ''; rerender(); };
acts['wf-csv'] = el => downloadText('check-result.csv', [...el.closest('.tbl').querySelectorAll('tr')].map(r => [...r.children].map(c => '"' + c.innerText.trim().replace(/\s+/g, ' ').replace(/"/g, '""') + '"').join(',')).join('\n'), 'text/csv');

// ---------- build a workflow: the documents it reads, the rules it checks, and when a person has to decide
const FIELDS = [['gstin', 'a GSTIN'], ['pan', 'a PAN'], ['ifsc', 'an IFSC'], ['invoice no', 'an invoice number'], ['po no', 'a purchase order number'], ['date', 'a date'], ['total', 'a total']];
const SAME = [['po no', 'The purchase order number'], ['gstin', 'The GSTIN'], ['invoice no', 'The invoice number']];
const NEW_RULE = { present: ['Must contain', 'A GSTIN, a PAN, a date, a total…', () => ({ type: 'present', doc: 'any', field: 'gstin' })], valid_ids: ['GSTINs must be valid', 'Every GSTIN passes its checksum', () => ({ type: 'valid_ids' })], same_value: ['Same in every document', 'The PO number or GSTIN does not change', () => ({ type: 'same_value', field: 'po no' })],
  totals_match: ['Totals must match', 'Two documents agree on the total', d => ({ type: 'totals_match', a: d[0].role, b: (d[1] || d[0]).role, tolerance: 1 })], phrase: ['Must mention words', 'Or must not mention them', () => ({ type: 'phrase', doc: 'any', text: '', must: true })], max_total: ['Total has a limit', 'Stops above an amount', () => ({ type: 'max_total', doc: 'any', amount: 100000 })] };
let W = null;
function pageBuild(id) {
  const src = id && (F.custom || []).find(t => t.id === id);
  if (!W || W.id !== (id || null)) { if (id && !src) return gptShell('flows', `<div class="gpt-top">${navToggle()}<h3>Checks</h3></div><div class="scroll" id="scroll"><div class="page"><p class="muted">${F.custom ? 'This workflow is gone.' : 'Loading…'}</p></div></div>`); W = src ? JSON.parse(JSON.stringify({ ...src, id })) : { id: null, name: '', description: '', icon: 'rule', approval: 'fail', docs: [{ role: 'd1', label: 'Purchase order' }, { role: 'd2', label: 'Invoice' }], rules: [NEW_RULE.totals_match[2]([{ role: 'd1' }, { role: 'd2' }])] }; }
  const sel = (i, k, opts, v) => `<select class="input" data-change="fb" data-p="rules.${i}.${k}">${opts.map(o => `<option value="${esc(o[0])}" ${String(o[0]) === String(v) ? 'selected' : ''}>${esc(o[1])}</option>`).join('')}</select>`;
  const docs = W.docs.filter(d => d.label.trim()).map(d => [d.role, 'the ' + d.label.toLowerCase()]), anyDocs = [['any', 'any document'], ...docs];
  const rule = (r, i) => `<div class="rule">${{
    present: () => `${sel(i, 'doc', anyDocs.map(d => [d[0], d[1][0].toUpperCase() + d[1].slice(1)]), r.doc)}<span>must contain</span>${sel(i, 'field', FIELDS, r.field)}`,
    valid_ids: () => `<span>Every GSTIN in the documents must pass its checksum</span>`,
    same_value: () => `${sel(i, 'field', SAME, r.field)}<span>must be the same in every document</span>`,
    totals_match: () => `<span>The total of</span>${sel(i, 'a', docs, r.a)}<span>must match</span>${sel(i, 'b', docs, r.b)}<span>within</span><input class="input n" type="number" min="0" max="50" value="${+r.tolerance || 0}" data-on="fb" data-p="rules.${i}.tolerance"><span>%</span>`,
    phrase: () => `${sel(i, 'doc', anyDocs.map(d => [d[0], d[1][0].toUpperCase() + d[1].slice(1)]), r.doc)}${sel(i, 'must', [['1', 'must mention'], ['', 'must not mention']], r.must ? '1' : '')}<input class="input" maxlength="120" placeholder="received in good condition" value="${esc(r.text)}" data-on="fb" data-p="rules.${i}.text">`,
    max_total: () => `<span>The total of</span>${sel(i, 'doc', anyDocs, r.doc)}<span>must not be above</span><input class="input n" style="width:130px" type="number" min="1" value="${+r.amount || 0}" data-on="fb" data-p="rules.${i}.amount">`,
  }[r.type]()}<button class="icon-btn sm" data-act="fb-del" data-p="rules" data-i="${i}" aria-label="Remove this rule">${icon('close')}</button></div>`;
  return gptShell('flows', `<div class="gpt-top">${navToggle()}<h3 class="grow">${W.id ? 'Change check' : 'Build a check'}</h3><a class="btn ghost" href="#/gpt/flows">Cancel</a><button class="btn" data-act="fb-save">Save</button></div>
    <div class="scroll" id="scroll"><div class="page"><div class="stack" style="max-width:760px;gap:16px">
      <div class="card"><div class="stack"><label class="field"><span>Name</span><input class="input" maxlength="60" placeholder="Delivery note check" value="${esc(W.name)}" data-on="fb" data-p="name"></label><label class="field"><span>What it is for</span><input class="input" maxlength="200" placeholder="Checks a delivery note against its purchase order before stores accept the goods." value="${esc(W.description)}" data-on="fb" data-p="description"></label></div></div>
      <div class="card"><div class="card-head"><h3>Documents it reads</h3>${info('The person who runs the workflow uploads one file for each. PDF, Excel, CSV and text all work.')}</div><div class="stack" style="gap:8px">${W.docs.map((d, i) => `<div class="row"><span class="avatar sq">${icon('description')}</span><input class="input grow" maxlength="40" placeholder="Delivery note" value="${esc(d.label)}" data-on="fb" data-change="fb" data-p="docs.${i}.label" data-redraw="1">${W.docs.length > 1 ? `<button class="icon-btn sm" data-act="fb-del" data-p="docs" data-i="${i}" aria-label="Remove this document">${icon('close')}</button>` : ''}</div>`).join('')}</div>${W.docs.length < 6 ? `<button class="btn ghost" style="margin-top:12px" data-act="fb-doc">${icon('add')}Add a document</button>` : ''}</div>
      <div class="card"><div class="card-head"><h3>Rules</h3>${info('Each rule is an exact check with a yes or no result. Nothing is guessed. A run lists every rule and whether it was met.')}</div><div>${W.rules.map(rule).join('') || '<p class="muted">No rules yet.</p>'}</div><button class="btn ghost" style="margin-top:12px" data-act="fb-rule">${icon('add')}Add a rule</button></div>
      <div class="card"><div class="set-row"><div class="grow"><div class="lbl">A person must approve ${info('A run that needs approval stops and shows under Needs attention for owners and admins.')}</div></div><div class="seg">${[['fail', 'When a rule fails'], ['always', 'Every time'], ['never', 'Never']].map(a => `<button class="${W.approval === a[0] ? 'on' : ''}" data-act="fb-approval" data-v="${a[0]}">${a[1]}</button>`).join('')}</div></div></div>
    </div></div></div>`);
}
const setPath = (p, v) => { const k = p.split('.'); let o = W; for (const x of k.slice(0, -1)) o = o[x]; const last = k[k.length - 1]; o[last] = last === 'must' ? !!v : ['tolerance', 'amount'].includes(last) ? +v : v; };
ins.fb = (el, e) => { setPath(el.dataset.p, el.value); if (el.tagName === 'SELECT' || (el.dataset.redraw && e.type === 'change')) rerender(); };
acts['fb-doc'] = () => { W.docs.push({ role: 'd' + (Math.max(0, ...W.docs.map(d => +d.role.slice(1) || 0)) + 1), label: '' }); rerender(); setTimeout(() => { const all = document.querySelectorAll('[data-p^="docs."]'); if (all.length) all[all.length - 1].focus(); }, 0); };
acts['fb-del'] = el => { const [gone] = W[el.dataset.p].splice(+el.dataset.i, 1); if (el.dataset.p === 'docs') W.rules = W.rules.filter(r => ![r.a, r.b].includes(gone.role)).map(r => r.doc === gone.role ? { ...r, doc: 'any' } : r); rerender(); };
acts['fb-rule'] = el => menu(el, Object.entries(NEW_RULE).filter(([k]) => k !== 'totals_match' || W.docs.length > 1).map(([, r]) => ({ label: r[0], sub: r[1], run: () => { W.rules.push(r[2](W.docs)); rerender(); } })));
acts['fb-approval'] = el => { W.approval = el.dataset.v; rerender(); };
acts['fb-save'] = async () => { const t = await api(W.id ? 'PUT' : 'POST', '/api/workflow-types' + (W.id ? '/' + W.id : ''), W); W = null; await loadCustom(); toast(`${t.name} saved.`); go('#/gpt/flows/new/' + encodeURIComponent('custom:' + t.id)); };
acts['ft-menu'] = el => { const t = F.custom.find(x => x.id === el.dataset.id); menu(el, [{ label: 'Change', icon: 'edit', run: () => go('#/gpt/flows/build/' + t.id) }, '-', { label: 'Delete', icon: 'delete_outline', danger: true, run: () => confirmBox(`Delete "${t.name}"?`, 'Runs already made are kept. Nobody can start a new one.', 'Delete', async () => { await api('DELETE', '/api/workflow-types/' + t.id); await loadCustom(); }) }]); };

export function flowsPage(parts) {
  const [a, b] = parts;
  if (!F.custom) { F.custom = false; loadCustom(); }
  if (a === 'build') return pageBuild(b);
  W = null;
  if (a === 'new') return pageNew(b);
  if (a) return pageRun(a);
  return pageList();
}
