// Runs the prototype's Node server inside the browser, so the preview works on static hosting.
// The server files are loaded as text and given small stand-ins for http, fs, crypto, path, os and child_process.
// State is kept in this browser (IndexedDB). Nothing is sent anywhere.
const BASE = new URL('./', self.location).pathname.replace(/\/$/, '');
const enc = new TextEncoder(), dec = new TextDecoder();

// ---- storage: one JSON document
const idb = () => new Promise((ok, no) => { const r = indexedDB.open('vanikgpt-preview', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
const kvGet = async k => { const d = await idb(); return new Promise(ok => { const q = d.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => ok(q.result); q.onerror = () => ok(undefined); }); };
const kvSet = async (k, v) => { const d = await idb(); return new Promise(ok => { const t = d.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = ok; t.onerror = ok; }); };

// ---- sha256 and hmac, synchronous like Node's
const K = new Uint32Array(64); { let n = 0, c = 2; const prime = x => { for (let i = 2; i * i <= x; i++) if (x % i === 0) return false; return true; }; while (n < 64) { if (prime(c)) K[n++] = (Math.cbrt(c) % 1) * 2 ** 32; c++; } }
function sha256(bytes) {
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]), l = bytes.length, m = new Uint8Array(((l + 9 + 63) >> 6) << 6), w = new Uint32Array(64), v = new DataView(m.buffer);
  m.set(bytes); m[l] = 0x80; v.setUint32(m.length - 4, l * 8); v.setUint32(m.length - 8, Math.floor(l / 2 ** 29));
  const r = (x, n) => (x >>> n) | (x << (32 - n));
  for (let o = 0; o < m.length; o += 64) {
    for (let i = 0; i < 16; i++) w[i] = v.getUint32(o + i * 4);
    for (let i = 16; i < 64; i++) w[i] = (w[i - 16] + (r(w[i - 15], 7) ^ r(w[i - 15], 18) ^ (w[i - 15] >>> 3)) + w[i - 7] + (r(w[i - 2], 17) ^ r(w[i - 2], 19) ^ (w[i - 2] >>> 10))) | 0;
    let [a, b, c, d, e, f, g, k] = h;
    for (let i = 0; i < 64; i++) { const t1 = (k + (r(e, 6) ^ r(e, 11) ^ r(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0, t2 = ((r(a, 2) ^ r(a, 13) ^ r(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0; k = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0; }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += k;
  }
  const out = new Uint8Array(32); h.forEach((x, i) => new DataView(out.buffer).setUint32(i * 4, x)); return out;
}
const hex = b => [...b].map(x => x.toString(16).padStart(2, '0')).join('');
const b64url = b => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const hasher = fn => { let s = ''; return { update(x) { s += x; return this; }, digest() { return hex(fn(enc.encode(s))); } }; };
const crypto_ = {
  randomBytes: n => { const b = crypto.getRandomValues(new Uint8Array(n)); return { toString: e => (e === 'hex' ? hex(b) : b64url(b)) }; },
  createHash: () => hasher(sha256),
  createHmac: (_, key) => { let k = enc.encode(key); if (k.length > 64) k = sha256(k); const p = new Uint8Array(64); p.set(k); const cat = (a, b) => { const o = new Uint8Array(a.length + b.length); o.set(a); o.set(b, a.length); return o; }; return hasher(m => sha256(cat(p.map(x => x ^ 0x5c), sha256(cat(p.map(x => x ^ 0x36), m))))); },
};

// ---- other stand-ins
let dbText = null, handler = null;
const fs_ = { existsSync: p => /db\.json$/.test(p) && dbText !== null, readFileSync: () => dbText, writeFileSync: (p, t) => { if (/db\.json$/.test(p)) { dbText = t; kvSet('db', t); } }, mkdirSync() {}, statSync() { throw new Error('no files here'); }, readdirSync() { throw new Error('no files here'); }, mkdtempSync: p => p + 'x', rmSync() {}, unlinkSync() {}, createReadStream() { throw new Error('no files here'); } };
const path_ = { join: (...a) => a.join('/').replace(/\/+/g, '/'), normalize: p => p, resolve: (...a) => a.join('/'), dirname: p => p.replace(/\/[^/]*$/, ''), extname: p => (p.match(/\.[^./]+$/) || [''])[0], relative: (a, b) => b.replace(a, '').replace(/^\//, '') };
const http_ = { createServer: h => { handler = h; return { listen: (a, b, cb) => { if (typeof cb === 'function') cb(); } }; } };
const timer = fn => (...a) => { const id = fn(...a); return { id, unref() { return this; } }; };
const clear = fn => t => fn(t && t.id !== undefined ? t.id : t);
const mods = { http: http_, fs: fs_, path: path_, crypto: crypto_, os: { tmpdir: () => '/tmp' }, child_process: { spawn() { throw new Error('no processes here'); } } };
const BufferLike = { concat: parts => ({ toString: () => dec.decode(new Uint8Array(parts.flatMap(p => [...p]))) }) };
const cache = {};
async function boot() {
  dbText = (await kvGet('db')) ?? null;
  const src = {}; for (const f of ['server', 'features', 'agent', 'sample']) src[f] = await (await fetch(`${BASE}/node/${f}.js`, { cache: 'no-cache' })).text();
  const req = name => { if (mods[name]) return mods[name]; const f = name.replace('./', ''); if (!cache[f]) { const module = { exports: {} }; cache[f] = module; run(src[f], module); } return cache[f].exports; };
  const run = (code, module) => new Function('require', 'module', 'exports', 'process', '__dirname', 'Buffer', 'setInterval', 'setTimeout', 'clearTimeout', 'clearInterval', 'console', code)(req, module, module.exports, { env: { VANIK_DEMO: '1' }, argv: [], on() {}, execPath: '' }, '/app', BufferLike, timer(setInterval), timer(setTimeout), clear(clearTimeout), clear(clearInterval), { log() {}, error: (...a) => console.error(...a) });
  run(src.server, { exports: {} });
}
let ready = null;
const up = () => (ready = ready || boot().catch(e => { ready = null; throw e; }));

async function serve(request, pathname, search) {
  await up();
  const body = request.method === 'GET' ? null : new Uint8Array(await request.arrayBuffer());
  return new Promise(resolve => {
    let ctl, status = 200, headers = {}, sent = false; const closers = [];
    const stream = new ReadableStream({ start(c) { ctl = c; }, cancel() { closers.forEach(f => f()); } });
    const go = () => { if (!sent) { sent = true; resolve(new Response(stream, { status, headers })); } };
    const res = { headersSent: false, writableEnded: false, setHeader(k, v) { headers[k] = v; }, writeHead(s, h) { status = s; Object.assign(headers, h || {}); this.headersSent = true; go(); }, write(x) { go(); try { ctl.enqueue(typeof x === 'string' ? enc.encode(x) : x); } catch { /* closed */ } }, end(x) { if (x) this.write(x); this.writableEnded = true; go(); try { ctl.close(); } catch { /* closed */ } }, on(ev, f) { if (ev === 'close') closers.push(f); } };
    const hs = {}; request.headers.forEach((v, k) => { hs[k.toLowerCase()] = v; });
    const ls = {}; const req = { method: request.method, url: pathname + search, headers: hs, on(ev, f) { ls[ev] = f; return this; }, destroy() {} };
    handler(req, res);
    queueMicrotask(() => { if (body && body.length && ls.data) ls.data(body); if (ls.end) ls.end(); });
  });
}
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (u.origin !== self.location.origin || !u.pathname.startsWith(BASE + '/')) return;
  const p = u.pathname.slice(BASE.length);
  if (p.startsWith('/api/') || p.startsWith('/gateway/')) e.respondWith(serve(e.request, p, u.search).catch(err => new Response(JSON.stringify({ error: 'The preview could not start: ' + err.message }), { status: 500, headers: { 'Content-Type': 'application/json' } })));
});
