// Router and sign-in. Routes: #/os/... is the Vanik OS console, #/gpt/... is the VanikGPT app.
import { S, $, esc, chip, initials, LOGO, api, load, setRenderer, acts, applyTheme, ROLE, toast } from './core.js';
import { osPage, osRouteChanged } from './os.js';
import { gptPage, gptAfterRender, gptRouteChanged } from './gpt.js';
import { platformPage, platformRouteChanged } from './platform.js';
import { flowsPage, flowsRouteChanged } from './flows.js';
import { tasksPage, workOsPage, workRouteChanged } from './work.js';
import { libraryPage, moreRouteChanged } from './more.js';
import { edgeOsPage, edgeDecorate, apiPage, edgeRouteChanged } from './edge.js';
import { routinesPage, settingsSimple, adminSimple, simpleRouteChanged } from './simple.js';
import { workspacePage, notesPage, automationsPage, calendarPage, playgroundPage, adminPage, settingsPage, parityRouteChanged, applyFlags } from './parity.js';

let accounts = null, lastHash = '', busy = false, again = false;
const home = () => (S.boot.admin ? '#/os/home' : '#/gpt');

function signinPage() {
  return `<div class="center-page"><div class="card"><div class="brand" style="padding:0 0 18px">${LOGO}<span>VANIK <em>OS</em></span></div>
    <h2>Sign in</h2><p class="muted" style="margin:6px 0 18px">Pick an account. On your appliance this is your company single sign-on.</p>
    <div class="stack" style="gap:8px">${accounts.map(a => `<button class="acct" data-act="signin" data-id="${a.id}"><span class="avatar">${esc(initials(a.name))}</span><span class="grow"><b>${esc(a.name)}</b><br><span class="small muted">${esc(a.email)}</span></span>${a.status === 'invited' ? chip('Invited', 'warn') : ''}${chip(ROLE[a.role], 'line', false)}</button>`).join('')}</div></div></div>`;
}
acts.signin = async el => {
  await api('POST', '/api/signin', { userId: el.dataset.id });
  S.userId = el.dataset.id; localStorage.setItem('vnk.user', S.userId); accounts = null;
  await load(); location.hash = home();
};

async function render() {
  if (busy) { again = true; return; }
  busy = true;
  try {
    const root = $('#root'), hash = location.hash || '';
    if (!S.userId) { if (!accounts) accounts = await api('GET', '/api/accounts'); root.innerHTML = signinPage(); return; }
    if (!S.boot) await load();
    const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
    let html = null;
    if (parts[0] === 'os') { html = edgeOsPage(parts.slice(1)); if (html === undefined) html = platformPage(parts.slice(1)); if (html === undefined) html = workOsPage(parts.slice(1)); if (html === undefined) html = osPage(parts.slice(1)); }
    else if (parts[0] === 'gpt') html = parts[1] === 'flows' && S.boot.canUseGpt ? flowsPage(parts.slice(2)) : parts[1] === 'tasks' && S.boot.canUseGpt ? tasksPage() : (parts[1] === 'library' || parts[1] === 'saved') && S.boot.canUseGpt ? libraryPage(parts[2]) : (parts[1] === 'routines' || parts[1] === 'automations') && S.boot.canUseGpt ? routinesPage() : parts[1] === 'notes' && S.boot.canUseGpt ? libraryPage('notes') : parts[1] === 'settings' && parts[2] === 'api' && S.boot.canUseGpt ? apiPage() : parts[1] === 'settings' && parts[2] !== 'all' && S.boot.canUseGpt ? settingsSimple() : parts[1] === 'admin' && parts[2] !== 'all' && S.boot.canUseGpt ? adminSimple() : S.boot.canUseGpt && { workspace: () => workspacePage(parts.slice(2)), notes: notesPage, automations: automationsPage, calendar: calendarPage, playground: () => playgroundPage(parts[2]), admin: () => adminPage(parts.slice(2)), settings: () => settingsPage(parts[2]) }[parts[1]] ? { workspace: () => workspacePage(parts.slice(2)), notes: notesPage, automations: automationsPage, calendar: calendarPage, playground: () => playgroundPage(parts[2]), admin: () => adminPage(parts.slice(3)), settings: () => settingsPage(parts[3]) }[parts[1]]() : gptPage(parts.slice(1));
    if (parts[0] === 'os') html = edgeDecorate(parts.slice(1), html);
    if (html === null) { location.replace(parts[0] === 'os' && !S.boot.admin ? '#/gpt' : home()); return; }
    const sc = $('#scroll'), keep = hash === lastHash && sc ? sc.scrollTop : 0;
    const moved = hash !== lastHash;
    root.innerHTML = html; lastHash = hash;
    root.classList.remove('fresh'); if (moved) { void root.offsetWidth; root.classList.add('fresh'); } // entry motion only when the page changes, not on every redraw
    const ns = $('#scroll'); if (ns && keep) ns.scrollTop = keep;
    gptAfterRender(); applyFlags();
  } catch (e) { if (S.userId) toast(e.message, 'err'); }
  finally { busy = false; if (again) { again = false; render(); } }
}
setRenderer(render);
addEventListener('hashchange', () => { accounts = S.userId ? accounts : null; osRouteChanged(); gptRouteChanged(); platformRouteChanged(); flowsRouteChanged(); workRouteChanged(); moreRouteChanged(); parityRouteChanged(); simpleRouteChanged(); edgeRouteChanged(); render();
  // keep shared state fresh as people move between pages
  if (S.userId && S.boot) { const was = JSON.stringify(S.boot); load().then(() => { if (JSON.stringify(S.boot) !== was && !document.querySelector('.overlay')) render(); }).catch(() => {}); }
});
applyTheme();
render();
