// Shared state, API client and small UI helpers used by both the Vanik OS console and the VanikGPT app.
export const S = { boot: null, userId: localStorage.getItem('vnk.user') || '' };
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const icon = (n, c = '') => `<span class="material-icons mi ${c}" aria-hidden="true">${n}</span>`;
export const info = (t, c = '') => `<span class="info ${c}" tabindex="0" data-tip="${esc(t)}">${icon('info_outline')}</span>`;
export const chip = (t, tone = '', dot = true) => `<span class="chip ${tone}">${dot ? '<i></i>' : ''}${esc(t)}</span>`;
export const initials = n => String(n || '?').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
export const LOGO = `<svg viewBox="0 0 26 26" aria-hidden="true"><circle cx="13" cy="13" r="13" fill="var(--vnk-brand)"/><path d="M6.5 8.5h3.6l2.6 6 4-8.2h2.9L13.6 19h-2.4z" fill="#fff"/></svg>`;
export const go = h => { if (location.hash === h) rerender(); else location.hash = h; };

export function bytes(n) { if (!n) return '0 B'; const u = ['B', 'KB', 'MB', 'GB']; let i = 0; while (n >= 1024 && i < 3) { n /= 1024; i++; } return (i ? n.toFixed(1) : n) + ' ' + u[i]; }
export function ago(iso) {
  if (!iso) return 'never';
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + 'm ago'; if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}
export const when = iso => iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';

export async function api(method, url, body) {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json', 'X-User': S.userId }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) { signOut(); throw new Error('Sign in first.'); }
  if (!r.ok) throw Object.assign(new Error(j.error || 'Request failed.'), { status: r.status });
  return j;
}
export async function load() { S.boot = await api('GET', '/api/bootstrap'); return S.boot; }
export function signOut() { S.userId = ''; S.boot = null; localStorage.removeItem('vnk.user'); if (location.hash !== '#/signin') location.hash = '#/signin'; else rerender(); }

let renderer = () => {};
export const setRenderer = fn => { renderer = fn; };
export const rerender = () => renderer();
export async function refresh() { await load(); rerender(); }

// ---------- actions: any element with data-act="name" calls acts[name](el, event)
export const acts = {}, ins = {};
document.addEventListener('click', async e => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  if (el.dataset.stop !== undefined) { e.preventDefault(); e.stopPropagation(); }
  const fn = acts[el.dataset.act];
  if (fn) try { await fn(el, e); } catch (x) { toast(x.message || 'Something went wrong.', 'err'); }
});
for (const ev of ['input', 'change']) document.addEventListener(ev, e => {
  const el = e.target.closest(`[data-${ev === 'input' ? 'on' : 'change'}]`);
  const fn = el && ins[el.dataset[ev === 'input' ? 'on' : 'change']];
  if (fn) Promise.resolve().then(() => fn(el, e)).catch(x => toast(x.message, 'err'));
});

// ---------- overlays
export function toast(msg, tone = '') {
  let box = $('.toasts'); if (!box) { box = document.createElement('div'); box.className = 'toasts'; document.body.appendChild(box); }
  const t = document.createElement('div'); t.className = 'toast ' + tone; t.textContent = msg; t.setAttribute('role', 'status'); box.appendChild(t);
  setTimeout(() => t.remove(), tone === 'err' ? 5200 : 2600);
}
export function modal({ title, text = '', body = '', actions = [], wide = false, cancel = 'Cancel' }) {
  const o = document.createElement('div'); o.className = 'overlay';
  o.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true"><h2>${esc(title)}</h2>${text ? `<p class="muted">${esc(text)}</p>` : ''}${body ? `<div class="body">${body}</div>` : ''}<div class="actions"></div></div>`;
  const back = document.activeElement, close = () => { o.remove(); if (back && back.isConnected) back.focus({ preventScroll: true }); }, bar = $('.actions', o);
  [{ label: cancel, ghost: true }, ...actions].forEach(a => {
    const b = document.createElement('button'); b.className = 'btn ' + (a.ghost ? 'ghost' : a.danger ? 'danger' : ''); b.textContent = a.label;
    b.onclick = async () => { if (!a.run) return close(); b.disabled = true; try { if (await a.run(o) !== false) close(); } catch (x) { toast(x.message, 'err'); } b.disabled = false; };
    bar.appendChild(b);
  });
  o.addEventListener('mousedown', e => { if (e.target === o) close(); });
  o.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    if (e.key === 'Enter' && e.target.tagName === 'INPUT' && actions.length && !bar.lastChild.disabled) bar.lastChild.click();
    if (e.key === 'Tab') { const f = $$('button:not(:disabled),input,textarea,select,a[href]', o).filter(x => x.offsetParent); if (!f.length) return; const first = f[0], last = f[f.length - 1]; if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); } }
  });
  document.body.appendChild(o);
  const box = $('.modal', o); box.tabIndex = -1;
  ($('input,textarea,select', o) || box).focus();
  return { el: o, close };
}
export const confirmBox = (title, text, label, run, danger = true) => modal({ title, text, actions: [{ label, danger, run }] });
let menuFor = null, menuShut = 0;
function closeMenu(refocus) { const open = $$('.menu'); open.forEach(m => m.remove()); document.removeEventListener('mousedown', outside, true); document.removeEventListener('keydown', menuKey, true); if (open.length && menuFor) { menuFor.setAttribute('aria-expanded', 'false'); if (refocus && menuFor.isConnected) menuFor.focus({ preventScroll: true }); } menuFor = null; }
function outside(e) { if (e.target.closest('.menu')) return; if (menuFor && menuFor.contains(e.target)) menuShut = Date.now(); closeMenu(); }
function menuKey(e) {
  const m = $('.menu'); if (!m) return;
  if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); return closeMenu(true); }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
  e.preventDefault(); const bs = $$('button', m), i = bs.indexOf(document.activeElement);
  bs[e.key === 'Home' ? 0 : e.key === 'End' ? bs.length - 1 : (i + (e.key === 'ArrowDown' ? 1 : -1) + bs.length) % bs.length].focus();
}
export function menu(anchor, items) {
  const again = Date.now() - menuShut < 400; menuShut = 0;
  closeMenu(); if (again) return; // a second click on the same button only closes
  const m = document.createElement('div'); m.className = 'menu'; m.setAttribute('role', 'menu');
  for (const it of items) {
    if (!it) continue;
    if (it === '-') { m.appendChild(document.createElement('hr')); continue; }
    if (it.heading) { const d = document.createElement('div'); d.className = 'mlabel'; d.textContent = it.heading; m.appendChild(d); continue; }
    const b = document.createElement('button'); b.className = it.danger ? 'danger' : ''; b.setAttribute('role', 'menuitem');
    b.innerHTML = (it.icon ? icon(it.icon) : '') + `<span>${esc(it.label)}${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</span>` + (it.on ? icon('check', 'tick') : '');
    b.onclick = async () => { closeMenu(); try { await it.run(); } catch (x) { toast(x.message, 'err'); } };
    m.appendChild(b);
  }
  document.body.appendChild(m);
  const r = anchor.getBoundingClientRect(), w = m.offsetWidth, h = m.offsetHeight;
  let top = r.bottom + 6; if (top + h > innerHeight - 8) top = r.top - h - 6 >= 8 ? r.top - h - 6 : Math.max(8, innerHeight - h - 8);
  m.style.left = Math.max(8, Math.min(r.left, innerWidth - w - 8)) + 'px'; m.style.top = top + 'px';
  m.style.transformOrigin = top < r.top ? 'bottom left' : 'top left';
  menuFor = anchor.closest('button, a') || anchor; menuFor.setAttribute('aria-expanded', 'true');
  setTimeout(() => { document.addEventListener('mousedown', outside, true); document.addEventListener('keydown', menuKey, true); }, 0);
}
for (const ev of ['hashchange', 'resize', 'blur']) addEventListener(ev, () => closeMenu());
addEventListener('hashchange', () => $$('.overlay').forEach(o => o.remove()));

export const navToggle = () => `<button class="icon-btn nav-toggle" data-act="nav-toggle" aria-label="Menu">${icon('menu')}</button>`;
acts['nav-toggle'] = () => document.body.classList.toggle('nav-open');
document.addEventListener('click', e => { if (document.body.classList.contains('nav-open') && !e.target.closest('.nav-toggle') && (!e.target.closest('.console-nav, .gpt-nav') || e.target.closest('a'))) document.body.classList.remove('nav-open'); });

// ---------- theme
const THEMES = ['auto', 'light', 'dark'], TICON = { auto: 'brightness_auto', light: 'light_mode', dark: 'dark_mode' };
export const theme = () => localStorage.getItem('vnk.theme') || 'light';
export function applyTheme() { const t = theme(); if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t); }
export const themeButton = () => `<button class="icon-btn bordered tip-down" data-act="theme" data-tip="Theme: ${theme()}" aria-label="Change theme">${icon(TICON[theme()])}</button>`;
acts.theme = () => { localStorage.setItem('vnk.theme', THEMES[(THEMES.indexOf(theme()) + 1) % 3]); applyTheme(); rerender(); };
export const userButton = () => { const me = S.boot.me; return `<button class="user-btn" data-act="user-menu"><span class="avatar">${esc(initials(me.name))}</span><span><b>${esc(me.name)}</b><span>${ROLE[me.role]}</span></span></button>`; };
export const ROLE = { owner: 'Tenant owner', admin: 'Admin', user: 'App user' };
acts['user-menu'] = el => menu(el, [{ heading: S.boot.me.email || S.boot.me.name }, { label: 'Switch account', icon: 'swap_horiz', run: signOut }]);

// ---------- "who can use this" picker. The page owns the draft object; the picker edits it in place.
export const accessDrafts = {}, accessChanged = {};
export function accessPicker(key, everyone = 'Everyone') {
  const a = accessDrafts[key], B = S.boot, people = B.users.filter(u => u.role === 'user'); a.deny = a.deny || [];
  const block = !people.length ? '' : `<details class="adv" ${a.deny.length ? 'open' : ''}><summary class="small">Block someone ${a.deny.length ? `<span class="mono">${a.deny.length}</span>` : ''}</summary><div class="row wrap" style="gap:6px;margin-top:8px">${people.map(u => `<button class="tag ${a.deny.includes(u.id) ? 'on bad' : ''}" data-act="acc-deny" data-key="${key}" data-v="${u.id}">${esc(u.name)}</button>`).join('')}</div><p class="small faint" style="margin-top:8px">A blocked person is kept out even if their team is allowed.</p></details>`;
  const tags = a.mode !== 'restricted' ? '' : `
    ${B.teams.length ? `<div><div class="small faint" style="margin-bottom:6px">Teams</div><div class="row wrap" style="gap:6px">${B.teams.map(t => `<button class="tag ${a.teams.includes(t) ? 'on' : ''}" data-act="acc-team" data-key="${key}" data-v="${esc(t)}">${esc(t)}</button>`).join('')}</div></div>` : ''}
    <div><div class="small faint" style="margin-bottom:6px">People</div>${people.length ? `<div class="row wrap" style="gap:6px">${people.map(u => `<button class="tag ${a.users.includes(u.id) ? 'on' : ''}" data-act="acc-user" data-key="${key}" data-v="${u.id}">${esc(u.name)}</button>`).join('')}</div>` : `<span class="small muted">No app users yet. <a class="link" href="#/os/people">Invite someone</a></span>`}</div>
    <p class="small faint">Owners and admins always have access.</p>`;
  return `<div id="acc-${key}" class="stack" style="gap:12px"><div><div class="seg"><button class="${a.mode === 'everyone' ? 'on' : ''}" data-act="acc-mode" data-key="${key}" data-v="everyone">${esc(everyone)}</button><button class="${a.mode === 'restricted' ? 'on' : ''}" data-act="acc-mode" data-key="${key}" data-v="restricted">Chosen people</button></div></div>${tags}${block}</div>`;
}
const accRedraw = key => { const el = $('#acc-' + key); if (el) el.outerHTML = accessPicker(key, el.querySelector('.seg button').textContent); if (accessChanged[key]) accessChanged[key](); };
const toggle = (list, v) => { const i = list.indexOf(v); if (i < 0) list.push(v); else list.splice(i, 1); };
acts['acc-mode'] = el => { accessDrafts[el.dataset.key].mode = el.dataset.v; accRedraw(el.dataset.key); };
acts['acc-team'] = el => { toggle(accessDrafts[el.dataset.key].teams, el.dataset.v); accRedraw(el.dataset.key); };
acts['acc-deny'] = el => { toggle(accessDrafts[el.dataset.key].deny, el.dataset.v); accRedraw(el.dataset.key); };
acts['acc-user'] = el => { toggle(accessDrafts[el.dataset.key].users, el.dataset.v); accRedraw(el.dataset.key); };
export const accessLabel = a => !a || a.mode === 'everyone' ? 'Everyone' : (a.teams.length + a.users.length ? [a.teams.length ? a.teams.length + (a.teams.length === 1 ? ' team' : ' teams') : '', a.users.length ? a.users.length + (a.users.length === 1 ? ' person' : ' people') : ''].filter(Boolean).join(', ') : 'Admins only');

// ---------- file text extraction in the browser: PDF (pdf.js), Word (mammoth), Excel (SheetJS), scans and images (Tesseract OCR), the rest as text
const loadScript = src => new Promise((ok, no) => { if ($(`script[src="${src}"]`)) return ok(); const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => no(new Error('Could not load the file reader. Check your connection.')); document.head.appendChild(s); });
const CDN = 'https://cdnjs.cloudflare.com/ajax/libs/';
const IMG = ['png', 'jpg', 'jpeg', 'webp', 'bmp'];
async function ocr(image, say, label) {
  await loadScript(CDN + 'tesseract.js/5.1.0/tesseract.min.js');
  say(`Reading text from ${label}…`);
  return (await window.Tesseract.recognize(image, 'eng')).data.text || '';
}
export async function extractFile(file, say = () => {}) {
  const ext = (file.name.split('.').pop() || '').toLowerCase(), base = { name: file.name, size: file.size, type: ext };
  if (ext === 'pdf') {
    await loadScript(CDN + 'pdf.js/3.11.174/pdf.min.js');
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = CDN + 'pdf.js/3.11.174/pdf.worker.min.js';
    const pdf = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise, pages = []; let scanned = 0;
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i), tc = await page.getTextContent(); let t = '', y = null;
      for (const it of tc.items) { if (y !== null && Math.abs(it.transform[5] - y) > 14) t += '\n\n'; else if (y !== null && it.transform[5] !== y) t += '\n'; t += it.str + (it.hasEOL ? '' : ' '); y = it.transform[5]; }
      if (t.trim().length < 20 && scanned < 15) { // a scanned page: draw it and read it
        const vp = page.getViewport({ scale: 2 }), cv = document.createElement('canvas'); cv.width = vp.width; cv.height = vp.height;
        await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
        t = await ocr(cv, say, `page ${i} of ${pdf.numPages} in ${file.name}`); scanned++;
      }
      pages.push(t);
    }
    return { ...base, pages, paged: true, ocr: scanned > 0 };
  }
  if (IMG.includes(ext)) return { ...base, pages: [await ocr(file, say, file.name)], paged: false, ocr: true };
  if (ext === 'docx') {
    await loadScript(CDN + 'mammoth/1.6.0/mammoth.browser.min.js');
    return { ...base, pages: [(await window.mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value], paged: false };
  }
  if (ext === 'xlsx' || ext === 'xls') {
    await loadScript(CDN + 'xlsx/0.18.5/xlsx.full.min.js');
    const wb = window.XLSX.read(await file.arrayBuffer(), { type: 'array' });
    return { ...base, pages: wb.SheetNames.map(n => (wb.SheetNames.length > 1 ? `Sheet: ${n}\n` : '') + window.XLSX.utils.sheet_to_csv(wb.Sheets[n], { blankrows: false })), paged: false };
  }
  if (AUDIO.includes(ext)) return { ...base, pages: [], paged: false, audio: true };
  if (!['txt', 'md', 'csv', 'html', 'htm', 'json', 'log', 'tsv', ...CODE].includes(ext)) throw new Error(`"${file.name}" is not a supported type. Use PDF, Word, Excel, text, code, CSV, HTML, an image of a scan or a recording.`);
  let text = await file.text();
  if (ext === 'html' || ext === 'htm') { const d = new DOMParser().parseFromString(text, 'text/html'); d.querySelectorAll('script,style').forEach(x => x.remove()); text = d.body.innerText || d.body.textContent || ''; }
  return { ...base, pages: [text], paged: false };
}
const AUDIO = ['mp3', 'wav', 'm4a', 'ogg', 'aac', 'flac', 'webm'], CODE = ['sql', 'py', 'js', 'ts', 'java', 'go', 'rs', 'c', 'cpp', 'cs', 'sh', 'yaml', 'yml', 'xml', 'toml', 'ini', 'css'];
export const FILE_ACCEPT = '.pdf,.docx,.xlsx,.xls,.txt,.md,.csv,.html,.htm,.json,.log,.tsv,.png,.jpg,.jpeg,.webp,.bmp,' + [...AUDIO, ...CODE].map(x => '.' + x).join(',');
export function pickFiles(multiple = true) {
  return new Promise(ok => { const i = document.createElement('input'); i.type = 'file'; i.multiple = multiple; i.accept = FILE_ACCEPT; i.onchange = () => ok([...i.files]); i.click(); });
}
export function downloadText(name, text, type = 'text/plain') { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); URL.revokeObjectURL(a.href); }
// Alt+T cycles the theme everywhere.
document.addEventListener('keydown', e => { if (e.altKey && e.key.toLowerCase() === 't' && S.boot) { e.preventDefault(); acts.theme(); } });
