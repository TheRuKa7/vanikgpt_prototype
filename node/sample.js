// Sample workspace and stand-ins, so every flow can be seen working end to end without outside systems.
// - A sample supplier portal the Browser and Computer plugins can drive (pages are drawn, not fetched).
// - A sample ERP tool connector, a sample shared folder and a sample webhook receiver, all under sample:// addresses.
// - seed(): people, knowledge, agents, chats, workflow runs, an API key and a webhook, created through the same code paths a person uses.
'use strict';
const HOST = 'supplier-portal.example';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const inr = n => '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const state = { pace: 600 }; // pause per browser step, so a run can be watched

// ---------- the sample supplier portal
const PARTS = [
  ['M12-HB-50', 'M12 hex bolt 50 mm, zinc plated', 12.5, '3 days', 42000],
  ['M12-HN', 'M12 hex nut', 3.2, '3 days', 96000],
  ['SW-12', 'Spring washer 12 mm', 0.9, '2 days', 150000],
  ['M10-HB-40', 'M10 hex bolt 40 mm', 8.75, '3 days', 61000],
  ['M16-HB-80', 'M16 hex bolt 80 mm, high tensile', 46, '7 days', 8500],
  ['FW-12', 'Flat washer 12 mm', 0.7, '2 days', 220000],
  ['AB-M16-150', 'Anchor bolt M16 x 150 mm', 92, '10 days', 3000],
  ['TR-M12-1M', 'Threaded rod M12, 1 metre', 138, '5 days', 4100],
];
const ORDERS = [['OR-2026-0977', '18 Sep 2026', 'M12 hex bolt 50 mm × 5,000 and 2 more', inr(83000), 'Delivered'], ['OR-2026-0931', '02 Sep 2026', 'M16 hex bolt 80 mm × 400', inr(18400), 'Delivered'], ['OR-2026-0902', '21 Aug 2026', 'Anchor bolt M16 x 150 mm × 120', inr(11040), 'Delivered']];
const CONTRACT = { 'M12-HB-50': 11.8, 'M12-HN': 3.05, 'SW-12': 0.85, 'M10-HB-40': 8.3, 'M16-HB-80': 43.5, 'FW-12': 0.66, 'AB-M16-150': 87, 'TR-M12-1M': 131 };
const GATED = ['/account', '/invoices'];
const xml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

class SimTab {
  constructor() { this.sim = true; this.path = ''; this.q = ''; this.vals = {}; this.focus = null; this.pointer = [512, 330]; this.hit = false; this.basket = null; this.placed = false; this.user = null; this.next = ''; this.account = ''; }
  get url() { return this.path ? `https://${HOST}${this.path}${this.path === '/search' ? '?q=' + encodeURIComponent(this.q) : ''}` : 'about:blank'; }
  // One description of the page feeds both what the agent reads and what is drawn.
  page() {
    const els = [], draw = [], text = [], tables = [];
    const T = (t, x, y, size = 15, o = {}) => { draw.push(`<text x="${x}" y="${y}" font-size="${size}" fill="${o.fill || '#0b0c0c'}" font-weight="${o.bold ? 700 : 400}">${xml(t)}</text>`); if (!o.quiet) text.push(t); };
    const link = (label, x, y, go, o = {}) => { const w = label.length * (o.size || 14) * 0.56; els.push({ tag: 'a', type: '', label, href: `https://${HOST}${go}`, x: Math.round(x + w / 2), y: y - 5, w, h: 22, go }); draw.push(`<text x="${x}" y="${y}" font-size="${o.size || 14}" fill="${o.fill || '#0f7a47'}" font-weight="600" text-decoration="${o.plain ? 'none' : 'underline'}">${xml(label)}</text>`); };
    const input = (label, x, y, w, name, type = 'text') => { const v = this.vals[name] || '', on = this.focus === name; els.push({ tag: 'input', type, label, href: '', x: Math.round(x + w / 2), y: y + 20, w, h: 40, name }); draw.push(`<rect x="${x}" y="${y}" width="${w}" height="40" rx="8" fill="#fff" stroke="${on ? '#0b0c0c' : '#c9c9c3'}" stroke-width="${on ? 2 : 1}"/><text x="${x + 14}" y="${y + 25}" font-size="15" fill="${v ? '#0b0c0c' : '#8a8c86'}">${xml(v ? (type === 'password' ? '•'.repeat(v.length) : v) : label)}</text>${on ? `<rect x="${x + 15 + v.length * 8.2}" y="${y + 10}" width="1.5" height="20" fill="#0b0c0c"/>` : ''}`); };
    const button = (label, x, y, w, action, o = {}) => { els.push({ tag: 'button', type: o.submit ? 'submit' : 'button', label, href: '', x: Math.round(x + w / 2), y: y + 20, w, h: 40, action, submit: !!o.submit }); draw.push(`<rect x="${x}" y="${y}" width="${w}" height="40" rx="20" fill="${o.ghost ? '#fff' : '#0b0c0c'}" stroke="#0b0c0c"/><text x="${x + w / 2}" y="${y + 25}" font-size="14" font-weight="600" text-anchor="middle" fill="${o.ghost ? '#0b0c0c' : '#fff'}">${xml(label)}</text>`); };
    const table = (x, y, widths, rows, linkCol) => {
      const W = widths.reduce((a, b) => a + b, 0); tables.push(rows);
      draw.push(`<rect x="${x}" y="${y}" width="${W}" height="${rows.length * 36}" rx="10" fill="#fff" stroke="#e2e2de"/><rect x="${x}" y="${y}" width="${W}" height="36" rx="10" fill="#efefec"/>`);
      rows.forEach((r, i) => { let cx = x; if (i) draw.push(`<line x1="${x}" y1="${y + i * 36}" x2="${x + W}" y2="${y + i * 36}" stroke="#e2e2de"/>`); r.forEach((c, j) => { if (i && j === linkCol) link(c, cx + 14, y + i * 36 + 23, '/part/' + c, { size: 13 }); else draw.push(`<text x="${cx + 14}" y="${y + i * 36 + 23}" font-size="13" font-weight="${i ? 400 : 700}" fill="${i ? '#0b0c0c' : '#555751'}">${xml(c)}</text>`); cx += widths[j]; }); if (i) text.push(r.join(' · ')); });
    };
    draw.push('<rect width="1024" height="640" fill="#f6f6f3"/><rect width="1024" height="56" fill="#0b0c0c"/><rect x="24" y="16" width="24" height="24" rx="6" fill="#18a05e"/>');
    link('Shree Fasteners supplier portal', 60, 34, '/', { fill: '#fff', plain: true, size: 15 });
    link('Price list', 690, 34, '/prices', { fill: '#fff', plain: true }); link('Orders', 800, 34, '/orders', { fill: '#fff', plain: true }); link(this.user ? 'Account' : 'Sign in', 900, 34, this.user ? '/account' : '/signin', { fill: '#fff', plain: true });
    const part = PARTS.find(p => '/part/' + p[0] === this.path);
    const partRows = list => [['Part no', 'Description', 'Unit price', 'Lead time', 'In stock'], ...list.map(p => [p[0], p[1], inr(p[2]), p[3], p[4].toLocaleString('en-IN')])];
    let title = 'Shree Fasteners supplier portal';
    if (this.path === '/') {
      T('Find a part', 60, 120, 30, { bold: true }); input('Search parts', 60, 146, 560, 'q'); button('Search', 636, 146, 120, 'search');
      T('Prices are valid until 31 December 2026. Minimum order value is ₹5,000.', 60, 226, 14, { fill: '#555751' }); T('Orders placed before 2 pm ship the same day. GST at 18% is added to every order.', 60, 248, 14, { fill: '#555751' });
      T('Popular parts', 60, 306, 18, { bold: true }); table(60, 324, [150, 400, 120, 110, 120], partRows(PARTS.slice(0, 4)), 0);
    } else if (this.path === '/prices') { title = 'Price list'; T('Price list', 60, 112, 28, { bold: true }); T('Unit prices in rupees, before GST. Valid until 31 December 2026.', 60, 138, 14, { fill: '#555751' }); table(60, 158, [150, 400, 120, 110, 120], partRows(PARTS), 0); }
    else if (this.path === '/search') { const hit = PARTS.filter(p => (p[0] + ' ' + p[1]).toLowerCase().includes(this.q.toLowerCase())); title = `Results for ${this.q}`; T(`Results for "${this.q}"`, 60, 112, 28, { bold: true }); T(hit.length ? `${hit.length} ${hit.length === 1 ? 'part matches' : 'parts match'}.` : 'No part matches. Try a size such as M12.', 60, 138, 14, { fill: '#555751' }); if (hit.length) table(60, 158, [150, 400, 120, 110, 120], partRows(hit), 0); }
    else if (part) {
      title = part[1]; T(part[1], 60, 112, 26, { bold: true });
      [['Part no', part[0]], ['Unit price', inr(part[2]) + ' before GST'], ['Lead time', part[3]], ['In stock', part[4].toLocaleString('en-IN') + ' pieces'], ['Pack size', '100 pieces']].forEach((r, i) => { T(r[0], 60, 156 + i * 30, 14, { fill: '#555751', quiet: true }); T(r[1], 200, 156 + i * 30, 15, { quiet: true }); text.push(r[0] + ': ' + r[1]); });
      T('Quantity', 60, 330, 14, { bold: true, quiet: true }); input('Quantity', 60, 344, 200, 'qty'); button('Add to quote', 276, 344, 160, 'addQuote');
    } else if (this.path === '/quote' && this.basket) {
      const [p, n] = this.basket, sub = p[2] * n; title = 'Your quote'; T('Your quote', 60, 112, 28, { bold: true });
      table(60, 136, [150, 400, 110, 120, 120], [['Part no', 'Description', 'Quantity', 'Unit price', 'Amount'], [p[0], p[1], n.toLocaleString('en-IN'), inr(p[2]), inr(sub)]]);
      [['Subtotal', inr(sub)], ['GST 18%', inr(sub * 0.18)], ['Total', inr(sub * 1.18)]].forEach((r, i) => { T(r[0], 700, 250 + i * 28, 14, { fill: '#555751', quiet: true }); T(r[1], 820, 250 + i * 28, 15, { bold: i === 2, quiet: true }); text.push(r[0] + ': ' + r[1]); });
      T(`Ships in ${p[3]} from the Pune warehouse.`, 60, 250, 14, { fill: '#555751' }); button('Place order', 780, 344, 140, 'place', { submit: true }); button('Keep browsing', 620, 344, 144, 'home', { ghost: true });
    } else if (this.path === '/order/placed') {
      title = 'Order request received'; draw.push('<circle cx="84" cy="118" r="24" fill="#18a05e"/><path d="M73 118 l8 8 l15 -16" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round"/>');
      T('Order request received', 124, 128, 28, { bold: true }); T('Reference OR-2026-1042.', 60, 186, 16, { bold: true });
      if (this.basket) T(`${this.basket[0][1]} × ${this.basket[1].toLocaleString('en-IN')}, total ${inr(this.basket[0][2] * this.basket[1] * 1.18)} including GST.`, 60, 216, 15);
      T('Shree Fasteners will confirm by email within one working day.', 60, 246, 15); T('Nothing is charged until you approve the confirmation.', 60, 272, 15); link('View orders', 60, 320, '/orders');
    } else if (this.path === '/orders') { title = 'Orders'; T('Orders', 60, 112, 28, { bold: true }); table(60, 136, [150, 330, 130, 130, 160], [['Reference', 'Items', 'Date', 'Total', 'Status'], ...(this.placed && this.basket ? [['OR-2026-1042', `${this.basket[0][1].slice(0, 26)} × ${this.basket[1]}`, 'Today', inr(this.basket[0][2] * this.basket[1] * 1.18), 'Waiting for confirmation']] : []), ...ORDERS.map(o => [o[0], o[2].slice(0, 36), o[1], o[3], o[4]])]); }
    else if (this.path === '/signin') { title = 'Sign in'; T('Sign in', 60, 112, 28, { bold: true }); T('Sign in to see contract prices and invoices.', 60, 138, 14, { fill: '#555751' }); input('Email', 60, 160, 360, 'email'); input('Password', 60, 212, 360, 'password', 'password'); button('Sign in', 60, 268, 120, 'signin', { submit: true }); draw.push('<line x1="60" y1="336" x2="420" y2="336" stroke="#e2e2de"/>'); T('or', 232, 362, 13, { fill: '#8a8c86', quiet: true }); button('Continue with company SSO', 60, 380, 360, 'sso', { ghost: true }); }
    else if (this.path === '/signin/code') { title = 'Verification code'; T('Check your phone', 60, 112, 28, { bold: true }); T('Enter the verification code we sent to the phone on this account.', 60, 138, 14, { fill: '#555751' }); input('Verification code', 60, 160, 240, 'otp'); button('Verify', 316, 160, 104, 'verify', { submit: true }); T('The code is valid for 5 minutes.', 60, 226, 13, { fill: '#8a8c86' }); }
    else if (this.path === '/account') { title = 'Contract prices'; T('Contract prices', 60, 112, 28, { bold: true }); T(`Signed in as ${this.user.name}. Prices under the supply agreement, valid until 31 December 2026.`, 60, 138, 14, { fill: '#555751' }); table(60, 158, [150, 360, 120, 140, 130], [['Part no', 'Description', 'List price', 'Contract price', 'Lead time'], ...PARTS.map(p => [p[0], p[1], inr(p[2]), inr(CONTRACT[p[0]]), p[3]])], 0); }
    else if (this.path === '/invoices') { title = 'Invoices'; T('Invoices', 60, 112, 28, { bold: true }); T(`Signed in as ${this.user.name}.`, 60, 138, 14, { fill: '#555751' }); table(60, 158, [150, 160, 200, 170, 220], [['Invoice', 'Date', 'Purchase order', 'Total', 'Status'], ['INV-7802', '27 Sep 2026', 'PO-2026-0412', inr(104123.2), 'Disputed by the buyer'], ['INV-7791', '20 Sep 2026', 'PO-2026-0412', inr(97940), 'Withdrawn'], ['INV-7710', '04 Sep 2026', 'PO-2026-0398', inr(21712), 'Paid']]); }
    else { title = 'Page not found'; T('Page not found', 60, 112, 28, { bold: true }); link('Back to the start', 60, 150, '/'); }
    return { title, els, draw, text, tables };
  }
  async goto(url) {
    let u; try { u = new URL(url); } catch { throw new Error('That is not a full web address.'); }
    if (u.hostname !== HOST) throw new Error(`This chat is using the sample browser, which only opens https://${HOST}.`);
    await sleep(state.pace); this.open(u.pathname || '/'); this.q = u.searchParams.get('q') || ''; this.focus = null; this.hit = false;
  }
  open(path) { if (GATED.includes(path) && !this.user) { this.next = path; this.path = '/signin'; this.vals.email = ''; this.vals.password = ''; this.vals.otp = ''; } else this.path = path; }
  done(name) { this.user = { name }; this.path = this.next || '/account'; this.next = ''; this.focus = null; }
  async vaultSignIn(account) { await sleep(state.pace); this.vals.email = account || 'buyer@example.com'; this.vals.password = '••••••••••'; const e = this.page().els.find(o => o.action === 'signin'); this.pointer = [e.x, e.y]; this.hit = true; this.account = this.vals.email; await sleep(state.pace); this.path = '/signin/code'; this.focus = 'otp'; }
  async enterOtp(code) { await sleep(state.pace); if (!/^\d{6}$/.test(String(code).trim())) return false; this.vals.otp = String(code).trim(); const e = this.page().els.find(o => o.action === 'verify'); this.pointer = [e.x, e.y]; this.hit = true; this.done(this.account || 'buyer@example.com'); return true; }
  async personSignedIn() { await sleep(state.pace); this.done('you'); }
  async snapshot() {
    if (!this.path) return { url: 'about:blank', title: '', text: '', elements: [], tables: [], password: false, captcha: false };
    const p = this.page();
    return { url: this.url, title: p.title, text: p.text.join('\n'), elements: p.els.map((e, i) => ({ i, tag: e.tag, type: e.type, label: e.label, href: e.href, x: e.x, y: e.y, submit: !!e.submit })), tables: p.tables, password: p.els.some(e => e.type === 'password'), otp: this.path === '/signin/code', captcha: false };
  }
  act(e) {
    this.pointer = [e.x, e.y]; this.hit = true;
    if (e.tag === 'input') { this.focus = e.name; return; }
    this.focus = null;
    if (e.go) { this.open(e.go); return; }
    if (e.action === 'sso') this.done(this.account || 'your company account');
    if (e.action === 'search') { this.q = (this.vals.q || '').trim(); this.path = '/search'; }
    if (e.action === 'addQuote') { const part = PARTS.find(p => '/part/' + p[0] === this.path); this.basket = [part, Math.max(1, parseInt(String(this.vals.qty || '1').replace(/,/g, ''), 10) || 1)]; this.path = '/quote'; }
    if (e.action === 'place') { this.placed = true; this.path = '/order/placed'; }
    if (e.action === 'home') this.path = '/';
  }
  async click(i) { await sleep(state.pace); const e = this.page().els[i]; if (e) this.act(e); }
  async clickAt(x, y) { await sleep(state.pace); const e = this.page().els.find(o => Math.abs(o.x - x) <= o.w / 2 + 4 && Math.abs(o.y - y) <= o.h / 2 + 4); if (e) this.act(e); else { this.pointer = [x, y]; this.hit = true; this.focus = null; } }
  async type(i, text) { await sleep(state.pace); const e = this.page().els[i]; if (!e) return; this.pointer = [e.x, e.y]; this.hit = true; this.focus = e.name; this.vals[e.name] = String(text); }
  async typeRaw(text) { await sleep(state.pace); if (this.focus) this.vals[this.focus] = (this.vals[this.focus] || '') + text; }
  async key(key) { await sleep(state.pace); this.hit = false; if (key !== 'enter') return; const a = this.focus === 'q' ? 'search' : this.focus === 'qty' ? 'addQuote' : null; if (a) this.act({ ...this.page().els.find(e => e.action === a), tag: 'button' }); }
  async scroll() { await sleep(state.pace / 2); this.hit = false; }
  async shot() {
    const p = this.page(), [x, y] = this.pointer;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="640" viewBox="0 0 1024 640" font-family="Segoe UI, Helvetica, Arial, sans-serif">${p.draw.join('')}<g transform="translate(${x} ${y})">${this.hit ? '<circle r="18" fill="#18a05e" opacity=".28"/><circle r="9" fill="#18a05e" opacity=".4"/>' : ''}<path d="M0 0 L0 19 L5 14.5 L8.6 22 L11.6 20.6 L8 13.4 L14.6 13.4 Z" fill="#0b0c0c" stroke="#fff" stroke-width="1.4"/></g></svg>`;
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }
  closeTab() {}
}

// ---------- the sample ERP tool connector (speaks the same three calls a real connector does)
const PO = { 'PO-2026-0412': { supplier: 'Shree Fasteners Pvt Ltd', gstin: '27AAPFU0939F1ZV', date: '2026-09-12', status: 'Goods received, invoice pending', lines: [['M12 hex bolt 50 mm', 5000, 12.5], ['M12 hex nut', 5000, 3.2], ['Spring washer 12 mm', 5000, 0.9]] }, 'PO-2026-0398': { supplier: 'Apex Industrial', gstin: '29AAGCA8719M1Z6', date: '2026-09-03', status: 'Closed', lines: [['M16 hex bolt 80 mm', 400, 46]] } };
const BAL = { 'shree fasteners': ['Shree Fasteners Pvt Ltd', 104123.2, 1, 'INV-7802 on hold: rate and quantity differ from the purchase order'], 'apex industrial': ['Apex Industrial', 0, 0, 'Nothing outstanding'], 'northline supplies': ['Northline Supplies', 48250, 2, 'Both invoices are in the Friday payment run'] };
const MCP_TOOLS = [
  { name: 'get_purchase_order', description: 'Reads one purchase order from the ERP: supplier, lines, total and status.', inputSchema: { type: 'object', properties: { po_number: { type: 'string' } } }, annotations: { readOnlyHint: true } },
  { name: 'vendor_balance', description: 'What is owed to a vendor and which invoices are open.', inputSchema: { type: 'object', properties: { vendor: { type: 'string' } } }, annotations: { readOnlyHint: true } },
  { name: 'create_payment_hold', description: 'Puts an invoice on hold so it is left out of the next payment run. Changes the ERP, so it asks first.', inputSchema: { type: 'object', properties: { invoice_no: { type: 'string' }, reason: { type: 'string' } } } },
];
async function mcp(method, params = {}) {
  await sleep(Math.min(state.pace, 350));
  if (method === 'initialize') return { protocolVersion: '2025-03-26', serverInfo: { name: 'Sample ERP', version: '1.0' }, capabilities: { tools: {} } };
  if (method === 'tools/list') return { tools: MCP_TOOLS };
  if (method !== 'tools/call') return {};
  const a = params.arguments || {}, say = (text, isError) => ({ content: [{ type: 'text', text }], isError: !!isError });
  if (params.name === 'get_purchase_order') {
    const k = String(a.po_number || '').toUpperCase(), p = PO[k]; if (!p) return say(`No purchase order ${k || '(none given)'} in the sample ERP. Try PO-2026-0412.`, true);
    const total = p.lines.reduce((s, l) => s + l[1] * l[2], 0);
    return say(`| Field | Value |\n|---|---|\n| PO number | ${k} |\n| Supplier | ${p.supplier} |\n| Supplier GSTIN | ${p.gstin} |\n| Date | ${p.date} |\n| Status | ${p.status} |\n\n| Item | Qty | Rate | Amount |\n|---|---|---|---|\n${p.lines.map(l => `| ${l[0]} | ${l[1].toLocaleString('en-IN')} | ${l[2].toFixed(2)} | ${(l[1] * l[2]).toLocaleString('en-IN')} |`).join('\n')}\n| **Total** | | | **${total.toLocaleString('en-IN')}** |`);
  }
  if (params.name === 'vendor_balance') { const b = BAL[String(a.vendor || '').toLowerCase().replace(/\s+(pvt|private|ltd|limited).*$/, '').trim()]; return b ? say(`${b[0]}: ${inr(b[1])} outstanding across ${b[2]} open ${b[2] === 1 ? 'invoice' : 'invoices'}. ${b[3]}.`) : say('No vendor with that name in the sample ERP. Try Shree Fasteners.', true); }
  if (params.name === 'create_payment_hold') return a.invoice_no ? say(`Hold HLD-3107 placed on ${a.invoice_no}. Reason recorded: ${a.reason || 'not given'}. It is left out of payment runs until someone releases it.`) : say('Give an invoice number.', true);
  return say('The sample ERP has no tool with that name.', true);
}

// ---------- documents
const DOC = {
  'leave-and-travel-policy.md': `# Leave and travel policy (sample)

## Leave
Every employee gets 12 days of casual leave and 15 days of earned leave in a calendar year. Unused casual leave lapses on 31 December. Up to 30 days of earned leave can be carried forward to the next year.

Leave of more than three days in a row needs approval from the reporting manager at least five working days before it starts. Sick leave of more than two days needs a medical certificate.

## Travel
Book flights at least 7 days before the travel date. Economy class is the rule for all domestic travel. A trip that costs more than 40,000 rupees in total needs approval from the department head before booking.

Hotel stays are capped at 6000 rupees a night in metro cities (Mumbai, Delhi, Bengaluru, Chennai, Kolkata, Hyderabad and Pune) and 4000 rupees a night in other cities. The cap is before GST.

Meals on travel are reimbursed up to 1200 rupees a day against bills. Local travel by cab is reimbursed against the app receipt.

## Claims
Submit travel claims within 15 days of returning. Claims without bills are not paid. Claims are paid with the next salary after the reporting manager approves them.`,
  'expense-reimbursement-policy.md': `# Expense reimbursement policy (sample)

Team lunches are reimbursed up to 800 rupees a person, once a quarter, with the manager's approval in advance.

Mobile and internet bills are reimbursed up to 1500 rupees a month for employees who work from home at least three days a week.

Client gifts need approval from the department head and must not cost more than 2500 rupees a person. Cash gifts are never allowed.

Any single expense above 10,000 rupees needs a purchase order raised before the money is spent. Expenses are claimed in the expense tool with a photo of the bill within 30 days.`,
  'code-of-conduct.md': `# Code of conduct (sample)

Treat colleagues, vendors and customers with respect. Harassment of any kind is not tolerated and can be reported to the people team or on the ethics line without giving your name.

Do not accept gifts worth more than 1000 rupees from a vendor. Declare any gift you receive to your manager within a week.

Company data stays on company systems. Do not paste customer data, prices or contracts into outside chat tools. Use VanikGPT, which runs on the company's own appliance.

A conflict of interest, such as a relative working for a vendor, must be declared before you take part in the buying decision.`,
  'vendor-payments-sop.txt': `Vendor payments SOP (sample)

Payment runs happen every Tuesday and Friday. An invoice must be approved by 5 pm on the previous working day to be in the run.

Standard payment terms are 45 days from the invoice date. Vendors registered as micro or small enterprises (MSME) are paid within 30 days from the date the goods are accepted.

Vendor payments above 5 lakh rupees need approval from the finance controller. Payments above 25 lakh rupees also need approval from the CFO.

Every invoice is matched against the purchase order and the goods receipt note before payment. A quantity difference of more than 1 percent, or a rate above the purchase order rate, sends the invoice to the exceptions queue and puts it on hold.

New vendors are paid only after their GST registration and bank account are verified. Bank account changes need a signed letter from the vendor and a call back to the registered phone number.

Advance payments are allowed only against a bank guarantee and never above 20 percent of the order value.`,
  'procurement-policy.md': `# Procurement policy (sample)

## Approval limits for purchase orders
- Up to 50,000 rupees: the team lead.
- Above 50,000 and up to 5 lakh rupees: the department head.
- Above 5 lakh and up to 25 lakh rupees: the department head and the finance controller.
- Above 25 lakh rupees: the CFO as well.

## Quotes
Any purchase above 1 lakh rupees needs three written quotes. The lowest complete quote wins unless the buyer records a reason, such as delivery time or quality history.

## Vendors
A new vendor goes through KYC before the first order: PAN, GST registration, a cancelled cheque or bank letter, and the identity of a director. Vendors are reviewed every two years.

## Splitting orders
Splitting a purchase into smaller orders to stay under an approval limit is not allowed.`,
  'gst-quick-reference.md': `# GST quick reference (sample)

Fasteners such as bolts, nuts and washers fall under HSN 7318 and carry GST at 18 percent.

A supply inside the same state carries CGST and SGST in equal halves. A supply between two states carries IGST at the full rate.

The first two digits of a GSTIN are the state code: 27 is Maharashtra, 29 is Karnataka, 07 is Delhi, 33 is Tamil Nadu.

Input tax credit can be claimed only when the supplier's GSTIN on the invoice is valid and the invoice shows in GSTR-2B.`,
  'open-purchase-orders.csv': `PO Number,Supplier,Department,Amount,Status
PO-2026-0412,Shree Fasteners Pvt Ltd,Plant maintenance,83000,Goods received
PO-2026-0398,Apex Industrial,Projects,18400,Closed
PO-2026-0421,Northline Supplies,Plant maintenance,48250,Open
PO-2026-0425,Apex Industrial,Projects,480000,Waiting for approval
PO-2026-0430,Shree Fasteners Pvt Ltd,Projects,126500,Open
PO-2026-0433,Kaveri Tools,Tool room,39200,Open`,
  'msa-shree-fasteners.md': `# Master supply agreement with Shree Fasteners Pvt Ltd (sample)

## Term
The agreement runs from 1 April 2026 to 31 March 2028. Either side can end it with 60 days' written notice.

## Prices
Prices in the price list are fixed until 31 December 2026. After that the supplier can ask for a revision once a year, capped at 6 percent.

## Delivery
Standard parts are delivered within 3 working days of the order. For every full week of delay the supplier pays a penalty of 1 percent of the order value, capped at 5 percent.

## Quality
Rejected parts are replaced within 7 days at the supplier's cost. More than three rejected lots in a quarter lets the buyer end the agreement at once.

## Payment
Payment is due 30 days from the date the goods are accepted, since the supplier is a registered small enterprise.

## Confidentiality
Prices and drawings shared under this agreement are confidential for three years after it ends.`,
  'msa-apex-industrial.md': `# Supply agreement with Apex Industrial (sample)

The agreement runs from 1 July 2025 to 30 June 2027 and renews for one year unless either side gives 90 days' notice.

Payment is due 45 days from the invoice date. Late payment carries interest at 12 percent a year.

Delivery of standard parts is within 7 working days. There is no penalty for delay, but the buyer can cancel an order that is more than 14 days late.

Liability of either side is capped at the value of orders in the previous 12 months.`,
};
DOC['po-export.sql'] = `-- Open purchase orders by supplier (sample). Run on the ERP reporting replica, never on the live database.
SELECT po.po_number, s.name AS supplier, po.department, po.amount, po.status
FROM purchase_orders po
JOIN suppliers s ON s.id = po.supplier_id
WHERE po.status IN ('Open', 'Goods received', 'Waiting for approval')
  AND po.created_on >= DATE '2026-04-01'   -- this financial year
ORDER BY po.amount DESC;
-- Orders above 5 lakh rupees also need the finance controller: see the procurement policy.`;
const CALL = `Call with Shree Fasteners, 29 September 2026 (sample transcript).
Asha Verma: We received invoice INV-7802. The bolt rate is 13.40 but the purchase order says 12.50, and it bills 5,200 nuts where we ordered and received 5,000.
Supplier: The 13.40 is the new list price from our October sheet. It was applied by mistake. The extra 200 nuts were a packing error on our side.
Asha Verma: Under the agreement prices are fixed until 31 December 2026, so 12.50 stands. Please send a corrected invoice.
Supplier: Agreed. We will withdraw INV-7802 and issue a corrected invoice for 83,000 plus GST by 6 October 2026.
Asha Verma: Thank you. We will keep INV-7802 on hold until the corrected invoice arrives.`;
const WF = {
  po: `PO Number,PO-2026-0412\nSupplier,Shree Fasteners Pvt Ltd\nSupplier GSTIN,27AAPFU0939F1ZV\nDate,2026-09-12\n\nItem,HSN,Qty,Rate,Amount\nM12 hex bolt 50 mm,7318,5000,12.50,62500\nM12 hex nut,7318,5000,3.20,16000\nSpring washer 12 mm,7318,5000,0.90,4500\nTotal,,,,83000\n`,
  grn: `GRN Number,GRN-5521\nPO Number,PO-2026-0412\nReceived on,2026-09-18\n\nItem,Received Qty\nM12 hex bolt 50 mm,5000\nM12 hex nut,5000\nSpring washer 12 mm,5000\n`,
  invBad: `Invoice No,INV-7802\nInvoice Date,2026-09-27\nPO Number,PO-2026-0412\nSupplier,Shree Fasteners Pvt Ltd\nSupplier GSTIN,27AAPFU0939F1ZV\n\nItem,HSN,Qty,Rate,Amount\nM12 hex bolt 50 mm,7318,5000,13.40,67000\nM12 hex nut,7318,5200,3.20,16640\nSpring washer 12 mm,7318,5000,0.90,4600\nTaxable value,,,,88240\nIGST 18%,,,,15883.20\nGrand total,,,,104123.20\n`,
  invOk: `Invoice No,INV-7791\nInvoice Date,2026-09-20\nPO Number,PO-2026-0412\nSupplier,Shree Fasteners Pvt Ltd\nSupplier GSTIN,27AAPFU0939F1ZV\n\nItem,HSN,Qty,Rate,Amount\nM12 hex bolt 50 mm,7318,5000,12.50,62500\nM12 hex nut,7318,5000,3.20,16000\nSpring washer 12 mm,7318,5000,0.90,4500\nTaxable value,,,,83000\nIGST 18%,,,,14940\nGrand total,,,,97940\n`,
  quotes: [['shree-fasteners.csv', `Supplier,Shree Fasteners Pvt Ltd\nItem,Qty,Rate,Amount\nM12 hex bolt 50 mm,5000,12.50,62500\nM12 hex nut,5000,3.20,16000\nSpring washer 12 mm,5000,0.90,4500\n`], ['apex-industrial.csv', `Supplier,Apex Industrial\nItem,Qty,Rate,Amount\nM12 hex bolt 50 mm,5000,11.90,59500\nM12 hex nut,5000,3.45,17250\nSpring washer 12 mm,5000,0.85,4250\n`], ['northline-supplies.csv', `Supplier,Northline Supplies\nItem,Qty,Rate,Amount\nM12 hex bolt 50 mm,5000,12.10,60500\nM12 hex nut,5000,3.10,15500\n`]],
  kyc: [['gst-certificate.txt', 'Certificate of registration (sample)\nLegal name: Shree Fasteners Pvt Ltd\nGSTIN: 27AAPFU0939F1ZV\nState: Maharashtra\n'], ['pan-card.txt', 'Income tax department (sample)\nName: Shree Fasteners Pvt Ltd\nPermanent account number: AAPFU0939F\n'], ['bank-letter.txt', 'Bank letter (sample)\nAccount name: Shree Fasteners Pvt Ltd\nAccount number: 50200012345678\nIFSC: HDFC0001234\n']],
  note: 'Delivery note DN-8841\nSupplier: Shree Fasteners Pvt Ltd\nSupplier GSTIN: 27AAPFU0939F1ZV\nPO Number: PO-2026-0412\nDate: 2026-09-18\nReceived in good condition by stores.\nTotal: 83000\n',
};
// The sample shared folder: what a mounted finance share would hold.
const SHARE = { 'sample://finance-share': ['vendor-payments-sop.txt', 'procurement-policy.md', 'gst-quick-reference.md', 'open-purchase-orders.csv', 'po-export.sql'] };
const shareFiles = p => (SHARE[p] || []).map(n => ({ name: n, text: DOC[n], mtime: 1 }));

// ---------- the sample workspace
async function seed(x) {
  const { db, call, ask, attach, fastDeploy, audit, uid } = x, owner = db.users.find(u => u.role === 'owner'), was = state.pace; state.pace = 0;
  const ago = (d, h = 0, m = 0) => new Date(Date.now() - d * 864e5 - h * 36e5 - m * 6e4).toISOString();
  try {
    // people
    const person = async (name, email, role, teams, status) => { let u = db.users.find(p => p.email === email); if (!u) { await call(owner, 'POST', '/api/users', { name, email, role, teams }); u = db.users.find(p => p.email === email); } if (status === 'active') { u.status = 'active'; u.lastActiveAt = ago(0, 3); } return u; };
    const asha = await person('Asha Verma', 'asha.verma@example.com', 'admin', ['Finance'], 'active'), rohan = await person('Rohan Mehta', 'rohan.mehta@example.com', 'user', ['Procurement'], 'active');
    await person('Neha Iyer', 'neha.iyer@example.com', 'user', ['HR'], 'active'); await person('Imran Khan', 'imran.khan@example.com', 'user', ['Legal']);
    // the app: installed, set up and running
    if (db.app.status === 'not_installed') await call(owner, 'POST', '/api/app/install');
    const cfg = JSON.parse(JSON.stringify(db.app.config)); cfg.tools = { ...cfg.tools, sites: [...new Set([...(cfg.tools.sites || []), HOST])], signins: [{ host: HOST, kind: 'vault', account: 'buyer@example.com' }] }; cfg.safety = { ...cfg.safety, voice: true };
    await call(owner, 'PUT', '/api/app/config', { config: cfg, note: 'Sample workspace', deploy: db.app.status !== 'running' }); fastDeploy();
    // knowledge
    const col = async (name, description, access, files) => { const c = await call(owner, 'POST', '/api/collections', { name, description, access }); for (const f of files) await call(owner, 'POST', `/api/collections/${c.id}/documents`, { name: f, type: f.split('.').pop(), size: DOC[f].length, pages: [DOC[f]], purpose: 'Sample document' }); return c; };
    const hr = await col('HR policies', 'Leave, travel, expenses and conduct', { mode: 'everyone' }, ['leave-and-travel-policy.md', 'expense-reimbursement-policy.md', 'code-of-conduct.md']);
    const fin = await col('Finance and procurement', 'Payment rules, approval limits and open orders', { mode: 'everyone' }, []);
    const legal = await col('Vendor contracts', 'Supply agreements with vendors', { mode: 'restricted', teams: ['Legal', 'Procurement', 'Finance'], users: [] }, ['msa-shree-fasteners.md', 'msa-apex-industrial.md']);
    // connectors: a watched folder that fills the finance collection, and the ERP tools
    await call(owner, 'POST', '/api/connectors', { path: 'sample://finance-share', collectionId: fin.id, everyMinutes: 15 });
    const erp = await call(owner, 'POST', '/api/mcp', { name: 'ERP', url: 'sample://erp' });
    // API gateway: a key for an outside system and a webhook that hears about events
    const key = await call(owner, 'POST', '/api/gateway/keys', { name: 'ERP bridge', knowledge: [fin.id] }); const k = db.keys.find(o => o.id === key.id); if (k) { k.requests = 1284; k.tokens = 912400; k.lastUsedAt = ago(0, 1, 12); }
    const hook = await call(owner, 'POST', '/api/webhooks', { url: 'sample://erp/hooks/vanik', events: ['workflow.needs_approval', 'workflow.completed', 'invoice.reconciled', 'document.added', 'answer.not_helpful'] });
    // agents
    const cat = (await call(owner, 'GET', '/api/agents/catalog')).templates, tpl = k2 => cat.find(t => t.key === k2) || {};
    const agent = (b) => call(owner, 'POST', '/api/assistants', { shared: true, access: { mode: 'everyone' }, ...b });
    const policy = await agent({ ...tpl('policy'), collections: [hr.id], starters: ['What is the hotel cap in Pune?', 'How much casual leave do I get?', 'Can I claim my home internet bill?'] });
    const invoice = await agent({ name: 'Invoice checker', icon: 'receipt_long', description: 'Checks a supplier invoice: GSTIN, GST sums, the purchase order in the ERP and when it is due.', instructions: 'You help the accounts team check supplier invoices. Check every GSTIN. Work out GST exactly. Read the purchase order from the ERP before you say an invoice is fine. Use the payments SOP for due dates and approvals, and cite it. Never release a payment yourself.', collections: [fin.id, legal.id], tools: ['calculator', 'gst', 'tables'], workflow: 'three_way', starters: ['Check GSTIN 27AAPFU0939F1ZV and work out 18% GST on 88240', '/use get_purchase_order po_number=PO-2026-0412', 'Who has to approve a payment of 6 lakh rupees?'] });
    const buyer = await agent({ name: 'Supplier portal buyer', icon: 'public', description: 'Looks up prices on the supplier portal, builds a quote and asks before it places anything.', access: { mode: 'restricted', teams: ['Procurement'], users: [] }, instructions: 'You look up parts on the supplier portal for the purchase team. Read prices and lead times from the page, never from memory. Build the quote the person asks for. Stop and ask before you place an order or submit anything. Never type a password.', collections: [fin.id], tools: ['browser', 'screen', 'calculator'], effort: 'thorough', starters: [`/browse https://${HOST}/prices find the M12 hex bolt price and lead time`, `/browse https://${HOST} then type "M16" into "Search parts" then click "Search"`, `/browse https://${HOST}/account find our contract price for the M12 hex bolt`] });
    await agent({ ...tpl('contract'), collections: [legal.id], access: { mode: 'restricted', teams: ['Legal', 'Procurement'], users: [] } });
    // saved prompts
    await call(owner, 'POST', '/api/prompts', { title: 'Summarise in five points', command: 'five', tags: ['summary'], text: 'Summarise this in five plain points. Keep numbers, dates and names exact.', shared: true });
    await call(owner, 'POST', '/api/prompts', { title: 'Draft a reply to the vendor', command: 'reply', tags: ['vendor'], text: 'Draft a short, polite reply to the vendor. State the facts, what we need from them and by when.', shared: true });

    // chats. Tools run for real. Where a model would write, the sample answer is given, with the passages the search really found.
    const chat = async (b, day, turns, o = {}) => {
      const c = await call(owner, 'POST', '/api/chats', b), full = db.chats.find(q => q.id === c.id); let t = 0;
      for (const turn of turns) {
        if (turn.file) { await attach(owner, full, { name: turn.file, type: turn.file.split('.').pop(), size: DOC[turn.file].length, pages: [DOC[turn.file]] }); continue; }
        if (turn.allow) await ask(owner, full, { resume: true, allow: true }); else await ask(owner, full, { content: turn.q }, turn.a);
        const pair = full.messages.slice(-2); t += 4; pair[0].at = ago(day, 0, 40 - t); const m = pair[1]; m.at = ago(day, 0, 40 - t - 0.3); if (turn.a) m.ms = 1800 + Math.round(turn.a.length * 9); else if (m.activity) m.ms = 400 + m.activity.length * 900; if (turn.up) m.feedback = 'up';
      }
      full.createdAt = ago(day, 1); full.updatedAt = ago(day, 0, 40 - t); if (o.title) full.title = o.title; if (o.pinned) full.pinned = true; return full;
    };
    await chat({ sources: 'all' }, 2, [
      { q: 'I am going to Pune for a 3 day client visit next month. What can I claim for the hotel and food?', up: true, a: 'For a Pune trip you can claim:\n\n- **Hotel:** up to 6,000 rupees a night, before GST. Pune counts as a metro city in the policy [[leave-and-travel-policy.md]].\n- **Meals:** up to 1,200 rupees a day, against bills [[leave-and-travel-policy.md]].\n- **Local cabs:** the amount on the app receipt [[leave-and-travel-policy.md]].\n\nFor three nights that is at most 18,000 rupees for the hotel and 3,600 rupees for meals. Keep every bill, because claims without bills are not paid [[leave-and-travel-policy.md]].' },
      { q: 'How early do I have to book the flight, and does anyone need to approve the trip?', a: 'Book the flight at least **7 days before** you travel, in economy class [[leave-and-travel-policy.md]].\n\nApproval depends on the cost. If the whole trip costs more than 40,000 rupees, your department head has to approve it before you book [[leave-and-travel-policy.md]]. Below that, no approval is needed to book, but your reporting manager still approves the claim afterwards [[leave-and-travel-policy.md]].' },
      { q: '/calc 3 * 6000 * 1.18' },
      { q: 'When do I need to submit the claim after I am back?', a: 'Within **15 days** of returning [[leave-and-travel-policy.md]]. Once your reporting manager approves it, it is paid with the next salary [[leave-and-travel-policy.md]].' },
      { q: 'Can I also claim my home internet bill?', up: true, a: 'Yes, if you work from home at least three days a week. Mobile and internet bills are reimbursed up to 1,500 rupees a month [[expense-reimbursement-policy.md]]. Claim it in the expense tool with a photo of the bill within 30 days [[expense-reimbursement-policy.md]].' },
    ], { title: 'Pune client visit: what I can claim', pinned: true });
    await chat({ sources: 'all' }, 1, [
      { q: '/gst 27AAPFU0939F1ZV' },
      { file: 'open-purchase-orders.csv' },
      { q: '/table total of Amount' },
      { q: '/table top 3 by Amount' },
      { q: '/search payment terms for MSME vendors' },
      { q: 'One of these orders is for 4,80,000 rupees. Who has to approve it, and does it need quotes?', up: true, a: 'A purchase order of 4,80,000 rupees sits in the band above 50,000 and up to 5 lakh rupees, so the **department head** approves it [[procurement-policy.md]].\n\nIt also needs **three written quotes**, because that is the rule for any purchase above 1 lakh rupees. The lowest complete quote wins unless the buyer records a reason for choosing another [[procurement-policy.md]].\n\nOne caution: the order cannot be split into smaller ones to stay under a limit [[procurement-policy.md]].' },
    ], { title: 'Open purchase orders and approval limits' });
    await chat({ assistantId: invoice.id }, 0, [
      { q: 'Check GSTIN 27AAPFU0939F1ZV and work out 18% GST on 88240' },
      { q: '/use get_purchase_order po_number=PO-2026-0412' },
      { q: 'The invoice INV-7802 bills 13.40 a bolt and 5,200 nuts. Can it be paid, and by when?', up: true, a: 'Not yet. Two things on INV-7802 differ from PO-2026-0412:\n\n- The bolt is billed at 13.40, but the purchase order rate is 12.50.\n- 5,200 nuts are billed, but 5,000 were ordered and received.\n\nUnder the payments SOP, a rate above the purchase order rate or a quantity difference of more than 1 percent sends the invoice to the exceptions queue and puts it on hold [[vendor-payments-sop.txt]]. Ask Shree Fasteners for a corrected invoice or a credit note.\n\nOnce it is corrected: Shree Fasteners is a small enterprise, so payment is due within 30 days from the date the goods were accepted [[vendor-payments-sop.txt]]. Payment runs are on Tuesdays and Fridays, and the invoice has to be approved by 5 pm on the working day before [[vendor-payments-sop.txt]].' },
      { q: '/use vendor_balance vendor="Shree Fasteners"' },
      { q: '/use create_payment_hold invoice_no=INV-7802 reason="Rate and quantity differ from PO-2026-0412"' }, // left waiting, so the go-ahead card can be tried
    ], { title: 'INV-7802 from Shree Fasteners' });
    await chat({ assistantId: buyer.id }, 0, [
      { q: `/browse https://${HOST}/prices find the M12 hex bolt price and lead time` },
      { q: `/browse https://${HOST} then type "M12" into "Search parts" then click "Search" then click "M12-HB-50" then type "2000" into "Quantity" then click "Add to quote" then click "Place order"` },
      { allow: true },
      { q: `/screen open https://${HOST}/orders then click at 729, 29 then take a screenshot` },
      { q: '/calc 2000 * 12.5 * 1.18' },
      { q: `/browse https://${HOST}/account find our contract price for the M12 hex bolt` }, // needs a sign-in: the saved account is used, then it waits for the one-time code
    ], { title: 'M12 bolts from the supplier portal' });

    // workflows: one waiting for a decision, one matched, one approved, a KYC check and a custom check
    const run = async (who, body, day) => { const w = await call(who, 'POST', '/api/workflows', body); const full = db.workflows.find(o => o.id === w.id); full.createdAt = ago(day, 2); return full; };
    await run(asha, { type: 'three_way', options: { tolerance: 1 }, inputs: [{ role: 'po', name: 'purchase-order.csv', text: WF.po }, { role: 'grn', name: 'goods-receipt.csv', text: WF.grn }, { role: 'invoice', name: 'invoice-INV-7791.csv', text: WF.invOk }] }, 6);
    const q = await run(rohan, { type: 'quotes', inputs: WF.quotes.map(f => ({ role: 'quote', name: f[0], text: f[1] })) }, 4);
    await call(asha, 'POST', `/api/workflows/${q.id}/decision`, { approve: true, note: 'Apex is lowest on bolts, Shree on nuts. Going with the recommendation.' });
    await run(asha, { type: 'kyc', inputs: WF.kyc.map(f => ({ role: 'doc', name: f[0], text: f[1] })) }, 3);
    const def = await call(owner, 'POST', '/api/workflow-types', { name: 'Delivery note check', description: 'Checks a delivery note against its purchase order before stores accept the goods.', icon: 'local_shipping', docs: [{ role: 'po', label: 'Purchase order' }, { role: 'note', label: 'Delivery note' }], approval: 'fail',
      rules: [{ type: 'present', field: 'gstin', doc: 'note' }, { type: 'valid_ids' }, { type: 'same_value', field: 'po no' }, { type: 'totals_match', a: 'po', b: 'note', tolerance: 1 }, { type: 'phrase', doc: 'note', text: 'received in good condition', must: true }, { type: 'max_total', doc: 'note', amount: 500000 }] });
    await run(rohan, { type: 'custom:' + def.id, inputs: [{ role: 'po', name: 'purchase-order.csv', text: WF.po }, { role: 'note', name: 'delivery-note-DN-8841.txt', text: WF.note }] }, 1);
    await run(asha, { type: 'three_way', options: { tolerance: 1 }, inputs: [{ role: 'po', name: 'purchase-order.csv', text: WF.po }, { role: 'grn', name: 'goods-receipt.csv', text: WF.grn }, { role: 'invoice', name: 'invoice-INV-7802.csv', text: WF.invBad }] }, 0);
    // more kinds of knowledge: a recording with its transcript, and a note someone kept from a chat
    const rec = await call(owner, 'POST', `/api/collections/${legal.id}/documents`, { name: 'supplier-call-2026-09-29.m4a', type: 'm4a', audio: true, size: 2460000, purpose: 'Sample recording' });
    await call(owner, 'POST', `/api/documents/${rec.id}/transcript`, { text: CALL });
    await call(owner, 'POST', `/api/collections/${fin.id}/documents`, { name: 'dispute-log-oct.mp3', type: 'mp3', audio: true, size: 1310000, purpose: 'Sample recording' });
    await call(owner, 'POST', `/api/collections/${fin.id}/notes`, { title: 'M12 hex bolt: list price and contract price', text: 'List price on the supplier portal is ₹12.50 a piece. Our contract price is ₹11.80, fixed until 31 December 2026. Lead time is 3 days. Order through the portal account buyer@example.com.', from: `https://${HOST}/account` });
    // who may use what: the browser and the ERP are for the teams that buy and pay; finance can add to its own collection
    const acc = (kind, id, access, part) => call(owner, 'PUT', '/api/access', { kind, id, access, part });
    await acc('plugin', 'browser', { mode: 'restricted', teams: ['Procurement'], users: [] }); await acc('plugin', 'screen', { mode: 'restricted', teams: ['Procurement'], users: [] });
    await acc('connector', erp.id, { mode: 'restricted', teams: ['Finance', 'Procurement'], users: [] });
    await acc('collection', fin.id, { mode: 'restricted', teams: ['Finance'], users: [rohan.id] }, 'write');
    await acc('collection', hr.id, { mode: 'restricted', teams: ['HR'], users: [] }, 'write');
    // tasks and a finding passed to a colleague
    const day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10), wfBad = db.workflows[0];
    await call(asha, 'POST', '/api/tasks', { title: 'Get the corrected invoice from Shree Fasteners for INV-7802', note: 'They agreed on the call to withdraw INV-7802 and send a corrected one for 83,000 plus GST by 6 October.', assignee: owner.id, due: day(3), source: { type: 'run', runId: wfBad.id, name: wfBad.title } });
    await call(owner, 'POST', '/api/tasks', { title: 'Ask Shree Fasteners about the 2027 price revision', note: 'Prices are fixed until 31 December 2026. After that they can ask for a revision once a year, capped at 6 percent.', assignee: rohan.id, due: day(40), source: { type: 'doc', docId: db.documents.find(d => d.name === 'msa-shree-fasteners.md').id, name: 'msa-shree-fasteners.md' } });
    await call(asha, 'POST', '/api/tasks', { kind: 'share', title: 'Our contract price for M12 bolts is ₹11.80, not ₹12.50', note: 'Found on the supplier portal under Contract prices. The last purchase order used the list price of ₹12.50. On 5,000 pieces that is ₹3,500 more than it should be.', assignee: owner.id, source: { type: 'web', name: 'Contract prices', url: `https://${HOST}/account` } });
    const doneT = await call(owner, 'POST', '/api/tasks', { title: 'Submit the Pune travel claim within 15 days of returning', source: { type: 'doc', docId: db.documents.find(d => d.name === 'leave-and-travel-policy.md').id, name: 'leave-and-travel-policy.md' } });
    await call(owner, 'PATCH', '/api/tasks/' + doneT.id, { status: 'done' });
    // the things a person keeps for themselves: memory, notes, skills, an automation; and the admin's house rules
    const live = JSON.parse(JSON.stringify(db.app.config)); live.instructions = 'Answer in plain English. Quote amounts in rupees with Indian digit grouping. Never give legal or tax advice as final: point to the policy or the finance team.';
    await call(owner, 'PUT', '/api/app/config', { config: live, note: 'House rules', deploy: true }); fastDeploy();
    for (const t of ['I work in plant maintenance in Pune.', 'Keep answers short, with the rule first and the detail after.']) await call(owner, 'POST', '/api/memories', { text: t });
    await call(owner, 'POST', '/api/notes', { title: 'Questions for the Shree Fasteners review', text: '- Why did the October sheet price reach an invoice?\n- Can they hold 12.50 for the M12 bolt through March?\n- Ask for the corrected invoice number once it is issued.' });
    await call(owner, 'POST', '/api/notes', { title: 'Pune visit checklist', text: 'Book the flight 7 days ahead. Hotel under 6,000 a night. Keep every bill. Claim within 15 days.' });
    await call(owner, 'POST', '/api/skills', { name: 'Check a supplier invoice', description: 'Checks the GSTIN, reads the purchase order from the ERP and shows what is owed.', shared: true, steps: ['/gst 27AAPFU0939F1ZV', '/use get_purchase_order po_number=PO-2026-0412', '/use vendor_balance vendor="Shree Fasteners"'] });
    await call(owner, 'POST', '/api/skills', { name: 'Price a part on the supplier portal', description: 'Searches the portal for a part and reads its price and lead time.', shared: true, steps: [`/browse https://${HOST} then type "M12" into "Search parts" then click "Search"`, `/browse https://${HOST}/part/M12-HB-50 find the unit price and lead time`] });
    const auto = await call(owner, 'POST', '/api/automations', { name: 'What we owe Shree Fasteners', prompt: '/use vendor_balance vendor="Shree Fasteners"', every: 'day', assistantId: invoice.id });
    await call(owner, 'POST', `/api/automations/${auto.id}/run`);
    await call(owner, 'POST', '/api/parity/tools', { name: 'Working days between dates', slug: 'working_days', description: 'Counts working days between two dates, skipping weekends.', shared: true, code: 'class Tools:\n    def working_days(self, start: str, end: str) -> int:\n        \"\"\"Count working days between two ISO dates.\"\"\"\n        from datetime import date, timedelta\n        a, b = date.fromisoformat(start), date.fromisoformat(end)\n        return sum(1 for i in range((b - a).days + 1) if (a + timedelta(i)).weekday() < 5)\n' });
    await call(owner, 'POST', '/api/parity/functions', { name: 'Add a disclaimer to finance answers', slug: 'finance_disclaimer', description: 'A filter that appends a line to answers about tax.', code: 'class Filter:\n    def outlet(self, body: dict) -> dict:\n        return body\n' });
    const dd = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
    await call(owner, 'POST', '/api/parity/events', { title: 'Supplier review: Shree Fasteners', calendar: 'Personal', start: dd(2) + 'T11:00', end: dd(2) + 'T12:00', location: 'Meeting room 2', description: 'Bring the INV-7802 notes.' });
    await call(owner, 'POST', '/api/parity/events', { title: 'Travel claim deadline', calendar: 'Personal', start: dd(9), allDay: true });
    // the appliance side: a directory, a domain, one outside provider on a sample key, personal API keys, a past support session
    await call(owner, 'POST', '/api/edge/directory', { provider: 'Microsoft Entra ID' });
    await call(owner, 'PUT', '/api/edge/network', { domain: 'ai.example.com' });
    await call(owner, 'PUT', '/api/edge/outside/openrouter', { key: 'sample-key' });
    await call(owner, 'POST', '/api/edge/outside/openrouter/models', { id: 'anthropic/claude-opus-5.5' });
    await call(owner, 'PUT', '/api/edge/settings', { userKeys: true });
    await call(owner, 'POST', '/api/edge/support', { minutes: 60, reason: 'First deploy of VanikGPT was stuck on step 3' });
    await call(owner, 'POST', `/api/edge/support/${db.edge.support[0].id}/end`);
    audit(owner, 'Loaded the sample workspace', 'Vanik OS', '3 collections, 4 agents, 4 chats, 5 workflow runs');
    db.sample = { at: new Date().toISOString(), hook: hook.id, erp: erp.id };
  } finally { state.pace = was; }
}

module.exports = { HOST, SimTab, mcp, shareFiles, seed, state, DOC, WF };
