// jkOS Auth — self-contained smoke / regression test.
//
//   node apps/jkauth/test/smoke.mjs
//
// Boots server.js in a child process with an in-process RSA keypair + a throwaway
// temp DB on a random port, then drives every auth flow with a manual cookie jar
// (we capture Set-Cookie name=value and resend it, so the Secure/Domain/SameSite
// attributes a browser would enforce don't matter over plain HTTP). No network,
// no real secrets — safe to run anywhere. Exit 0 = all green.
//
// This is the regression net for the jkauth refactor + upgrade: behaviour must be
// identical before and after a change. Add a case here before touching a contract.

import { spawn } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER = join(__dirname, '..', 'server.js');

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

let pass = 0, fail = 0;
function ok(name, cond, extra = '') { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}  ${extra}`); } }
const setCookieFor = (arr, name) => (arr || []).find(c => c.startsWith(name + '='));

// One server instance with its own port, temp DB, and cookie jar.
class Server {
  constructor(extraEnv = {}) {
    this.port = 3100 + Math.floor(Math.random() * 2000);
    this.base = `http://127.0.0.1:${this.port}`;
    this.tmp = mkdtempSync(join(tmpdir(), 'jkauth-smoke-'));
    this.jar = new Map();
    this.log = '';
    this.child = spawn(process.execPath, [SERVER], {
      env: {
        ...process.env,
        PORT: String(this.port),
        DB_PATH: join(this.tmp, 'auth.db'),
        JKOS_AUTH_PRIVATE_KEY: privateKey,
        JKOS_AUTH_PUBLIC_KEY: publicKey,
        COOKIE_DOMAIN: 'localhost',
        AUTH_ORIGIN: this.base,
        PORTAL_URL: this.base,
        NODE_ENV: 'test',
        // Don't let per-IP rate limits throttle the test's many sequential calls.
        RL_CREDENTIALS: '1000', RL_REFRESH: '1000', RL_GOOGLE: '1000',
        ...extraEnv,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.child.stdout.on('data', d => { this.log += d; });
    this.child.stderr.on('data', d => { this.log += d; });
  }
  async ready(tries = 50) {
    for (let i = 0; i < tries; i++) {
      try { if ((await fetch(this.base + '/health')).ok) return true; } catch {}
      await new Promise(r => setTimeout(r, 100));
    }
    return false;
  }
  _setCookies(res) {
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const pair = c.split(';')[0];
      const i = pair.indexOf('=');
      const name = pair.slice(0, i).trim(), val = pair.slice(i + 1).trim();
      if (val === '') this.jar.delete(name); else this.jar.set(name, val);
    }
  }
  cookie() { return [...this.jar.entries()].map(([k, v]) => `${k}=${v}`).join('; '); }
  // Options: json/form (body), noJar (don't send jar cookies), cookieOverride
  // (send this raw Cookie header instead of the jar), noStore (don't fold the
  // response's Set-Cookie back into the jar). this.lastSetCookie always holds the
  // raw Set-Cookie array of the most recent response, for attribute assertions.
  async req(method, path, { json, form, noJar, cookieOverride, noStore } = {}) {
    const h = {};
    if (cookieOverride !== undefined) h.Cookie = cookieOverride;
    else if (!noJar && this.jar.size) h.Cookie = this.cookie();
    let body;
    if (json !== undefined) { h['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
    else if (form !== undefined) { h['Content-Type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(form).toString(); }
    const res = await fetch(this.base + path, { method, headers: h, body, redirect: 'manual' });
    this.lastSetCookie = res.headers.getSetCookie?.() ?? [];
    if (!noStore) this._setCookies(res);
    return res;
  }
  stop() {
    try { this.child.kill('SIGKILL'); } catch {}
    try { rmSync(this.tmp, { recursive: true, force: true }); } catch {}
  }
}

const servers = [];
function start(env) { const s = new Server(env); servers.push(s); return s; }
function shutdown(code) { for (const s of servers) s.stop(); process.exit(code); }

async function run() {
  // ── Instance A: no seeds — covers the empty-DB "first registrant = admin"
  //    bootstrap, plus the full token / profile / refresh / logout / login set.
  const A = start({});
  if (!await A.ready()) { console.error('A never became healthy:\n' + A.log); return shutdown(1); }

  console.log('A · health + first-registrant-is-admin');
  ok('GET /health', (await (await fetch(A.base + '/health')).json()).ok === true);
  let r = await A.req('POST', '/auth/register', { json: { email: 'a@jkos.net', name: 'Alice', password: 'password123' } });
  let j = await r.json().catch(() => ({}));
  ok('register 201', r.status === 201, `got ${r.status}`);
  ok('first user is admin', j.user?.role === 'admin', JSON.stringify(j.user));
  ok('token + refresh cookies set', A.jar.has('jkos_token') && A.jar.has('jkos_refresh'));
  const adminJar = new Map(A.jar);

  console.log('A · hardening (headers · jwt kid · password max)');
  {
    const rr = await A.req('GET', '/auth/me');
    ok('header X-Content-Type-Options nosniff', rr.headers.get('x-content-type-options') === 'nosniff');
    ok('header Cache-Control no-store', (rr.headers.get('cache-control') || '').includes('no-store'));
    ok('header X-Frame-Options DENY', rr.headers.get('x-frame-options') === 'DENY');
    const hdr = JSON.parse(Buffer.from(A.jar.get('jkos_token').split('.')[0], 'base64url').toString());
    ok('access JWT header kid=1 alg=RS256', hdr.kid === '1' && hdr.alg === 'RS256', JSON.stringify(hdr));
    const longPw = 'x'.repeat(200);
    ok('register >128-char password 400', (await A.req('POST', '/auth/register', { json: { email: 'long@jkos.net', password: longPw }, noJar: true })).status === 400);
  }

  console.log('A · remember-me cookie persistence (the suite-wide auto-login fix)');
  {
    // remember=true → access cookie must carry Max-Age so the browser keeps it
    // (and keeps sending the expiring JWT) instead of dropping it after 15 min,
    // which is what broke auto-login across apps. noStore keeps the jar intact.
    await A.req('POST', '/auth/login', { json: { email: 'a@jkos.net', password: 'password123', remember_me: true }, noStore: true });
    const remTok = setCookieFor(A.lastSetCookie, 'jkos_token');
    const remRef = setCookieFor(A.lastSetCookie, 'jkos_refresh');
    ok('remember=true → access cookie persists (Max-Age)', /max-age=/i.test(remTok || ''), remTok);
    ok('remember=true → refresh cookie persists (Max-Age)', /max-age=/i.test(remRef || ''), remRef);
    await A.req('POST', '/auth/login', { json: { email: 'a@jkos.net', password: 'password123', remember_me: false }, noStore: true });
    const sesTok = setCookieFor(A.lastSetCookie, 'jkos_token');
    ok('remember=false → access cookie is session-only (no Max-Age)', sesTok && !/max-age=/i.test(sesTok), sesTok);
  }

  console.log('A · me / profile / preferences-merge');
  r = await A.req('GET', '/auth/me'); j = await r.json().catch(() => ({}));
  ok('GET /auth/me 200', r.status === 200 && j.user?.email === 'a@jkos.net');
  await A.req('PATCH', '/auth/profile', { json: { preferences: { lazuros: { enabled: false } } } });
  await A.req('PATCH', '/auth/profile', { json: { preferences: { scheme: 'forest' } } });
  r = await A.req('GET', '/auth/profile'); j = await r.json().catch(() => ({}));
  ok('preferences deep-merge', j.preferences?.lazuros?.enabled === false && j.preferences?.scheme === 'forest', JSON.stringify(j.preferences));
  await A.req('PATCH', '/auth/profile', { json: { name: 'Alice Cooper' } });
  r = await A.req('GET', '/auth/me'); j = await r.json().catch(() => ({}));
  ok('name updated', j.user?.name === 'Alice Cooper');

  console.log('A · refresh rotation');
  const beforeRefresh = A.jar.get('jkos_refresh');
  r = await A.req('POST', '/auth/refresh'); j = await r.json().catch(() => ({}));
  ok('refresh 200 + rotated', r.status === 200 && j.ok === true && A.jar.get('jkos_refresh') !== beforeRefresh, `got ${r.status}`);
  ok('me 200 after refresh', (await A.req('GET', '/auth/me')).status === 200);

  console.log('A · jwks / apps / require-admin');
  r = await A.req('GET', '/auth/jwks'); j = await r.json().catch(() => ({}));
  ok('jwks RS256 RSA key (kid=1)', Array.isArray(j.keys) && j.keys[0]?.alg === 'RS256' && j.keys[0]?.kty === 'RSA' && j.keys[0]?.kid === '1');
  r = await A.req('GET', '/auth/apps'); j = await r.json().catch(() => ({}));
  ok('apps list returned', Array.isArray(j.apps) && j.apps.length > 0);
  ok('admin passes require-admin (200)', (await A.req('GET', '/auth/require-admin')).status === 200);
  ok('no-auth require-admin 401', (await A.req('GET', '/auth/require-admin', { noJar: true })).status === 401);

  console.log('A · portal CSP nonce (S11)');
  {
    const rr = await A.req('GET', '/auth/dashboard');
    const csp = rr.headers.get('content-security-policy') || '';
    const html = await rr.text();
    const m = csp.match(/script-src 'self' 'nonce-([^']+)'/);
    ok('dashboard 200 + CSP carries script-src nonce', rr.status === 200 && !!m, csp);
    ok('inline <script>/<style> tagged with that nonce', !!m && html.includes(`nonce="${m[1]}"`));
    ok('no unsafe-inline in CSP', !/unsafe-inline/.test(csp));
  }

  console.log('A · audit log (S5)');
  {
    const rr = await A.req('GET', '/auth/events'); const jj = await rr.json().catch(() => ({}));
    ok('admin GET /auth/events 200 + non-empty', rr.status === 200 && Array.isArray(jj.events) && jj.events.length > 0, `got ${rr.status}`);
    ok('audit captured a login + register event',
      (jj.events || []).some(e => e.type === 'login') && (jj.events || []).some(e => e.type === 'register'),
      JSON.stringify((jj.events || []).map(e => e.type)));
  }

  console.log('A · logout (JSON + form)');
  ok('logout JSON 200', (await A.req('POST', '/auth/logout', { json: {} })).status === 200);
  ok('me 401 after logout', (await A.req('GET', '/auth/me')).status === 401);
  ok('refresh 401 after logout', (await A.req('POST', '/auth/refresh')).status === 401);

  console.log('A · login (wrong → right) + enumeration timing path');
  ok('wrong password 401', (await A.req('POST', '/auth/login', { json: { email: 'a@jkos.net', password: 'nope' } })).status === 401);
  ok('unknown user 401', (await A.req('POST', '/auth/login', { json: { email: 'ghost@jkos.net', password: 'whatever123' }, noJar: true })).status === 401);
  r = await A.req('POST', '/auth/login', { json: { email: 'a@jkos.net', password: 'password123', remember_me: true } });
  j = await r.json().catch(() => ({}));
  ok('right password 200', r.status === 200 && j.user?.email === 'a@jkos.net' && A.jar.has('jkos_token'));

  console.log('A · register validation + role assignment');
  const A2 = new Map(A.jar); A.jar.clear();
  r = await A.req('POST', '/auth/register', { json: { email: 'b@jkos.net', name: 'Bob', password: 'password123' } });
  j = await r.json().catch(() => ({}));
  ok('second user role=user', j.user?.role === 'user', JSON.stringify(j.user));
  ok('duplicate email 409', (await A.req('POST', '/auth/register', { json: { email: 'b@jkos.net', password: 'password123' }, noJar: true })).status === 409);
  ok('short password 400', (await A.req('POST', '/auth/register', { json: { email: 'c@jkos.net', password: 'short' }, noJar: true })).status === 400);

  console.log('A · guest disabled → 403');
  ok('guest 403 when unset', (await A.req('POST', '/auth/guest', { json: {}, noJar: true })).status === 403);

  // ── Instance B: GUEST_PASSWORD set — covers the guest login flow + role gate.
  const B = start({ GUEST_PASSWORD: 'guestpass123', ADMIN_SEED_EMAIL: 'root@jkos.net', ADMIN_SEED_PASSWORD: 'rootpass123' });
  if (!await B.ready()) { console.error('B never became healthy:\n' + B.log); return shutdown(1); }
  console.log('B · seeded admin login + guest flow');
  r = await B.req('POST', '/auth/login', { json: { email: 'root@jkos.net', password: 'rootpass123' } });
  j = await r.json().catch(() => ({}));
  ok('seeded admin logs in (role=admin)', r.status === 200 && j.user?.role === 'admin', JSON.stringify(j.user));
  ok('seeded admin passes require-admin', (await B.req('GET', '/auth/require-admin')).status === 200);
  B.jar.clear();
  r = await B.req('POST', '/auth/guest', { json: {} }); j = await r.json().catch(() => ({}));
  ok('guest login 200 role=guest', r.status === 200 && j.user?.role === 'guest', JSON.stringify(j.user));
  ok('guest fails require-admin (403)', (await B.req('GET', '/auth/require-admin')).status === 403);

  // ── Instance C: REFRESH_GRACE_MS=-1 disables the benign-race window so any
  //    re-presentation of a rotated refresh token is treated as theft. (S2/S9)
  const C = start({ REFRESH_GRACE_MS: '-1' });
  if (!await C.ready()) { console.error('C never became healthy:\n' + C.log); return shutdown(1); }
  console.log('C · refresh-token reuse detection');
  await C.req('POST', '/auth/register', { json: { email: 'c@jkos.net', password: 'password123' } });
  const R1 = C.jar.get('jkos_refresh');
  r = await C.req('POST', '/auth/refresh');
  const R2 = C.jar.get('jkos_refresh');
  ok('first rotation 200 + new refresh', r.status === 200 && R2 && R2 !== R1);
  ok('R2 works once', (await C.req('POST', '/auth/refresh', { cookieOverride: `jkos_refresh=${C.jar.get('jkos_refresh')}`, noStore: true })).status === 200);
  // Re-present the already-rotated R1 → reuse → whole family revoked.
  const reuse = await C.req('POST', '/auth/refresh', { cookieOverride: `jkos_refresh=${R1}`, noStore: true });
  const reuseBody = await reuse.json().catch(() => ({}));
  ok('reusing rotated R1 → 401 SESSION_REVOKED', reuse.status === 401 && reuseBody.code === 'SESSION_REVOKED', `${reuse.status} ${JSON.stringify(reuseBody)}`);
  // After the family is burned, even the latest refresh token is dead.
  ok('family revoked → latest token also 401', (await C.req('POST', '/auth/refresh')).status === 401);

  // ── Instance D: GUEST_PASSWORD set, NO admin seed — a seeded guest must NOT
  //    consume the "first real user = admin" bootstrap. (S12)
  const D = start({ GUEST_PASSWORD: 'guestpass123' });
  if (!await D.ready()) { console.error('D never became healthy:\n' + D.log); return shutdown(1); }
  console.log('D · guest seed does not steal admin bootstrap');
  r = await D.req('POST', '/auth/register', { json: { email: 'first@jkos.net', password: 'password123' } });
  j = await r.json().catch(() => ({}));
  ok('first non-guest registrant is admin despite seeded guest', r.status === 201 && j.user?.role === 'admin', JSON.stringify(j.user));

  console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'}: ${pass} passed, ${fail} failed`);
  shutdown(fail === 0 ? 0 : 1);
}

run().catch(e => { console.error('smoke harness error:', e); shutdown(1); });
