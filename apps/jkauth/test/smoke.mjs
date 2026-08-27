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
import { TOTP, Secret } from 'otpauth';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER = join(__dirname, '..', 'server.js');

const mkKeypair = () => generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const { privateKey, publicKey } = mkKeypair();
const { publicKey: publicKey2 } = mkKeypair();   // a 2nd public key for the JWKS-rotation test

// Match the server's TOTP parameters (src/twofactor.js) so generated codes verify.
const totpCode = secret => new TOTP({
  issuer: 'jkOS', label: 'smoke', algorithm: 'SHA1', digits: 6, period: 30,
  secret: Secret.fromBase32(secret),
}).generate();

const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
function ok(name, cond, extra = '') { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}  ${extra}`); } }
const setCookieFor = (arr, name) => (arr || []).find(c => c.startsWith(name + '='));
const matchHtml = (html, re) => (html.match(re) || [])[1];
const matchAll = (html, re) => [...html.matchAll(re)].map(m => m[1]);

// One server instance with its own port, temp DB, and cookie jar.
// ⚠️ SEQUENTIAL, not a fresh random pick per instance. This smoke boots nine
// servers in one run, and re-rolling `4900 + random(500)` for each is a birthday
// collision at roughly 7% — which is the OPS-1 class in miniature: the second
// instance fails to bind, `ready()` polls the port anyway, the FIRST instance
// answers, and the assertions run against a server configured for a different
// test. It bit under full-gate load as "jwks returns two keys → ['1']" (instance
// F reading instance A's JWKS) while passing every standalone run. The base is
// still randomised once per process so two runs don't tread on each other; the
// counter is what makes a collision WITHIN a run impossible.
const PORT_BASE = 4900 + Math.floor(Math.random() * 400);
let portSeq = 0;

class Server {
  constructor(extraEnv = {}) {
    // Band clear of the test-port registry (3980–3996) + discover spares (4083–4085).
    this.port = PORT_BASE + (portSeq++);
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
        RL_CREDENTIALS: '1000', RL_REFRESH: '1000',
        ...extraEnv,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.exited = null;
    this.child.stdout.on('data', d => { this.log += d; });
    this.child.stderr.on('data', d => { this.log += d; });
    this.child.on('exit', (code, signal) => { this.exited = { code, signal }; });
  }
  // 12s, not 5. Nine servers boot in one run and the full gate runs this while
  // other suites are working the same machine; a cold Node boot plus migrations
  // plus bcrypt seeding can exceed a 5s budget under that load, and the symptom
  // is "E3 never became healthy" in the gate while every standalone run passes.
  async ready(tries = 120) {
    for (let i = 0; i < tries; i++) {
      // Belt to the sequential-port braces (B1 / OPS-1): a bare 200 proves only
      // that SOMETHING is on the port. If a stray server owns it, this says so
      // instead of letting the assertions run against a stranger.
      if (this.exited) return false;
      try {
        const res = await fetch(this.base + '/health');
        if (res.ok) {
          const body = await res.json().catch(() => ({}));
          if (body.service === 'jkauth') return true;
          console.error(`  ✗ :${this.port} answered 200 but service=${JSON.stringify(body.service)} — not this jkAuth`);
          return false;
        }
      } catch { /* not up yet */ }
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
  { const h = await (await fetch(A.base + '/health')).json();
    ok('GET /health', h.status === 'ok' && h.service === 'jkauth', `got ${JSON.stringify(h)}`); }
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
    // Slim JWT: payload carries identity but NOT avatar_url (cookie-bloat fix).
    const pl = JSON.parse(Buffer.from(A.jar.get('jkos_token').split('.')[1], 'base64url').toString());
    ok('access JWT payload is slim (no avatar_url)', !('avatar_url' in pl) && !!pl.sub && !!pl.email && !!pl.role, JSON.stringify(pl));
    // RFC 7519: sub MUST be a string. A numeric sub 401s strict verifiers
    // (python-jose >= 3.4 / PyJWT >= 2.10) and looped staging.jkos.net/deploy.
    ok('access JWT sub is a string (RFC 7519, strict-verifier safe)', typeof pl.sub === 'string', JSON.stringify(pl.sub));
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

  console.log('A · password prehash closes bcrypt 72-byte truncation (U1)');
  {
    const base = 'A'.repeat(72);   // bcrypt would truncate everything past here
    await A.req('POST', '/auth/register', { json: { email: 'trunc@jkos.net', password: base + 'REAL-suffix' }, noJar: true });
    const wrong = await A.req('POST', '/auth/login', { json: { email: 'trunc@jkos.net', password: base + 'FAKE-suffix' }, noJar: true });
    ok('login fails when only the first 72 bytes match', wrong.status === 401, `got ${wrong.status}`);
    const right = await A.req('POST', '/auth/login', { json: { email: 'trunc@jkos.net', password: base + 'REAL-suffix' }, noJar: true });
    ok('login succeeds with the full password', right.status === 200, `got ${right.status}`);
  }

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
  r = await B.req('POST', '/auth/guest', { json: { password: 'guestpass123' } }); j = await r.json().catch(() => ({}));
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

  // ── Instances E1/E2: the soft per-account lockout, in two halves. (S6)
  //
  // These used to share ONE instance on a 500ms budget: assert the immediate retry
  // is 429, then sleep(700) and assert the window reopened. That made the 429 the
  // suite's one flake — "immediate" is only immediate on an idle machine, and inside
  // a full `test:contracts` chain the two adjacent requests could straddle 500ms, by
  // which point the window had legitimately expired and the retry was no longer
  // locked. It passed 68/68 in isolation and blipped in the chain (git history).
  //
  // Split so each half can only be broken by an absurd delay, never a plausible one:
  //   E1 · window 60s  → an "immediate" retry stays locked unless a whole minute
  //                      elapses between two back-to-back calls.
  //   E2 · window 500ms → only ever asserted AFTER sleeping past it, where extra
  //                      scheduling delay makes the window MORE expired, not less.
  // Both directions are now monotonic in elapsed time, so load can't flip either.
  const E1 = start({ LOCKOUT_FREE: '0', LOCKOUT_BASE_MS: '60000', LOCKOUT_CAP_MS: '60000' });
  if (!await E1.ready()) { console.error('E1 never became healthy:\n' + E1.log); return shutdown(1); }
  console.log('E1 · per-account lockout engages (S6)');
  await E1.req('POST', '/auth/register', { json: { email: 'lock@jkos.net', password: 'password123' }, noJar: true });
  ok('wrong password 401', (await E1.req('POST', '/auth/login', { json: { email: 'lock@jkos.net', password: 'nope' }, noJar: true })).status === 401);
  {
    const locked = await E1.req('POST', '/auth/login', { json: { email: 'lock@jkos.net', password: 'password123' }, noJar: true });
    const lj = await locked.json().catch(() => ({}));
    ok('immediate retry → 429 ACCOUNT_LOCKED + Retry-After', locked.status === 429 && lj.code === 'ACCOUNT_LOCKED' && !!locked.headers.get('retry-after'), `${locked.status} ${JSON.stringify(lj)}`);
  }

  const E2 = start({ LOCKOUT_FREE: '0', LOCKOUT_BASE_MS: '500', LOCKOUT_CAP_MS: '500' });
  if (!await E2.ready()) { console.error('E2 never became healthy:\n' + E2.log); return shutdown(1); }
  console.log('E2 · lockout window reopens, then resets (S6)');
  await E2.req('POST', '/auth/register', { json: { email: 'lock@jkos.net', password: 'password123' }, noJar: true });
  await E2.req('POST', '/auth/login', { json: { email: 'lock@jkos.net', password: 'nope' }, noJar: true });
  await sleep(700);   // ≥ the 500ms backoff window; overshooting is harmless here
  {
    const okLogin = await E2.req('POST', '/auth/login', { json: { email: 'lock@jkos.net', password: 'password123' } });
    ok('correct login after backoff window → 200', okLogin.status === 200, `got ${okLogin.status}`);
    // Backoff reset on success: a fresh wrong attempt is 401 (not still-locked 429).
    ok('backoff reset after success', (await E2.req('POST', '/auth/login', { json: { email: 'lock@jkos.net', password: 'nope' }, noJar: true })).status === 401);
  }

  // ── Instance E3: the per-IP credential throttle must never take the sign-in
  //    PAGE away. app.use() mounts middleware for every method, so the limiter
  //    used to count GET /auth/login: loading the form burned the budget, and
  //    once burned the page itself answered with a raw JSON 429 for the rest of
  //    the window — a locked door with the handle removed. Budget of 1 makes
  //    "exhausted" one POST away.
  const E3 = start({ RL_CREDENTIALS: '1', RL_WINDOW_MS: '600000' });
  if (!await E3.ready()) { console.error('E3 never became healthy:\n' + E3.log); return shutdown(1); }
  console.log('E3 · credential throttle throttles POSTs, never the login page');
  await E3.req('POST', '/auth/login', { form: { email: 'nobody@jkos.net', password: 'nope' }, noJar: true });
  {
    const throttled = await E3.req('POST', '/auth/login', { form: { email: 'nobody@jkos.net', password: 'nope' }, noJar: true });
    const body = await throttled.text();
    ok('POST past the budget → 429 + Retry-After', throttled.status === 429 && !!throttled.headers.get('retry-after'), `${throttled.status}`);
    ok('throttled form post gets the login FORM back, not JSON',
      /<form method="POST" action="\/auth\/login"/.test(body) && /Please wait \d+ minutes? and try again/.test(body),
      body.slice(0, 160));
    const asJson = await E3.req('POST', '/auth/login', { json: { email: 'nobody@jkos.net', password: 'nope' }, noJar: true });
    const jj = await asJson.json().catch(() => ({}));
    ok('throttled JSON caller keeps a JSON body', asJson.status === 429 && jj.code === 'RATE_LIMITED' && jj.retry_after_ms > 0, JSON.stringify(jj));
    const page = await E3.req('GET', '/auth/login', { noJar: true });
    const pageHtml = await page.text();
    ok('GET /auth/login still renders while the POST budget is spent',
      page.status === 200 && pageHtml.includes('action="/auth/login"'), `${page.status}`);
    ok('GET /auth/register still renders too',
      (await E3.req('GET', '/auth/register', { noJar: true })).status === 200);
  }

  // ── Instance F: a 2nd public key published in JWKS — verifies multi-key
  //    rotation output. (U3)
  const F = start({ JKOS_AUTH_PUBLIC_KEY_NEXT: publicKey2, JKOS_AUTH_KID: '1', JKOS_AUTH_KID_NEXT: '2' });
  if (!await F.ready()) { console.error('F never became healthy:\n' + F.log); return shutdown(1); }
  console.log('F · JWKS publishes active + next key (U3)');
  r = await F.req('GET', '/auth/jwks'); j = await r.json().catch(() => ({}));
  ok('jwks returns two keys', Array.isArray(j.keys) && j.keys.length === 2, JSON.stringify((j.keys || []).map(k => k.kid)));
  ok('jwks kids are 1 and 2', (j.keys || []).map(k => k.kid).sort().join(',') === '1,2');
  ok('both keys RS256 RSA sig', (j.keys || []).every(k => k.alg === 'RS256' && k.kty === 'RSA' && k.use === 'sig'));

  // ── Instance G: TOTP 2FA — setup, enable, challenge on login, recovery code. (U6)
  // TOTP enrollment requires the sealing key (JK-A4) — the keyless 503 path is
  // covered in test/security.mjs.
  const G = start({ JKOS_2FA_ENC_KEY: 'smoke-seal-key' });
  if (!await G.ready()) { console.error('G never became healthy:\n' + G.log); return shutdown(1); }
  console.log('G · TOTP 2FA (U6)');
  await G.req('POST', '/auth/register', { json: { email: 'totp@jkos.net', password: 'password123' } });
  let html = await (await G.req('POST', '/auth/2fa/totp/setup', { form: {} })).text();
  const secret = matchHtml(html, /class="secret-key">([^<]+)</);
  ok('totp setup returns a base32 secret + QR', !!secret && /^[A-Z2-7]+$/.test(secret) && html.includes('data:image'), secret);
  html = await (await G.req('POST', '/auth/2fa/totp/enable', { form: { code: totpCode(secret) } })).text();
  const recovery = matchAll(html, /<li>([^<]+)<\/li>/g);
  ok('enabling with a valid code returns recovery codes', recovery.length === 8, JSON.stringify(recovery));
  // Logout, then a fresh login must be challenged.
  await G.req('POST', '/auth/logout', { json: {} });
  r = await G.req('POST', '/auth/login', { json: { email: 'totp@jkos.net', password: 'password123' }, noStore: true });
  j = await r.json().catch(() => ({}));
  ok('login with 2FA on → TWO_FACTOR_REQUIRED + pending token', r.status === 200 && j.code === 'TWO_FACTOR_REQUIRED' && !!j.pending_token && j.methods?.includes('totp'), JSON.stringify(j));
  ok('no session cookie issued at the challenge step', !G.jar.has('jkos_token'));
  const pending = j.pending_token;
  ok('wrong 2FA code → 401 TWO_FACTOR_INVALID', (await G.req('POST', '/auth/login/2fa', { json: { pending_token: pending, code: '000000' }, noJar: true })).status === 401);
  r = await G.req('POST', '/auth/login/2fa', { json: { pending_token: pending, code: totpCode(secret) } });
  j = await r.json().catch(() => ({}));
  ok('valid TOTP code completes login → 200 + cookies', r.status === 200 && j.user?.email === 'totp@jkos.net' && G.jar.has('jkos_token'), `${r.status} ${JSON.stringify(j)}`);
  // Recovery code path: new challenge, redeem a recovery code.
  await G.req('POST', '/auth/logout', { json: {} });
  r = await G.req('POST', '/auth/login', { json: { email: 'totp@jkos.net', password: 'password123' }, noStore: true });
  const pending2 = (await r.json().catch(() => ({}))).pending_token;
  r = await G.req('POST', '/auth/login/2fa', { json: { pending_token: pending2, code: recovery[0] } });
  ok('recovery code completes login → 200', r.status === 200 && G.jar.has('jkos_token'), `got ${r.status}`);
  ok('a used recovery code is rejected on reuse', (await (async () => {
    await G.req('POST', '/auth/logout', { json: {} });
    const rr = await G.req('POST', '/auth/login', { json: { email: 'totp@jkos.net', password: 'password123' }, noStore: true });
    const p = (await rr.json().catch(() => ({}))).pending_token;
    return G.req('POST', '/auth/login/2fa', { json: { pending_token: p, code: recovery[0] }, noJar: true });
  })()).status === 401);

  // ── Instance H: email-OTP 2FA — OTP_TEST_ECHO surfaces the code in the log. (U6)
  const H = start({ OTP_TEST_ECHO: '1' });
  if (!await H.ready()) { console.error('H never became healthy:\n' + H.log); return shutdown(1); }
  console.log('H · email-OTP 2FA (U6)');
  await H.req('POST', '/auth/register', { json: { email: 'mail2fa@jkos.net', password: 'password123' } });
  // ⚠️ Email 2FA now requires a CONFIRMED address (JK-A12) — email is the
  // delivery channel, so enabling it for an unverified mailbox was the finding.
  ok('enabling email codes UNVERIFIED → 409', (await H.req('POST', '/auth/2fa/email/enable', { form: {} })).status === 409);
  await H.req('POST', '/auth/verify/send', { form: {} });
  let vcode = null;
  for (let i = 0; i < 20 && !vcode; i++) { vcode = matchHtml(H.log, /\[otp-echo\] mail2fa@jkos\.net (\d{6})/); if (!vcode) await sleep(50); }
  ok('verification code was emailed + echoed', !!vcode, H.log.slice(-200));
  ok('confirming the address 200', (await H.req('POST', '/auth/verify/confirm', { form: { code: vcode } })).status === 200);
  ok('enable email codes 200', (await H.req('POST', '/auth/2fa/email/enable', { form: {} })).status === 200);
  await H.req('POST', '/auth/logout', { json: {} });
  r = await H.req('POST', '/auth/login', { json: { email: 'mail2fa@jkos.net', password: 'password123' }, noStore: true });
  j = await r.json().catch(() => ({}));
  ok('login with email 2FA → TWO_FACTOR_REQUIRED (email)', r.status === 200 && j.code === 'TWO_FACTOR_REQUIRED' && j.methods?.includes('email'), JSON.stringify(j));
  // Pull the emailed code from the server log (echoed because OTP_TEST_ECHO=1).
  // Match the LAST echo, not the first — the verification code above is also in
  // this log, and taking the earliest would replay an already-consumed code.
  let code = null;
  const lastEcho = (log) => { const m = [...log.matchAll(/\[otp-echo\] mail2fa@jkos\.net (\d{6})/g)]; return m.length ? m[m.length - 1][1] : null; };
  for (let i = 0; i < 20 && !code; i++) { const c = lastEcho(H.log); if (c && c !== vcode) code = c; else await sleep(50); }
  ok('email OTP code was generated + echoed', !!code, H.log.slice(-200));
  r = await H.req('POST', '/auth/login/2fa', { json: { pending_token: j.pending_token, code } });
  const hj = await r.json().catch(() => ({}));
  ok('valid email OTP completes login → 200 + cookies', r.status === 200 && hj.user?.email === 'mail2fa@jkos.net' && H.jar.has('jkos_token'), `${r.status} ${JSON.stringify(hj)}`);

  console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'}: ${pass} passed, ${fail} failed`);
  shutdown(fail === 0 ? 0 : 1);
}

run().catch(e => { console.error('smoke harness error:', e); shutdown(1); });
