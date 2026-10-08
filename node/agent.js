'use strict';
// Agent layer: plugins (tools) a chat can use, a sandboxed browser driven over the Chrome DevTools Protocol,
// ready-made agents, assisted agent drafting, and an AG-UI event stream. Loaded by server.js.
const fs = require('fs'), os = require('os'), path = require('path'), { spawn } = require('child_process');

const PLUGINS = [
  { id: 'calculator', name: 'Calculator', icon: 'calculate', what: 'Exact arithmetic instead of a guess.', slash: 'calc', hint: '/calc 18% of 83000' },
  { id: 'gst', name: 'GST and ID checks', icon: 'verified', what: 'Checks GSTIN, PAN and IFSC formats and works out GST on an amount.', slash: 'gst', hint: '/gst 27AAPFU0939F1ZV' },
  { id: 'tables', name: 'Tables', icon: 'table_chart', what: 'Totals, averages, counts and top rows from a CSV or Excel file attached to the chat.', slash: 'table', hint: '/table total of Amount' },
  { id: 'browser', name: 'Browser', icon: 'public', what: 'Opens allowed sites in a sandboxed browser, reads them and clicks through steps. Asks before it submits anything.', slash: 'browse', hint: '/browse https://intranet/prices find the M12 bolt rate' },
  { id: 'screen', name: 'Computer', icon: 'mouse', what: 'Works a screen by pointer and keyboard, from screenshots. In this build the screen is the sandboxed browser window.', slash: 'screen', hint: '/screen open https://intranet then click at 300,220' },
];
const TEMPLATES = [
  { key: 'policy', name: 'Policy helper', icon: 'policy', description: 'Answers questions from your policy documents, with the clause it used.', instructions: 'You help employees with company policy questions. Answer only from the policy documents and cite them. If the policy does not cover the question, say so and suggest who to ask.', starters: ['How many days of leave do I get?', 'What is the rule for travel bookings?'], tools: [], effort: 'balanced' },
  { key: 'summary', name: 'Document summariser', icon: 'summarize', description: 'Turns an attached file into a short summary with page references.', instructions: 'Summarise the attached document in at most seven bullets. Keep numbers, dates and names exact. Cite the page for each bullet. End with open questions the document does not answer.', starters: ['Summarise the attached file', 'List every date and deadline in this file'], tools: [], effort: 'thorough' },
  { key: 'contract', name: 'Contract reviewer', icon: 'gavel', description: 'Finds obligations, dates, penalties and exit terms in a contract.', instructions: 'You review commercial contracts. From the attached contract list: parties, term and renewal, payment terms, penalties, liability cap, termination rights, and anything unusual. Quote the clause for each point. Do not give legal advice; flag points for a lawyer.', starters: ['What are the termination rights?', 'List every penalty and its trigger'], tools: [], effort: 'thorough' },
  { key: 'invoice', name: 'Invoice checker', icon: 'receipt_long', description: 'Checks an invoice against its purchase order and goods receipt.', instructions: 'You help accounts payable. For a three-document check, send the person to the Three-way match workflow. For questions about a single invoice, check arithmetic with the calculator and the GSTIN with the GST check.', starters: ['Check this GSTIN: ', 'What is 18% GST on 83000?'], tools: ['calculator', 'gst'], effort: 'balanced', workflow: 'three_way' },
  { key: 'vendor', name: 'Vendor onboarding checker', icon: 'verified_user', description: 'Checks a vendor pack: PAN, GSTIN, bank and identity details.', instructions: 'You help onboard vendors. For a full pack, send the person to the Vendor KYC check workflow. For single IDs, use the GST and ID checks and explain any failure in plain words.', starters: ['Is this PAN well formed: ', 'Check this IFSC: '], tools: ['gst'], effort: 'balanced', workflow: 'kyc' },
  { key: 'quotes', name: 'Quote comparer', icon: 'compare_arrows', description: 'Lines up supplier quotes and points to the best complete one.', instructions: 'You help buyers compare quotes. For files, send the person to the Quote comparison workflow. For quick sums use the calculator. Never recommend a supplier that did not quote every item without saying so.', starters: ['What is the difference between 62500 and 59500 in percent?'], tools: ['calculator'], effort: 'balanced', workflow: 'quotes' },
  { key: 'research', name: 'Web researcher', icon: 'travel_explore', description: 'Opens allowed sites, reads them and reports what it found with the page it came from.', instructions: 'You research on the web using the browser. Open only the sites you are asked to. Report what the page says, with its address. If a page needs sign in or a human check, stop and say so.', starters: ['Open https:// and summarise the page', 'Find the price table on https://'], tools: ['browser'], effort: 'balanced' },
  { key: 'portal', name: 'Portal operator', icon: 'mouse', description: 'Clicks through a web portal step by step and asks before it submits.', instructions: 'You operate web portals for the person. Follow their steps exactly. Before any click that submits, pays, sends or deletes, stop and ask. Never type a password.', starters: ['Open https:// then click "Reports" then read the table'], tools: ['browser', 'screen'], effort: 'balanced' },
  { key: 'meeting', name: 'Meeting notes writer', icon: 'groups', description: 'Turns a transcript or rough notes into decisions and actions.', instructions: 'Turn the attached transcript or pasted notes into: decisions made, actions with owner and date, open questions. Use the speakers\' own words for decisions. Do not invent owners or dates.', starters: ['Write the notes for the attached transcript'], tools: [], effort: 'balanced' },
  { key: 'writer', name: 'Message drafter', icon: 'edit_note', description: 'Drafts a clear email or message from a few points.', instructions: 'Draft short, plain business messages. Ask for the reader and the goal if they are missing. Keep to the facts given. Offer one shorter version.', starters: ['Draft a payment reminder for invoice ', 'Reply politely declining the meeting'], tools: [], effort: 'quick' },
  { key: 'tables', name: 'Numbers helper', icon: 'table_chart', description: 'Does the sums on figures you paste or attach, and shows the working.', instructions: 'You work with figures. Use the calculator for every sum and show the working as a small table. Say which rows you used. Never round unless asked.', starters: ['Add 62500, 16000 and 4500 and add 18% GST'], tools: ['calculator', 'gst'], effort: 'balanced' },
];

// ---------- calculator: a small exact parser (no eval)
function calc(src) {
  let s = String(src).toLowerCase().replace(/,/g, '').replace(/₹|rs\.?|inr/g, '').replace(/(\d+(?:\.\d+)?)\s*%\s*of\s*/g, '($1/100)*').replace(/(\d+(?:\.\d+)?)\s*%/g, '($1/100)').replace(/\bx\b|×/g, '*').replace(/÷/g, '/').replace(/\^/g, '**').replace(/\s+/g, '');
  if (!/^[\d.+\-*/()]+$/.test(s) || !/\d/.test(s)) return null;
  let i = 0;
  const peek = () => s[i], eat = c => { if (s[i] === c) { i++; return true; } return false; };
  const num = () => { const m = s.slice(i).match(/^\d+(?:\.\d+)?/); if (!m) throw new Error('bad'); i += m[0].length; return parseFloat(m[0]); };
  const atom = () => { if (eat('(')) { const v = expr(); if (!eat(')')) throw new Error('bad'); return v; } if (eat('-')) return -atom(); if (eat('+')) return atom(); return num(); };
  const pow = () => { const b = atom(); if (s.startsWith('**', i)) { i += 2; return Math.pow(b, pow()); } return b; };
  const term = () => { let v = pow(); for (;;) { if (eat('*')) v *= pow(); else if (eat('/')) v /= pow(); else return v; } };
  const expr = () => { let v = term(); for (;;) { if (eat('+')) v += term(); else if (peek() === '-') { i++; v -= term(); } else return v; } };
  try { const v = expr(); if (i !== s.length || !Number.isFinite(v)) return null; return Math.round(v * 1e6) / 1e6; } catch { return null; }
}
const fmt = n => Number(n).toLocaleString('en-IN', { maximumFractionDigits: 6 });

module.exports = function install(ctx) {
  const { db, on, err, uid, now, audit, save, isAdmin, GW, A, byId, needGpt, verhoeff } = ctx, SAMPLE = require('./sample');
  const C36 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const gstinOk = g => { let s = 0; for (let i = 0; i < 14; i++) { const p = C36.indexOf(g[i]) * (i % 2 ? 2 : 1); s += Math.floor(p / 36) + p % 36; } return C36[(36 - s % 36) % 36] === g[14]; };
  const STATES = { '07': 'Delhi', '09': 'Uttar Pradesh', '27': 'Maharashtra', '29': 'Karnataka', '33': 'Tamil Nadu', '24': 'Gujarat', '19': 'West Bengal', '36': 'Telangana', '06': 'Haryana', '08': 'Rajasthan' };

  function gstTool(text) {
    const out = [], T = text.toUpperCase();
    for (const g of new Set(T.match(/\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/g) || [])) out.push(gstinOk(g) ? `GSTIN ${g}: well formed, check character is right${STATES[g.slice(0, 2)] ? ', state ' + STATES[g.slice(0, 2)] : ''}, PAN inside is ${g.slice(2, 12)}.` : `GSTIN ${g}: the check character is wrong. It should end in ${(() => { let s = 0; for (let i = 0; i < 14; i++) { const p = C36.indexOf(g[i]) * (i % 2 ? 2 : 1); s += Math.floor(p / 36) + p % 36; } return C36[(36 - s % 36) % 36]; })()}.`);
    const rest = T.replace(/\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/g, ' ');
    for (const p of new Set(rest.match(/\b[A-Z]{5}\d{4}[A-Z]\b/g) || [])) out.push(`PAN ${p}: well formed. Holder type: ${{ P: 'person', C: 'company', H: 'Hindu undivided family', F: 'firm', T: 'trust', A: 'association', G: 'government', L: 'local authority', J: 'artificial juridical person', B: 'body of individuals' }[p[3]] || 'unknown'}.`);
    for (const f of new Set(rest.match(/\b[A-Z]{4}0[A-Z0-9]{6}\b/g) || [])) out.push(`IFSC ${f}: well formed. Bank code ${f.slice(0, 4)}, branch code ${f.slice(5)}.`);
    for (const a of new Set((text.match(/\b[2-9]\d{3}[\s-]?\d{4}[\s-]?\d{4}\b/g) || []).map(x => x.replace(/\D/g, '')))) out.push(`Identity number ending ${a.slice(8)}: checksum is ${verhoeff(a) ? 'valid' : 'not valid'}.`);
    const m = text.match(/(\d+(?:\.\d+)?)\s*%\s*(?:gst|igst|tax)?\s*(?:on|of)\s*(?:rs\.?|inr|₹)?\s*([\d,]+(?:\.\d+)?)/i);
    if (m && /gst|tax|igst|cgst/i.test(text)) { const r = +m[1], base = +m[2].replace(/,/g, ''), tax = Math.round(base * r) / 100; out.push(`GST at ${r}% on ${fmt(base)}: tax ${fmt(tax)} (CGST ${fmt(tax / 2)} + SGST ${fmt(tax / 2)} within a state, or IGST ${fmt(tax)} across states). Total ${fmt(base + tax)}.`); }
    if (out.length) out.push('Checked on this appliance from the format and check characters. Nothing was looked up on a government portal.');
    return out;
  }

  // ---------- sandboxed browser over the Chrome DevTools Protocol
  const exe = () => [process.env.VANIK_BROWSER, 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge'].find(p => p && fs.existsSync(p));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  // One browser process for the appliance; each chat gets its own tab.
  class Browser {
    static async launch() {
      const bin = exe(); if (!bin) throw new Error('No browser is installed on this appliance, so the Browser plugin cannot run.');
      const b = new Browser(); b.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vanik-browser-'));
      b.proc = spawn(bin, ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + b.dir, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-gpu', '--window-size=1024,640', 'about:blank'], { stdio: 'ignore' });
      const pf = path.join(b.dir, 'DevToolsActivePort');
      for (let i = 0; i < 200 && !fs.existsSync(pf); i++) await sleep(100);
      if (!fs.existsSync(pf)) { b.close(); throw new Error('The sandboxed browser did not start.'); }
      const [port, wsPath] = fs.readFileSync(pf, 'utf8').trim().split('\n');
      b.ws = new WebSocket(`ws://127.0.0.1:${port}${wsPath}`); b.seq = 0; b.wait = new Map(); b.tabs = new Map();
      await new Promise((ok, no) => { b.ws.onopen = ok; b.ws.onerror = () => no(new Error('The sandboxed browser did not start.')); });
      b.ws.onclose = () => { b.dead = true; };
      b.ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && b.wait.has(m.id)) { const [ok, no] = b.wait.get(m.id); b.wait.delete(m.id); m.error ? no(new Error(m.error.message)) : ok(m.result); } else if (m.method === 'Page.loadEventFired') { const t = b.tabs.get(m.sessionId); if (t && t.loaded) t.loaded(); } };
      return b;
    }
    async newTab() {
      const t = await this.cmd('Target.createTarget', { url: 'about:blank' }, null), sid = (await this.cmd('Target.attachToTarget', { targetId: t.targetId, flatten: true }, null)).sessionId;
      const tab = Object.create(this); tab.root = this; tab.sid = sid; tab.targetId = t.targetId; tab.loaded = null; this.tabs.set(sid, tab);
      await tab.cmd('Page.enable'); await tab.cmd('Runtime.enable');
      await tab.cmd('Emulation.setDeviceMetricsOverride', { width: 1024, height: 640, deviceScaleFactor: 1, mobile: false });
      return tab;
    }
    cmd(method, params = {}, sid = this.sid) { const r = this.root || this, id = ++r.seq; if (r.dead) return Promise.reject(new Error('The sandboxed browser stopped.')); r.ws.send(JSON.stringify({ id, method, params, ...(sid ? { sessionId: sid } : {}) })); return new Promise((ok, no) => { r.wait.set(id, [ok, no]); setTimeout(() => { if (r.wait.delete(id)) no(new Error('The page did not respond.')); }, 20000); }); }
    async settle() { await Promise.race([new Promise(r => { this.loaded = r; }), sleep(6000)]); this.loaded = null; await sleep(250); }
    async goto(url) { const p = this.settle(); const r = await this.cmd('Page.navigate', { url }); if (r.errorText) throw new Error('That address could not be opened (' + r.errorText.replace('net::', '') + ').'); await p; }
    async js(expression) { const r = await this.cmd('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error('The page refused that step.'); return r.result.value; }
    // What a person would see: address, title, text, the things that can be clicked or typed into, and tables.
    snapshot() {
      return this.js(`(() => { const vis = e => { const r = e.getBoundingClientRect(), s = getComputedStyle(e); return r.width > 2 && r.height > 2 && s.visibility !== 'hidden' && s.display !== 'none'; };
        const lab = e => (e.getAttribute('aria-label') || e.innerText || e.value || e.placeholder || e.name || e.title || (e.labels && e.labels[0] && e.labels[0].innerText) || '').replace(/\\s+/g, ' ').trim().slice(0, 80);
        window.__vnk = [...document.querySelectorAll('a[href],button,input,select,textarea,[role=button],[role=link],[onclick]')].filter(vis).slice(0, 80);
        return { url: location.href, title: document.title, text: (document.body ? document.body.innerText : '').replace(/\\n{3,}/g, '\\n\\n').slice(0, 12000),
          elements: window.__vnk.map((e, i) => { const r = e.getBoundingClientRect(); return { i, tag: e.tagName.toLowerCase(), type: e.type || '', label: lab(e), href: e.href || '', x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), submit: e.type === 'submit' || (e.tagName === 'BUTTON' && !!e.form && e.type !== 'button') }; }),
          tables: [...document.querySelectorAll('table')].slice(0, 4).map(t => [...t.rows].slice(0, 40).map(r => [...r.cells].map(c => c.innerText.trim()))),
          password: !!document.querySelector('input[type=password]'), otp: !!document.querySelector('input[autocomplete=one-time-code]') || /verification code|one.time (code|password)|enter the code/i.test(document.body ? document.body.innerText.slice(0, 4000) : ''), captcha: !!document.querySelector('iframe[src*=captcha],[class*=captcha],[id*=captcha]') || /verify you are (a )?human|i.m not a robot/i.test(document.body ? document.body.innerText : '') }; })()`);
    }
    async click(i) { const p = this.settle(); await this.js(`(() => { const e = window.__vnk[${+i}]; e.scrollIntoView({ block: 'center' }); e.click(); })()`); await Promise.race([p, sleep(1200)]); }
    async type(i, text) { await this.js(`(() => { const e = window.__vnk[${+i}]; e.scrollIntoView({ block: 'center' }); e.focus(); if ('value' in e) e.value = ''; })()`); await this.cmd('Input.insertText', { text }); await this.js(`(() => { const e = window.__vnk[${+i}]; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); })()`); }
    async key(key) { const code = { enter: ['Enter', 13], tab: ['Tab', 9], escape: ['Escape', 27] }[key] || ['Enter', 13]; const p = this.settle(); for (const type of ['keyDown', 'keyUp']) await this.cmd('Input.dispatchKeyEvent', { type, key: code[0], code: code[0], windowsVirtualKeyCode: code[1], ...(type === 'keyDown' && code[0] === 'Enter' ? { text: '\r' } : {}) }); await Promise.race([p, sleep(1200)]); }
    async clickAt(x, y) { const p = this.settle(); await this.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }); for (const type of ['mousePressed', 'mouseReleased']) await this.cmd('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }); await Promise.race([p, sleep(1200)]); }
    async typeRaw(text) { await this.cmd('Input.insertText', { text }); }
    async scroll(dy) { await this.js(`window.scrollBy(0, ${+dy})`); await sleep(200); }
    async shot() { return 'data:image/jpeg;base64,' + (await this.cmd('Page.captureScreenshot', { format: 'jpeg', quality: 45 })).data; }
    closeTab() { const r = this.root; r.tabs.delete(this.sid); r.cmd('Target.closeTarget', { targetId: this.targetId }, null).catch(() => {}); }
    close() { this.dead = true; try { this.ws && this.ws.close(); } catch { /* gone */ } try { this.proc && this.proc.kill(); } catch { /* gone */ } setTimeout(() => { try { fs.rmSync(this.dir, { recursive: true, force: true }); } catch { /* in use */ } }, 1500).unref(); }
  }
  const sessions = new Map(); let shared = null, idleT = null;
  async function session(chatId, sim) {
    let s = sessions.get(chatId);
    if (!s && sim) { s = { b: new SAMPLE.SimTab() }; sessions.set(chatId, s); } // the sample portal is drawn, so it needs no browser
    if (!s) {
      clearTimeout(idleT);
      if (!shared || shared.dead) { try { shared = await Browser.launch(); } catch (e) { if (/No browser/.test(e.message)) throw e; shared = await Browser.launch(); } }
      s = { b: await shared.newTab() }; sessions.set(chatId, s);
    }
    clearTimeout(s.t); s.t = setTimeout(() => endSession(chatId), 180000); s.t.unref(); return s.b;
  }
  function endSession(chatId) {
    const s = sessions.get(chatId); if (!s) return;
    clearTimeout(s.t); s.b.closeTab(); sessions.delete(chatId);
    if (!sessions.size) { clearTimeout(idleT); idleT = setTimeout(() => { if (!sessions.size && shared) { shared.close(); shared = null; } }, 60000); idleT.unref(); }
  }
  process.on('exit', () => { if (shared) shared.close(); });

  const hostOf = u => { try { return new URL(u).hostname.toLowerCase(); } catch { return ''; } };
  const siteAllowed = host => { const t = db.app.config.tools; return t.browserMode === 'any' || (t.sites || []).some(s => host === s || host.endsWith('.' + s)); };
  const RISKY = /\b(submit|pay|buy|order|purchase|send|delete|remove|confirm|approve|sign ?in|log ?in|register|place|transfer|checkout)\b/i;

  // Turns plain instructions into browser steps. Works without a model: "open URL then click "X" then type "y" into "Search" then read ...".
  function parseSteps(text, screen) {
    const steps = [];
    for (let part of text.split(/\s+then\s+|\n+|;\s*/i).map(s => s.trim()).filter(Boolean)) {
      let m;
      const url = (part.match(/https?:\/\/[^\s"'<>]+/i) || [])[0];
      if (url && /^(open|go to|goto|visit|browse|navigate to)?\s*https?:\/\//i.test(part)) { steps.push({ do: 'goto', url: url.replace(/[.,)]+$/, '') }); part = part.slice(part.indexOf(url) + url.length).replace(/^\s*(and|,)\s*/i, '').trim(); if (!part) continue; }
      if ((m = part.match(/^click at\s*(\d+)\s*[, ]\s*(\d+)/i))) steps.push({ do: 'clickAt', x: +m[1], y: +m[2] });
      else if ((m = part.match(/^(?:click|press|tap|open)(?: on)?(?: the)?\s+["“']?(.+?)["”']?(?: button| link| tab)?$/i)) && !/^(enter|tab|escape)$/i.test(m[1])) steps.push({ do: 'click', label: m[1] });
      else if ((m = part.match(/^(?:type|enter|fill|write)\s+["“'](.+?)["”']\s+(?:in|into|in the|into the)\s+["“']?(.+?)["”']?(?: box| field)?$/i))) steps.push({ do: 'type', text: m[1], label: m[2] });
      else if ((m = part.match(/^(?:type|write)\s+["“'](.+?)["”']$/i))) steps.push({ do: 'typeRaw', text: m[1] });
      else if ((m = part.match(/^press (enter|tab|escape)$/i))) steps.push({ do: 'key', key: m[1].toLowerCase() });
      else if ((m = part.match(/^scroll (down|up)/i))) steps.push({ do: 'scroll', dy: m[1].toLowerCase() === 'down' ? 500 : -500 });
      else if (/^(take a )?screenshot$/i.test(part)) steps.push({ do: 'shot' });
      else steps.push({ do: 'read', question: part });
    }
    if (steps.length && !steps.some(s => s.do === 'read') && !screen) steps.push({ do: 'read', question: '' });
    return steps;
  }
  const describe = s => ({ goto: `Open ${s.url}`, click: `Click "${s.label}"`, clickAt: `Click at ${s.x}, ${s.y}`, type: `Type into "${s.label}"`, typeRaw: 'Type text', key: `Press ${s.key}`, scroll: s.dy > 0 ? 'Scroll down' : 'Scroll up', shot: 'Take a screenshot', read: s.question ? `Read the page for: ${s.question}` : 'Read the page' }[s.do]);
  const findEl = (snap, label, kinds) => { const L = label.toLowerCase(), c = snap.elements.filter(e => !kinds || kinds.includes(e.tag)); return c.find(e => e.label.toLowerCase() === L) || c.find(e => e.label.toLowerCase().includes(L)) || null; };

  // Sites that ask for a sign-in. The agent never types a password and never sees one.
  //  - Company SSO saved for the site: the appliance presses the SSO button; the browser profile holds the company session.
  //  - Account saved for the site: the appliance fills it from its vault, outside the model. (This build keeps no passwords, so that works on the sample portal only.)
  //  - A one-time code: the run stops and asks the person for it.
  //  - Anything else, and every human check: the run stops and a person signs in.
  const SSO = /(continue|sign in|log in|login) with|single sign|\bsso\b/i;
  const isLogin = snap => !!(snap.password || snap.otp || snap.elements.some(e => SSO.test(e.label) && /sign.?in|log.?in|auth|sso/i.test(snap.url + ' ' + snap.title)));
  async function passWall(b, snap, opts, note) {
    const host = hostOf(snap.url), saved = (db.app.config.tools.signins || []).find(x => host === x.host || host.endsWith('.' + x.host)), si = opts.signin || {};
    const ask = (kind, reason, detail) => ({ interrupt: { id: uid('int'), kind, reason, detail } });
    const code = async () => {
      if (si.kind !== 'otp' || !si.code) return ask('otp', `Enter the one-time code for ${host}`, 'The site sent a code to the account holder. Type it here and the run carries on. The code is used once and not kept.');
      let okay; if (b.sim) okay = await b.enterOtp(si.code); else { const e = snap.elements.find(x => x.tag === 'input' && x.type !== 'password' && x.type !== 'hidden'); if (!e) return { stopped: 'There is no box for the code on this page.' }; await b.type(e.i, si.code); await b.key('enter'); okay = !(await b.snapshot()).otp; }
      si.code = '';
      if (!okay) return ask('otp', `That code was not accepted by ${host}`, 'Ask for a new code and type it here.');
      await note('Enter the one-time code', 'Accepted'); return {};
    };
    if (si.kind === 'signin') { if (!b.sim) return { stopped: `${host} is still asking for a sign-in. Taking over the browser window is not in this build. Ask an admin to save a sign-in for this site in VanikGPT setup.` }; await b.personSignedIn(); await note('Sign-in', 'Done by you. The agent did not see the password.'); return {}; }
    if (snap.otp && !snap.password) return code();
    const sso = saved && saved.kind === 'sso' && snap.elements.find(e => SSO.test(e.label));
    if (sso) { if (b.sim) b.account = saved.account; await b.click(sso.i); const after = await b.snapshot(); if (after.otp) { snap = after; return code(); } if (!isLogin(after)) { await note('Sign in with company SSO', saved.account ? 'As ' + saved.account : 'Company session used'); return {}; } }
    if (saved && saved.kind === 'vault' && snap.password && b.sim) { await b.vaultSignIn(saved.account); await note('Sign in with the saved account', `${saved.account || 'Saved account'}. Filled by the appliance, not shown to the model.`); snap = await b.snapshot(); if (snap.otp) return code(); if (!isLogin(snap)) return {}; }
    return ask('signin', `Sign in to ${host}`, saved && saved.kind === 'vault' && !b.sim ? 'This build keeps no passwords, so the saved account cannot be used here. Sign in yourself, then carry on.' : 'This site asks for a sign-in. The agent never types a password. Sign in yourself, or ask an admin to save a sign-in for this site.');
  }

  // Runs browser steps. Returns { text, tables, url, interrupt?, stopped? }. Emits one activity row per step with a screenshot.
  async function runBrowser(chat, steps, act, opts = {}) {
    const out = { notes: [], tables: [], url: '' };
    const first = steps.find(s => s.do === 'goto');
    let b; try { b = await session(chat.id, !!first && hostOf(first.url) === SAMPLE.HOST); } catch (e) { return { ...out, stopped: `No browser could be started here (${e.message.replace(/\.$/, '')}). The sample supplier portal still works: /browse https://${SAMPLE.HOST}/prices` }; }
    for (let n = 0; n < steps.length; n++) {
      const s = steps[n], id = uid('act'), row = { id, kind: 'tool', tool: opts.screen ? 'screen' : 'browser', label: describe(s), state: 'running' };
      act(row);
      const fail = why => { act({ ...row, state: 'failed', result: why }); return { ...out, stopped: why }; };
      try {
        if (s.do === 'goto') {
          const h = hostOf(s.url); if (!h) return fail('That is not a full web address.');
          if (!siteAllowed(h)) return { ...fail(`${h} is not on the list of allowed sites.`), blockedHost: h };
          await b.goto(s.url);
        }
        let snap = await b.snapshot();
        if (s.do !== 'goto' && !snap.url.startsWith('http')) return fail('No page is open yet. Start with an address.');
        if (snap.captcha) return fail('This page asks for a human check. A person has to do that; the agent will not.');
        if (s.do === 'click') {
          const e = findEl(snap, s.label); if (!e) return fail(`Nothing on the page is labelled "${s.label}".`);
          if ((RISKY.test(e.label) || e.submit) && !(opts.approved && n === 0)) { act({ ...row, state: 'waiting', result: 'Waiting for your go-ahead' }); return { ...out, interrupt: { id: uid('int'), reason: `Click "${e.label}" on ${hostOf(snap.url)}`, detail: 'This looks like a step that submits, sends, pays or signs in.', rest: steps.slice(n), screen: !!opts.screen } }; }
          row.at = [e.x, e.y]; await b.click(e.i);
        } else if (s.do === 'type') {
          const e = findEl(snap, s.label, ['input', 'textarea', 'select']); if (!e) return fail(`There is no box labelled "${s.label}".`);
          if (e.type === 'password') return fail('The agent never types passwords. Sign in yourself, then ask again.');
          row.at = [e.x, e.y]; await b.type(e.i, s.text);
        } else if (s.do === 'typeRaw') { if (snap.password) return fail('The agent never types on a page with a password box.'); await b.typeRaw(s.text); }
        else if (s.do === 'key') await b.key(s.key);
        else if (s.do === 'clickAt') {
          const e = snap.elements.find(x => Math.abs(x.x - s.x) < 40 && Math.abs(x.y - s.y) < 16);
          if (e && (RISKY.test(e.label) || e.submit) && !(opts.approved && n === 0)) { act({ ...row, state: 'waiting', result: 'Waiting for your go-ahead' }); return { ...out, interrupt: { id: uid('int'), reason: `Click "${e.label}" at ${s.x}, ${s.y} on ${hostOf(snap.url)}`, detail: 'This looks like a step that submits, sends, pays or signs in.', rest: steps.slice(n), screen: true } }; }
          row.at = [s.x, s.y]; await b.clickAt(s.x, s.y);
        } else if (s.do === 'scroll') await b.scroll(s.dy);
        snap = await b.snapshot(); out.url = snap.url;
        if (s.do === 'goto' && isLogin(snap) && snap.url.split(/[?#]/)[0] !== s.url.split(/[?#]/)[0]) { // bounced to a sign-in page
          const note = async (label, result) => act({ id: uid('act'), kind: 'tool', tool: row.tool, label, state: 'done', result, url: (await b.snapshot()).url, shot: await b.shot() });
          const w = await passWall(b, snap, opts, note);
          if (w.stopped) return fail(w.stopped);
          if (w.interrupt) { act({ ...row, state: 'waiting', result: 'Waiting for you', url: snap.url, shot: await b.shot() }); return { ...out, interrupt: { ...w.interrupt, rest: steps.slice(n), screen: !!opts.screen } }; }
          opts.signin = null; await b.goto(s.url); snap = await b.snapshot(); out.url = snap.url;
          if (isLogin(snap)) return fail('The site did not accept the sign-in.');
        }
        const h = hostOf(snap.url);
        if (h && !siteAllowed(h)) { await b.goto('about:blank'); return { ...fail(`That step led to ${h}, which is not on the list of allowed sites. The page was closed.`), blockedHost: h }; }
        let result = snap.title || snap.url;
        if (s.do === 'read') {
          const found = ctx.readPage(s.question, snap);
          out.notes.push({ url: snap.url, title: snap.title, text: found.text }); if (snap.tables.length) out.tables = snap.tables;
          result = found.summary;
        }
        act({ ...row, state: 'done', result, url: snap.url, shot: await b.shot() });
      } catch (e) { return fail(e.message); }
    }
    return out;
  }

  // ---------- tables: exact answers over a CSV or Excel file attached to the chat
  const nrm = x => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const toNum = v => { const n = parseFloat(String(v == null ? '' : v).replace(/[,\s₹]|rs\.?|inr/gi, '')); return Number.isFinite(n) ? n : null; };
  function tableTool(q, files) {
    if (!files.length) return { error: 'Attach a CSV or Excel file to this chat first.' };
    const f = files.find(x => nrm(q).includes(nrm(x.name.replace(/\.[^.]+$/, '')))) || files[files.length - 1];
    const rows = f.table.split(/\r?\n/).filter(l => l.trim() && !/^Sheet: /.test(l)).map(l => l.split(l.includes('\t') ? '\t' : ',').map(c => c.trim().replace(/^"|"$/g, '')));
    const hi = rows.findIndex(r => r.length >= 2 && r.filter(c => c && toNum(c) === null).length >= Math.min(2, r.length)), head = rows[hi], data = rows.slice(hi + 1).filter(r => r.length === head.length);
    if (hi < 0 || !data.length) return { error: `No table with a header row was found in ${f.name}.` };
    const Q = nrm(q), col = (after) => { const cands = head.map((h, i) => ({ i, h, n: nrm(h) })).filter(c => c.n && Q.includes(c.n)); if (!cands.length) return null; if (after) { const pos = Q.indexOf(after); const later = cands.filter(c => Q.indexOf(c.n, pos) >= pos); if (later.length) return later.sort((a, b) => Q.indexOf(a.n, pos) - Q.indexOf(b.n, pos))[0]; } return cands.sort((a, b) => b.n.length - a.n.length)[0]; };
    const src = `From ${f.name}, ${data.length} rows.`, tbl = (h, rs) => '| ' + h.join(' | ') + ' |\n|' + h.map(() => '---').join('|') + '|\n' + rs.map(r => '| ' + r.join(' | ') + ' |').join('\n');
    let m; const numeric = () => head.filter((h, i) => h && data.some(r => toNum(r[i]) !== null)).slice(0, 3);
    if (/\bcolumns?\b|\bheaders?\b/.test(Q) && !/sum|total|average|count/.test(Q)) return { text: `Columns: ${head.join(', ')}.\n\n${src}` };
    if ((m = Q.match(/\btop (\d+)\b/)) || /\b(highest|largest|biggest|lowest|smallest)\b/.test(Q)) {
      const c = col('by') || col(); if (!c) return { error: `Say which column, for example: top 3 by ${head[head.length - 1]}.`, ask: { question: `Which column of ${f.name} should I rank by?`, options: numeric().map(h => ({ label: h, send: `/table ${m ? 'top ' + m[1] : /lowest|smallest/.test(Q) ? 'lowest' : 'highest'} by ${h}` })) } };
      const low = /\b(lowest|smallest)\b/.test(Q), n = m ? +m[1] : 1, sorted = data.filter(r => toNum(r[c.i]) !== null).sort((a, b) => (toNum(b[c.i]) - toNum(a[c.i])) * (low ? -1 : 1)).slice(0, n);
      return { text: `${low ? 'Lowest' : 'Top'} ${sorted.length} by ${c.h}:\n\n${tbl(head, sorted)}\n\n${src}` };
    }
    if (/\b(group|per|by|for each)\b/.test(Q) &&/\b(sum|total|count|average)\b/.test(Q)) {
      const g = col('by') || col('per') || col('each'), v = head.map((h, i) => ({ i, h, n: nrm(h) })).filter(c => Q.includes(c.n) && (!g || c.i !== g.i) && data.some(r => toNum(r[c.i]) !== null))[0];
      if (g) { const acc = new Map(); data.forEach(r => { const k = r[g.i] || '(blank)', a = acc.get(k) || { n: 0, s: 0 }; a.n++; a.s += v ? toNum(r[v.i]) || 0 : 0; acc.set(k, a); }); return { text: tbl([g.h, v ? 'Total ' + v.h : 'Rows'], [...acc].map(([k, a]) => [k, v ? fmt(a.s) : a.n])) + `\n\n${src}` }; }
    }
    if (/\b(count|how many)\b/.test(Q)) {
      const w = q.match(/where\s+(.+?)\s*(?:is|=|equals|contains)\s*["']?([^"'?]+?)["']?\??$/i), c = w ? head.findIndex(h => nrm(h) === nrm(w[1])) : -1;
      const n = c >= 0 ? data.filter(r => nrm(r[c]).includes(nrm(w[2]))).length : data.length;
      return { text: `${c >= 0 ? `Rows where ${head[c]} contains "${w[2].trim()}"` : 'Rows'}: **${n}**\n\n${src}` };
    }
    const op = /\b(average|mean)\b/.test(Q) ? 'avg' : /\b(sum|total|add up)\b/.test(Q) ? 'sum' : /\b(min|minimum)\b/.test(Q) ? 'min' : /\b(max|maximum)\b/.test(Q) ? 'max' : null;
    if (op) {
      const c = col('of') || col(); if (!c) return { error: `Say which column. This file has: ${head.join(', ')}.`, ask: { question: `Which column of ${f.name}?`, options: numeric().map(h => ({ label: h, send: `/table ${{ sum: 'total', avg: 'average', min: 'minimum', max: 'maximum' }[op]} of ${h}` })) } };
      const nums = data.map(r => toNum(r[c.i])).filter(x => x !== null); if (!nums.length) return { error: `${c.h} has no numbers.` };
      const v = op === 'sum' ? nums.reduce((a, b) => a + b, 0) : op === 'avg' ? nums.reduce((a, b) => a + b, 0) / nums.length : op === 'min' ? Math.min(...nums) : Math.max(...nums);
      return { text: `${{ sum: 'Total', avg: 'Average', min: 'Lowest', max: 'Highest' }[op]} of ${c.h}: **${fmt(Math.round(v * 100) / 100)}** (${nums.length} values)\n\n${src}` };
    }
    return { text: tbl(head, data.slice(0, 10)) + `\n\nFirst ${Math.min(10, data.length)} of ${data.length} rows of ${f.name}. Ask for a total, average, count, top rows or a group, naming the column.` };
  }

  // ---------- tool connectors: any server that speaks the Model Context Protocol over HTTP
  async function mcpCall(srv, method, params, notify) {
    if (srv.url.startsWith('sample://')) return notify ? null : SAMPLE.mcp(method, params);
    const r = await fetch(srv.url, { method: 'POST', signal: AbortSignal.timeout(20000), headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(srv.token ? { Authorization: 'Bearer ' + srv.token } : {}), ...(srv.sessionId ? { 'Mcp-Session-Id': srv.sessionId } : {}) }, body: JSON.stringify({ jsonrpc: '2.0', ...(notify ? {} : { id: Date.now() }), method, params }) });
    const sid = r.headers.get('mcp-session-id'); if (sid) srv.sessionId = sid;
    if (notify) return null;
    if (!r.ok) throw new Error('The connector answered ' + r.status + '.');
    const t = await r.text(), j = JSON.parse(/^\s*\{/.test(t) ? t : (t.split('\n').filter(l => l.startsWith('data:')).pop() || '{}').slice(5));
    if (j.error) throw new Error(j.error.message || 'The connector refused.');
    return j.result;
  }
  async function mcpConnect(srv) {
    srv.sessionId = null;
    const init = await mcpCall(srv, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'VanikGPT', version: '1.0' } });
    await mcpCall(srv, 'notifications/initialized', {}, true).catch(() => {});
    const list = await mcpCall(srv, 'tools/list', {}), old = srv.tools || [];
    srv.serverName = (init.serverInfo && init.serverInfo.name) || srv.name;
    srv.tools = (list.tools || []).slice(0, 60).map(t => ({ name: t.name, description: String(t.description || '').slice(0, 300), params: Object.keys((t.inputSchema && t.inputSchema.properties) || {}), readOnly: !!(t.annotations && t.annotations.readOnlyHint), ask: (old.find(o => o.name === t.name) || { ask: !(t.annotations && t.annotations.readOnlyHint) }).ask }));
    srv.error = ''; srv.checkedAt = now();
  }
  const mcpView = m => ({ id: m.id, name: m.name, url: m.url, serverName: m.serverName || '', tools: m.tools || [], error: m.error || '', checkedAt: m.checkedAt || null, hasToken: !!m.token });
  on('GET', '/api/mcp', () => db.mcp.map(mcpView), A);
  on('POST', '/api/mcp', async ({ u, body }) => {
    const url = String(body.url || '').trim(), name = String(body.name || '').trim().slice(0, 40);
    if (!name) throw err(400, 'Give the connector a name.');
    if (!/^(https?:\/\/[^\s]+|sample:\/\/erp)$/i.test(url)) throw err(400, 'Enter a full address that starts with http:// or https://.');
    const srv = { id: uid('mcp'), name, url, token: String(body.token || '').trim(), tools: [], createdAt: now(), createdBy: u.name };
    try { await mcpConnect(srv); } catch (e) { throw err(400, 'Could not connect: ' + e.message); }
    db.mcp.push(srv); audit(u, 'Added a tool connector', name, srv.tools.length + ' tools'); return mcpView(srv);
  }, A);
  on('POST', '/api/mcp/:id/refresh', async ({ p }) => { const srv = byId(db.mcp, p.id, 'Connector'); try { await mcpConnect(srv); } catch (e) { srv.error = e.message; srv.checkedAt = now(); } return mcpView(srv); }, A);
  on('PATCH', '/api/mcp/:id/tools/:tool', ({ u, p, body }) => { const srv = byId(db.mcp, p.id, 'Connector'), t = srv.tools.find(x => x.name === p.tool); if (!t) throw err(404, 'Tool not found'); t.ask = !!body.ask; audit(u, t.ask ? 'Set a connector tool to ask first' : 'Let a connector tool run without asking', srv.name + ' / ' + t.name); return mcpView(srv); }, A);
  on('DELETE', '/api/mcp/:id', ({ u, p }) => { const srv = byId(db.mcp, p.id, 'Connector'); db.mcp = db.mcp.filter(x => x.id !== srv.id); audit(u, 'Removed a tool connector', srv.name); return { ok: true }; }, A);
  // "/use tool key=value key2="two words"" or "/use tool {json}"
  function parseUse(text) {
    const m = text.match(/^\/use\s+([\w.-]+)\s*([\s\S]*)$/i); if (!m) return null;
    let args = {}; const rest = m[2].trim();
    if (rest.startsWith('{')) { try { args = JSON.parse(rest); } catch { return { name: m[1], bad: 'The part after the tool name is not valid JSON.' }; } }
    else for (const kv of rest.matchAll(/([\w.-]+)=("([^"]*)"|'([^']*)'|\S+)/g)) { const v = kv[3] ?? kv[4] ?? kv[2]; args[kv[1]] = /^-?\d+(\.\d+)?$/.test(v) ? +v : v === 'true' ? true : v === 'false' ? false : v; }
    return { name: m[1], args };
  }

  // ---------- routing a message to plugins without needing a model
  function route(text, enabled, forced, chatFiles = []) {
    const plan = [], T = text.trim();
    if (/^\/use\b/i.test(T)) { const p = parseUse(T), hit = p && db.mcp.flatMap(m => m.tools.map(t => ({ m, t }))).find(x => x.t.name.toLowerCase() === p.name.toLowerCase()); return [{ tool: 'mcp', parsed: p, hit }]; }
    if (enabled.includes('tables') && (forced === 'tables' || /^\/table\b/i.test(T) || (chatFiles.length && /\b(sum|total|average|mean|count|how many rows|top \d+|highest|lowest|group by|columns)\b/i.test(T)))) return [{ tool: 'tables', q: T.replace(/^\/table\s*/i, '') }];
    if ((forced === 'screen' || /^\/screen\b/i.test(T)) && enabled.includes('screen')) return [{ tool: 'screen', steps: parseSteps(T.replace(/^\/screen\s*/i, ''), true) }];
    if ((forced === 'browser' || /^\/browse\b/i.test(T) || (/https?:\/\//i.test(T) && /\b(open|go to|visit|browse|read|summari[sz]e|find|click|look up|check)\b/i.test(T))) && enabled.includes('browser')) return [{ tool: 'browser', steps: parseSteps(T.replace(/^\/browse\s*/i, '')) }];
    if (enabled.includes('gst') && (forced === 'gst' || /^\/gst\b/i.test(T) || /\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/.test(T) || (/\b(gstin|pan|ifsc)\b/i.test(T) && /\b(check|valid|verify|well formed|correct)\b/i.test(T)) || /\d\s*%\s*(gst|igst|tax)\b/i.test(T))) plan.push({ tool: 'gst', text: T.replace(/^\/gst\s*/i, '') });
    if (enabled.includes('calculator')) {
      const ex = forced === 'calculator' || /^\/calc\b/i.test(T) ? T.replace(/^\/calc\s*/i, '') : (T.match(/(?:what is|what's|calculate|compute|work out|how much is)?\s*((?:[\d(][\d\s.,+\-*/x×÷^()%]*(?:of\s*[\d.,]+)?[\d)%])+)\s*\??$/i) || [])[1];
      if (ex && /[+\-*/x×÷^%]/.test(ex) && calc(ex) !== null && !plan.length) plan.push({ tool: 'calculator', expr: ex.trim() });
    }
    return plan;
  }
  // Called by the chat core. Returns { context, direct, interrupt, stopped, blockedHost }.
  async function runTools(chat, text, enabled, forced, act0, resume, shorten) {
    const res = { context: [], direct: [] };
    const act = row => act0(shorten && row.result ? { ...row, result: shorten(row.result), label: shorten(row.label) } : row);
    const files = ctx.chatTables(chat);
    const plan = resume ? (resume.call ? [{ tool: 'mcp', ...resume.call, approved: true }] : [{ tool: resume.screen ? 'screen' : 'browser', steps: resume.rest, approved: !resume.kind || resume.kind === 'step', signin: resume.kind === 'otp' || resume.kind === 'signin' ? { kind: resume.kind, code: resume.code } : null }]) : route(text, enabled, forced, files);
    for (const p of plan) {
      if (p.tool === 'calculator') { const id = uid('act'), v = calc(p.expr); act({ id, kind: 'tool', tool: 'calculator', label: 'Work out ' + p.expr, state: 'done', result: fmt(v) }); res.context.push(`Calculator: ${p.expr} = ${fmt(v)}`); res.direct.push(`${p.expr.replace(/\*/g, '×')} = **${fmt(v)}**`); }
      if (p.tool === 'gst') { const id = uid('act'), lines = gstTool(p.text); act({ id, kind: 'tool', tool: 'gst', label: 'Check the IDs and GST', state: lines.length ? 'done' : 'failed', result: lines.length ? lines.length - 1 + ' checked' : 'No GSTIN, PAN, IFSC or GST sum found in the message.' }); if (lines.length) { res.context.push('GST and ID checks:\n' + lines.join('\n')); res.direct.push(lines.map(l => '- ' + l).join('\n')); } }
      if (p.tool === 'tables') { const id = uid('act'), r = tableTool(p.q, files); act({ id, kind: 'tool', tool: 'tables', label: 'Read the table', state: r.error ? 'failed' : 'done', result: r.error || 'Worked out from the file' }); if (r.error && r.ask && r.ask.options.length) res.ask = r.ask; else if (r.error) res.stopped = r.error; else { res.context.push('From the attached table:\n' + r.text); res.direct.push(r.text); } }
      if (p.tool === 'mcp') {
        const id = uid('act');
        const hit = p.hit || (p.serverId && (() => { const m = db.mcp.find(x => x.id === p.serverId), t = m && m.tools.find(x => x.name === p.name); return m && t ? { m, t } : null; })());
        const args = p.parsed ? p.parsed.args : p.args, name = p.parsed ? p.parsed.name : p.name;
        if (!hit) { act({ id, kind: 'tool', tool: 'connector', label: 'Use ' + name, state: 'failed', result: 'No connector has a tool with that name.' }); res.stopped = `No connector has a tool called "${name}". Open Connectors in the + menu to see what is available.`; continue; }
        const who = db.users.find(x => x.id === chat.userId);
        if (who && !ctx.allowed(hit.m.access, who)) { act({ id, kind: 'tool', tool: 'connector', label: 'Use ' + name, state: 'failed', result: 'You do not have access to this connector.' }); res.stopped = `You do not have access to ${hit.m.name}. An admin decides who can use it.`; continue; }
        if (p.parsed && p.parsed.bad) { act({ id, kind: 'tool', tool: 'connector', label: 'Use ' + name, state: 'failed', result: p.parsed.bad }); res.stopped = p.parsed.bad; continue; }
        if (Array.isArray(chat.connectors) && !chat.connectors.includes(hit.m.id)) { act({ id, kind: 'tool', tool: 'connector', label: 'Use ' + name, state: 'failed', result: 'That connector is turned off for this chat.' }); res.stopped = 'That connector is turned off for this chat.'; continue; }
        const row = { id, kind: 'tool', tool: 'connector', label: `${hit.m.name}: ${hit.t.name}`, state: 'running' }; act(row);
        if (hit.t.ask && !p.approved) { act({ ...row, state: 'waiting', result: 'Waiting for your go-ahead' }); res.interrupt = { id: uid('int'), reason: `Run "${hit.t.name}" on ${hit.m.name}`, detail: 'With: ' + (JSON.stringify(args).slice(0, 200)), call: { serverId: hit.m.id, name: hit.t.name, args } }; break; }
        try { const r = await mcpCall(hit.m, 'tools/call', { name: hit.t.name, arguments: args || {} }), text = (r.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n').slice(0, 8000) || JSON.stringify(r.structuredContent || r).slice(0, 4000);
          if (r.isError) { act({ ...row, state: 'failed', result: text.slice(0, 200) }); res.stopped = 'The connector reported a problem: ' + text.slice(0, 300); }
          else { act({ ...row, state: 'done', result: text.replace(/\s+/g, ' ').slice(0, 140) }); res.context.push(`Result of ${hit.t.name} from ${hit.m.name}:\n${text}`); res.direct.push(`**${hit.m.name}: ${hit.t.name}**\n\n${text}`); }
        } catch (e) { act({ ...row, state: 'failed', result: e.message }); res.stopped = `${hit.m.name} could not be reached: ${e.message}`; }
      }
      if (p.tool === 'browser' || p.tool === 'screen') {
        const sites = (db.app.config.tools.sites || []).slice(0, 3);
        if (!p.steps.length && sites.length) { res.ask = { question: 'Which site should I open?', options: sites.map(h => ({ label: h, send: `/${p.tool === 'screen' ? 'screen open' : 'browse'} https://${h}` })) }; continue; }
        if (!p.steps.length) { act({ id: uid('act'), kind: 'tool', tool: p.tool, label: 'Browser', state: 'failed', result: 'Give an address to open, for example: /browse https://intranet/prices find the bolt rate' }); continue; }
        if (p.steps.length > ctx.callLimit() + 1) { act({ id: uid('act'), kind: 'tool', tool: p.tool, label: 'Browser', state: 'failed', result: `That is ${p.steps.length} steps. The limit for one message is ${ctx.callLimit()}.` }); res.stopped = `That asks for ${p.steps.length} steps and the limit for one message is ${ctx.callLimit()}. Split it into two messages, or ask an admin to raise the limit.`; continue; }
        const r = await runBrowser(chat, p.steps, act, { screen: p.tool === 'screen', approved: p.approved, signin: p.signin });
        if (r.interrupt) { res.interrupt = r.interrupt; break; }
        if (r.stopped) { res.stopped = r.stopped; res.blockedHost = r.blockedHost; }
        for (const n of r.notes) { res.context.push(`From the web page ${n.url} ("${n.title}"):\n${n.text}`); res.direct.push(`From **${n.title || n.url}** (${n.url}):\n\n${n.text}`); }
        if (r.tables.length && r.notes.length) res.direct.push(r.tables.slice(0, 1).map(t => t.length > 1 ? '| ' + t[0].join(' | ') + ' |\n|' + t[0].map(() => '---').join('|') + '|\n' + t.slice(1, 15).map(row => '| ' + row.join(' | ') + ' |').join('\n') : '').join(''));
        if (!r.notes.length && !r.stopped && r.url) res.direct.push(`Done. The browser is now on ${r.url}.`);
        if (!res.interrupt) endSession(chat.id);
      }
    }
    if (shorten) { res.context = res.context.map(shorten); res.direct = res.direct.map(shorten); }
    return res;
  }

  // ---------- ready-made agents and assisted drafting
  on('GET', '/api/agents/catalog', () => ({ templates: TEMPLATES, plugins: PLUGINS }));
  function draftByRules(d) {
    const t = d.toLowerCase(), has = r => r.test(t);
    const tools = [has(/web|site|portal|browse|online|url|link/) && 'browser', has(/portal|click|form|screen|desktop|fill/) && 'screen', has(/gst|pan|ifsc|invoice|vendor|tax/) && 'gst', has(/sum|total|calculat|percent|price|amount|invoice|number|budget|cost/) && 'calculator'].filter(Boolean);
    const docs = has(/polic|contract|document|manual|sop|report|file|agreement|handbook|knowledge/);
    const core = d.trim().replace(/^(an?|the)\s+(agent|assistant|bot|helper)\s+(that|which|to|for)\s+/i, '').replace(/^help(s)?\s+((the|our|my)\s+)?(\w+\s+)?(team|staff|people|group|me|us)\s+(to\s+)?/i, '').replace(/^(to|that)\s+/i, '');
    const name = (core.split(/[.,;:]| and | from | with | on | for /i)[0].split(/\s+/).slice(0, 3).join(' ') || 'New agent').replace(/^./, c => c.toUpperCase());
    return { name: name.slice(0, 60), description: d.trim().replace(/\s+/g, ' ').slice(0, 140),
      instructions: [`Your job: ${d.trim().replace(/\s+/g, ' ')}`, docs ? 'Answer from the company documents and cite the source for every point. If the documents do not cover it, say so.' : 'Keep to what the person gave you. If something needed is missing, ask one short question.', tools.includes('calculator') ? 'Use the calculator for every sum and show the working.' : '', tools.includes('gst') ? 'Check every GSTIN, PAN and IFSC you are given before relying on it.' : '', tools.includes('browser') ? 'Open only sites the person names. Stop and ask before any step that submits, pays, sends or signs in. Never type a password.' : '', 'Be brief and plain. Give the answer first, then the reasons.'].filter(Boolean).join('\n'),
      starters: [], tools: [...new Set(tools)], effort: has(/review|contract|audit|careful|thorough|detailed|risk/) ? 'thorough' : has(/quick|fast|short/) ? 'quick' : 'balanced', collections: 'all', by: 'rules' };
  }
  on('POST', '/api/agents/draft', async ({ u, body }) => {
    needGpt(u);
    const d = String(body.description || '').trim();
    if (d.length < 10) throw err(400, 'Describe the job in a sentence or two.');
    const base = draftByRules(d), model = db.app.config.defaultModel, serving = db.models.some(m => m.id === model && m.status === 'serving');
    if (GW.url && serving) {
      try {
        let txt = '';
        await ctx.streamModel(model, [{ role: 'system', content: 'You design assistants for office work. Reply with one JSON object only, with keys: name (max 4 words), description (one line), instructions (5 to 8 plain sentences telling the assistant what to do and what not to do), starters (array of up to 3 example questions), tools (array from: calculator, gst, browser, screen), effort (quick, balanced or thorough).' }, { role: 'user', content: d }], t => { txt += t; }, AbortSignal.timeout(45000));
        const j = JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1));
        return { ...base, name: String(j.name || base.name).slice(0, 60), description: String(j.description || base.description).slice(0, 140), instructions: String(j.instructions || base.instructions).slice(0, 6000), starters: (Array.isArray(j.starters) ? j.starters : []).map(String).slice(0, 4), tools: (Array.isArray(j.tools) ? j.tools : base.tools).filter(x => PLUGINS.some(p => p.id === x)), effort: ['quick', 'balanced', 'thorough'].includes(j.effort) ? j.effort : base.effort, by: 'model' };
      } catch { /* fall back to rules */ }
    }
    return base;
  });
  // Agent builder: one description, then a few questions with three choices each, picked from what was understood.
  function interview(d, u) {
    const b = draftByRules(d), t = d.toLowerCase(), has = r => r.test(t), names = b.tools.map(x => PLUGINS.find(p => p.id === x).name);
    const docs = has(/polic|contract|document|manual|sop|report|agreement|handbook|knowledge|rule/), files = has(/file|attach|upload|invoice|quote|transcript|scan|pdf|excel|sheet/), web = b.tools.includes('browser');
    const kn = docs ? 'all' : files ? 'files' : 'none', ac = web ? 'web' : b.tools.length ? 'exact' : 'none';
    const q = (id, text, opts, pick, custom) => ({ id, text, custom, options: opts.map(o => ({ v: o[0], label: o[1], sub: o[2], suggested: o[0] === pick })).sort((x, y) => y.suggested - x.suggested) });
    const questions = [
      q('knowledge', 'Where should it look for answers?', [['all', 'Company knowledge', 'Every collection the person can use'], ['files', 'Only files added to the chat', 'Nothing from the knowledge base'], ['none', 'Nowhere', 'It works from what the person types']], kn, db.collections.length ? 'Or name one collection' : ''),
      q('actions', 'What may it do besides answering?', [['none', 'Just answer', 'No plugins'], ['exact', 'Exact sums, ID checks and tables', 'Calculator, GST checks, Tables'], ['web', 'Also open websites', 'Reads allowed sites and asks before it submits anything']], ac, ''),
      q('style', 'How should it answer?', [['quick', 'Short and direct', 'A few lines'], ['balanced', 'Step by step', 'The answer, then the reasons'], ['thorough', 'Thorough', 'Reads more sources, longer answer']], b.effort, 'Or describe the tone'),
    ];
    const team = [...new Set(db.users.flatMap(x => x.teams || []))][0];
    if (isAdmin(u)) questions.push(q('share', 'Who is it for?', [['me', 'Only me', 'Nobody else sees it'], ['everyone', 'Everyone with VanikGPT', 'Shows under Agents for all'], ...(team ? [['team:' + team, team + ' team', 'Only people in this team']] : [])], 'me', team ? 'Or name another team' : undefined));
    return { name: b.name, understood: [b.description, names.length ? 'Likely needs: ' + names.join(', ') : 'No plugins needed, as far as I can tell', docs ? 'Answers should come from company documents' : files ? 'Works on files the person adds' : 'Works from what the person types'], questions };
  }
  on('POST', '/api/agents/interview', ({ u, body }) => { needGpt(u); const d = String(body.description || '').trim(); if (d.length < 10) throw err(400, 'Say a little more about the job, in a sentence or two.'); return interview(d, u); });
  on('POST', '/api/agents/build', async ({ u, body }) => {
    needGpt(u);
    const d = String(body.description || '').trim(), a = body.answers || {};
    if (d.length < 10) throw err(400, 'Say a little more about the job, in a sentence or two.');
    const b = draftByRules(d), lines = b.instructions.split('\n'), val = k => (a[k] && a[k].v) || '', custom = k => String((a[k] && a[k].custom) || '').trim().slice(0, 200);
    const col = custom('knowledge') && db.collections.find(c => c.name.toLowerCase().includes(custom('knowledge').toLowerCase()));
    b.collections = col ? [col.id] : val('knowledge') === 'all' ? 'all' : val('knowledge') ? [] : b.collections;
    if (val('knowledge') === 'files') lines.push('Use only the files the person adds to the chat. If none is attached, ask for one.');
    if (val('knowledge') === 'none') lines.push('Work only from what the person types. Do not quote documents.');
    if (val('actions')) b.tools = val('actions') === 'none' ? [] : val('actions') === 'exact' ? ['calculator', 'gst', 'tables'] : [...new Set([...b.tools, 'calculator', 'browser'])];
    if (custom('actions')) lines.push('Also: ' + custom('actions'));
    if (val('style')) b.effort = val('style');
    lines.push(custom('style') ? 'Answer style: ' + custom('style') : { quick: 'Answer in a few short lines.', balanced: 'Give the answer first, then the reasons step by step.', thorough: 'Be thorough: cover every relevant point and say what you checked.' }[b.effort]);
    lines.push('When you are not sure, say so plainly instead of guessing.');
    const teams = custom('share') ? custom('share').split(',').map(x => x.trim()).filter(Boolean) : val('share').startsWith('team:') ? [val('share').slice(5)] : [];
    b.shared = isAdmin(u) && (val('share') === 'everyone' || teams.length > 0);
    b.access = teams.length ? { mode: 'restricted', teams, users: [] } : { mode: 'everyone', teams: [], users: [] };
    b.instructions = [...new Set(lines.filter(l => !/^Be brief and plain/.test(l) || b.effort === 'quick'))].join('\n');
    b.icon = b.tools.includes('browser') ? 'travel_explore' : b.tools.includes('gst') ? 'receipt_long' : b.tools.length ? 'calculate' : b.collections === 'all' ? 'policy' : 'smart_toy';
    const model = db.app.config.defaultModel;
    if (GW.url && db.models.some(m => m.id === model && m.status === 'serving')) {
      try {
        let txt = '';
        await ctx.streamModel(model, [{ role: 'system', content: 'You name and brief assistants for office work. Reply with one JSON object only: name (max 3 words, no quotes), description (one plain line), starters (array of 3 short example questions a person would ask it).' }, { role: 'user', content: d }], x => { txt += x; }, AbortSignal.timeout(30000));
        const j = JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1));
        if (j.name) b.name = String(j.name).slice(0, 60); if (j.description) b.description = String(j.description).slice(0, 140);
        b.starters = (Array.isArray(j.starters) ? j.starters : []).map(String).slice(0, 4); b.by = 'model';
      } catch { /* keep the rule-based draft */ }
    }
    return b;
  });
  on('POST', '/api/app/allow-site', ({ u, body }) => {
    const h = String(body.host || '').toLowerCase().replace(/^https?:\/\//, '').split('/')[0];
    if (!/^[a-z0-9.-]+$/.test(h)) throw err(400, 'That is not a site name.');
    const t = db.app.config.tools; if (!t.sites.includes(h)) t.sites.push(h);
    const a = db.app, v = (a.versions[0] ? a.versions[0].v : 0) + 1;
    a.versions.unshift({ v, at: now(), by: u.name, note: 'Allowed site ' + h, config: JSON.parse(JSON.stringify(a.config)) }); if (a.status === 'running') a.deployedVersion = v;
    audit(u, 'Allowed a site for the browser', h); return { sites: t.sites };
  }, A);

  // ---------- AG-UI: the same run as an open event stream, for any AG-UI client
  on('POST', '/api/agui/run', async ({ u, body, res }) => {
    needGpt(u);
    const msgs = Array.isArray(body.messages) ? body.messages : [], last = [...msgs].reverse().find(m => m.role === 'user');
    if (!last || !String(last.content || '').trim()) throw err(400, 'Send at least one user message.');
    const fp = body.forwardedProps || {};
    let chat = db.chats.find(c => c.id === body.threadId && c.userId === u.id);
    if (!chat) { chat = { id: body.threadId && /^[\w-]{6,64}$/.test(body.threadId) && !db.chats.some(c => c.id === body.threadId) ? body.threadId : uid('c'), userId: u.id, title: 'New chat', pinned: false, assistantId: null, model: db.app.config.models.includes(fp.model) ? fp.model : db.app.config.defaultModel, sources: 'all', effort: 'balanced', createdAt: now(), updatedAt: now(), messages: [] }; db.chats.push(chat); }
    if (['quick', 'balanced', 'thorough'].includes(fp.effort)) chat.effort = fp.effort;
    const runId = body.runId || uid('run'), threadId = chat.id;
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' });
    const ev = o => { if (!res.writableEnded) res.write(`data: ${JSON.stringify({ ...o, timestamp: Date.now() })}\n\n`); };
    const ac = new AbortController(); let closed = false, mid = null; const open = new Set();
    res.on('close', () => { if (!res.writableEnded) { closed = true; ac.abort(); } });
    ev({ type: 'RUN_STARTED', threadId, runId });
    try {
      await ctx.answer(u, chat, { content: String(last.content) }, (name, d) => {
        if (name === 'meta') { mid = d.id; ev({ type: 'STEP_STARTED', stepName: 'answer' }); ev({ type: 'STATE_SNAPSHOT', snapshot: { title: d.title, model: d.model, citations: d.citations } }); ev({ type: 'TEXT_MESSAGE_START', messageId: mid, role: 'assistant' }); }
        else if (name === 'activity') {
          if (!open.has(d.id)) { open.add(d.id); ev({ type: 'TOOL_CALL_START', toolCallId: d.id, toolCallName: d.tool, parentMessageId: mid }); ev({ type: 'TOOL_CALL_ARGS', toolCallId: d.id, delta: JSON.stringify({ step: d.label }) }); }
          if (d.state !== 'running') { ev({ type: 'TOOL_CALL_END', toolCallId: d.id }); ev({ type: 'TOOL_CALL_RESULT', messageId: uid('m'), toolCallId: d.id, role: 'tool', content: JSON.stringify({ state: d.state, result: d.result || '', url: d.url || '' }) }); }
        }
        else if (name === 'delta') ev({ type: 'TEXT_MESSAGE_CONTENT', messageId: mid, delta: d.t });
        else if (name === 'done') {
          const m = d.message; ev({ type: 'TEXT_MESSAGE_END', messageId: mid });
          ev({ type: 'STATE_SNAPSHOT', snapshot: { mode: m.mode, notice: m.notice, effort: m.effort, budget: m.budget, citations: m.citations } }); ev({ type: 'STEP_FINISHED', stepName: 'answer' });
          ev({ type: 'RUN_FINISHED', threadId, runId, outcome: m.interrupt ? { type: 'interrupt', interrupts: [{ id: m.interrupt.id, reason: m.interrupt.reason, detail: m.interrupt.detail }] } : { type: 'success' }, result: { messageId: m.id } });
        }
      }, { signal: ac.signal, closed: () => closed });
    } catch (e) { ev({ type: 'RUN_ERROR', message: e.status ? e.message : 'The run failed.', code: String(e.status || 500) }); }
    res.end();
  });

  return { PLUGINS, TEMPLATES, runTools, endSession, calc, mcpViews: () => db.mcp.map(m => ({ id: m.id, name: m.name, error: m.error || '', tools: m.tools.map(t => ({ name: t.name, description: t.description, params: t.params, ask: t.ask })) })) };
};
