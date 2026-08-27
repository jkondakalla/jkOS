// TEST-4 · Session-lifecycle + credential security harness (the C2 rework).
//
//   node apps/jkauth/test/security.mjs
//
// Pins the six high-severity fixes from the 2026-08-26 jkAuth audit, each of
// which failed SILENTLY before — no error, just a control that wasn't there:
//   JK-A1  POST /auth/guest actually verifies GUEST_PASSWORD (it was hashed,
//          stored, and never compared), and the guest row joins the per-account
//          backoff.
//   JK-A2  reuse detection covers the token's whole life — the old prune deleted
//          rotated rows after 1 hour, so a stolen 30-day token replayed at
//          hour 2 read as 'expired' with no reuse event and no family burn.
//   JK-A3  an unremembered login now has a short server-side idle TTL, and an
//          ABSOLUTE cap ends even a continuously-refreshed family.
//   JK-A4  the TOTP secret is sealed (AES-256-GCM) at rest and enrollment is
//          REFUSED when no sealing key is configured.
//   JK-A5  the 10-session cap breaks whole-second created_at ties on id, so it
//          can no longer delete the session it was just asked to create.
//   JK-A10 logout / reuse / absolute-cap revocations TOMBSTONE the rows
//          (revoked_at + revoked_reason) instead of deleting the evidence.
//
// Boots the REAL server on a throwaway port + temp DB (tight TTL/grace/lockout
// knobs via env), drives it over real HTTP, and inspects the sessions table
// directly to assert what the wire cannot show (tombstones, sealed secrets).

import { spawn } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { TOTP, Secret } from 'otpauth';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER = join(__dirname, '..', 'server.js');

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; } else { fail++; console.error(`  ✗ ${name}  ${extra}`); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const tmp = mkdtempSync(join(tmpdir(), 'jkauth-security-'));
const DB_PATH = join(tmp, 'auth.db');
// Band clear of the test-port registry (3980–3996) + discover spares (4083–4085).
const port = 6100 + Math.floor(Math.random() * 500);
const base = `http://127.0.0.1:${port}`;

const GUEST_PW = 'guestpass123';
const GRACE_MS = 50;          // reuse grace — replays past this are theft
const IDLE_MS = 400;          // unremembered-session idle TTL
const ABSOLUTE_MS = 1500;     // family absolute cap

let serverLog = '';
const child = spawn(process.execPath, [SERVER], {
  env: {
    ...process.env,
    PORT: String(port), DB_PATH,
    JKOS_AUTH_PRIVATE_KEY: privateKey, JKOS_AUTH_PUBLIC_KEY: publicKey,
    COOKIE_DOMAIN: 'localhost', AUTH_ORIGIN: base, PORTAL_URL: base,
    NODE_ENV: 'test',
    GUEST_PASSWORD: GUEST_PW,
    JKOS_2FA_ENC_KEY: 'security-test-seal-key',
    REFRESH_GRACE_MS: String(GRACE_MS),
    SESSION_TTL_MS: String(IDLE_MS),
    SESSION_ABSOLUTE_TTL_MS: String(ABSOLUTE_MS),
    // 2nd failure → 60s lockout, so the backoff assert is deterministic.
    LOCKOUT_FREE: '1', LOCKOUT_BASE_MS: '60000',
    RL_CREDENTIALS: '10000', RL_REFRESH: '10000',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', d => { serverLog += d; });
child.stderr.on('data', d => { serverLog += d; });
let exited = null;
child.on('exit', (code, signal) => { exited = { code, signal }; });

// One cookie jar; `cookie:` overrides it for replay tests.
const jar = new Map();
function foldCookies(res) {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const pair = c.split(';')[0];
    const i = pair.indexOf('=');
    const name = pair.slice(0, i).trim(), val = pair.slice(i + 1).trim();
    if (val === '') jar.delete(name); else jar.set(name, val);
  }
}
const cookieHeader = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
async function api(method, path, { json, form, cookie, noStore } = {}) {
  const h = {};
  if (cookie !== undefined) h.Cookie = cookie;
  else if (jar.size) h.Cookie = cookieHeader();
  let body;
  if (json !== undefined) { h['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  if (form !== undefined) { h['Content-Type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(form).toString(); }
  const res = await fetch(base + path, { method, headers: h, body, redirect: 'manual' });
  if (!noStore) foldCookies(res);
  const text = await res.text();
  let data = null; try { data = JSON.parse(text); } catch { /* HTML */ }
  return { status: res.status, json: data, text };
}
async function ready(tries = 60) {
  for (let i = 0; i < tries; i++) {
    if (exited) return false;
    try {
      const r = await fetch(base + '/health');
      if (r.ok && (await r.json()).service === 'jkauth') return true;
    } catch { /* not up */ }
    await sleep(100);
  }
  return false;
}
function done() {
  try { child.kill('SIGKILL'); } catch { /* gone */ }
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
  if (fail && serverLog) console.error('\n── server log ──\n' + serverLog);
  console.log(`\nsecurity: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

try {
  if (!(await ready())) {
    fail++;
    console.error('server never became healthy'
      + (exited ? ` (exited code=${exited.code} signal=${exited.signal})` : '') + ':\n' + serverLog);
    done();
  }
  const db = new Database(DB_PATH);
  const refreshCookieName = () => [...jar.keys()].find(k => k.startsWith('jkos_refresh'));

  // ── A · JK-A1: the guest credential is real ────────────────────────────────
  let r = await api('POST', '/auth/guest', { json: {}, noStore: true });
  ok('guest with no password → 401', r.status === 401, `got ${r.status}`);
  r = await api('POST', '/auth/guest', { json: { password: 'wrong' }, noStore: true });
  ok('guest with wrong password → 401', r.status === 401, `got ${r.status}`);
  ok('failed guest attempt is counted on the row',
    db.prepare("SELECT failed_attempts FROM users WHERE email='guest@jkos.net'").get().failed_attempts >= 1);
  ok('guest_login_fail is audited',
    !!db.prepare("SELECT 1 FROM auth_events WHERE type='guest_login_fail'").get());
  r = await api('POST', '/auth/guest', { json: { password: 'wrong' }, noStore: true });
  r = await api('POST', '/auth/guest', { json: { password: GUEST_PW }, noStore: true });
  ok('guest backoff: correct password during lockout → 429', r.status === 429, `got ${r.status}`);
  db.prepare("UPDATE users SET failed_attempts=0, lockout_until=NULL WHERE email='guest@jkos.net'").run();
  r = await api('POST', '/auth/guest', { json: { password: GUEST_PW }, noStore: true });
  ok('guest with the real password → 200 + guest role', r.status === 200 && r.json?.user?.role === 'guest');

  // ── B · register the working account (first real user → admin) ─────────────
  r = await api('POST', '/auth/register', { json: { email: 'alice@x.net', password: 'password-a1', name: 'Alice' } });
  ok('register → 201', r.status === 201, `got ${r.status}`);

  // ── C · JK-A2 + JK-A10: reuse is detected past the grace window, and burns
  //        the family as a TOMBSTONE ────────────────────────────────────────────
  const stolen = jar.get(refreshCookieName());       // the token a thief copied
  r = await api('POST', '/auth/refresh', { json: {} });
  ok('legitimate rotation → ok', r.status === 200 && r.json?.ok === true);
  await sleep(GRACE_MS + 150);                        // well past the race grace
  r = await api('POST', '/auth/refresh', { json: {}, cookie: `${refreshCookieName()}=${stolen}`, noStore: true });
  ok('rotated token replayed after grace → SESSION_REVOKED', r.status === 401 && r.json?.code === 'SESSION_REVOKED',
    `got ${r.status} ${r.json?.code}`);
  const aliceId = db.prepare("SELECT id FROM users WHERE email='alice@x.net'").get().id;
  const burned = db.prepare('SELECT * FROM sessions WHERE user_id=?').all(aliceId);
  ok('the burned family is tombstoned, not deleted',
    burned.length >= 2 && burned.every(s => s.revoked_at && s.revoked_reason === 'reuse'),
    JSON.stringify(burned.map(s => s.revoked_reason)));
  ok('refresh_reuse is audited',
    !!db.prepare("SELECT 1 FROM auth_events WHERE type='refresh_reuse' AND user_id=?").get(aliceId));
  jar.clear();

  // ── D · JK-A3: an unremembered login expires server-side ───────────────────
  r = await api('POST', '/auth/login', { json: { email: 'alice@x.net', password: 'password-a1', remember_me: false } });
  ok('unremembered login → 200', r.status === 200);
  await sleep(IDLE_MS + 250);
  r = await api('POST', '/auth/refresh', { json: {} });
  ok('unremembered session is DEAD server-side after its idle TTL',
    r.status === 401 && r.json?.code === 'SESSION_EXPIRED', `got ${r.status} ${r.json?.code}`);
  jar.clear();

  // ── E · JK-A3: the absolute cap ends a continuously-refreshed family ───────
  r = await api('POST', '/auth/login', { json: { email: 'alice@x.net', password: 'password-a1', remember_me: true } });
  ok('remembered login → 200', r.status === 200);
  await sleep(200);
  r = await api('POST', '/auth/refresh', { json: {} });
  ok('rotation inside the absolute window → ok', r.status === 200 && r.json?.ok === true);
  await sleep(ABSOLUTE_MS);
  r = await api('POST', '/auth/refresh', { json: {} });
  ok('rotation past the absolute cap → SESSION_EXPIRED',
    r.status === 401 && r.json?.code === 'SESSION_EXPIRED', `got ${r.status} ${r.json?.code}`);
  ok('the capped family is tombstoned absolute_timeout',
    !!db.prepare("SELECT 1 FROM sessions WHERE user_id=? AND revoked_reason='absolute_timeout'").get(aliceId));
  ok('session_absolute_timeout is audited',
    !!db.prepare("SELECT 1 FROM auth_events WHERE type='session_absolute_timeout' AND user_id=?").get(aliceId));
  jar.clear();

  // ── F · JK-A5: the cap keeps the NEWEST sessions under same-second ties ────
  for (let i = 0; i < 11; i++) {
    r = await api('POST', '/auth/login', { json: { email: 'alice@x.net', password: 'password-a1', remember_me: true } });
  }
  ok('11th rapid login still holds a working session (cap did not eat it)',
    (await api('POST', '/auth/refresh', { json: {} })).status === 200);
  const active = db.prepare(
    'SELECT COUNT(*) AS c FROM sessions WHERE user_id=? AND rotated_at IS NULL AND revoked_at IS NULL').get(aliceId).c;
  ok('active sessions capped at 10', active === 10, `got ${active}`);

  // ── G · JK-A10: logout tombstones ──────────────────────────────────────────
  r = await api('POST', '/auth/logout', { json: {} });
  ok('logout → ok', r.status === 200);
  ok('logout left tombstones, not a hole',
    !!db.prepare("SELECT 1 FROM sessions WHERE user_id=? AND revoked_reason='logout'").get(aliceId));
  jar.clear();

  // ── H · JK-A4: the TOTP secret is sealed at rest, and still works ──────────
  r = await api('POST', '/auth/login', { json: { email: 'alice@x.net', password: 'password-a1' } });
  r = await api('POST', '/auth/2fa/totp/setup', { form: {} });
  const secretB32 = r.text.match(/<p class="secret-key">([A-Z2-7]+)<\/p>/)?.[1];
  ok('setup page carries a plaintext base32 secret for the human', !!secretB32);
  const storedSecret = db.prepare('SELECT totp_secret FROM users WHERE id=?').get(aliceId).totp_secret;
  ok('the STORED secret is sealed (enc:v1:), not plaintext',
    typeof storedSecret === 'string' && storedSecret.startsWith('enc:v1:') && !storedSecret.includes(secretB32 || '@'),
    String(storedSecret).slice(0, 24));
  const totp = new TOTP({ algorithm: 'SHA1', digits: 6, period: 30, secret: Secret.fromBase32(secretB32) });
  r = await api('POST', '/auth/2fa/totp/enable', { form: { code: totp.generate() } });
  ok('enable with a real code → recovery codes page', r.status === 200 && /recovery/i.test(r.text));
  jar.clear();
  r = await api('POST', '/auth/login', { json: { email: 'alice@x.net', password: 'password-a1' } });
  ok('login now challenges for the second factor', r.json?.code === 'TWO_FACTOR_REQUIRED', JSON.stringify(r.json));
  r = await api('POST', '/auth/login/2fa', { json: { pending_token: r.json?.pending_token, code: totp.generate() } });
  ok('2FA login verifies against the SEALED secret', r.status === 200 && r.json?.user?.email === 'alice@x.net',
    `got ${r.status}`);

  // ── H2 · JK-A19: a TOTP code is single-use inside its own window ───────────
  // Re-uses the enrolled authenticator from H. A code used to stay valid for the
  // whole ±1-step window (~90 s), so one seen over a shoulder could be replayed.
  {
    // The NEXT window's code, not this one's: section H already burned the
    // current step, and asking for it again here would be testing the replay
    // guard by accident rather than the happy path. window:1 accepts +1 step.
    const reuse = totp.generate({ timestamp: Date.now() + 30_000 });
    jar.clear();
    let a = await api('POST', '/auth/login', { json: { email: 'alice@x.net', password: 'password-a1' } });
    a = await api('POST', '/auth/login/2fa', { json: { pending_token: a.json?.pending_token, code: reuse } });
    ok('a fresh TOTP code completes login', a.status === 200, `got ${a.status}`);
    jar.clear();
    let b = await api('POST', '/auth/login', { json: { email: 'alice@x.net', password: 'password-a1' } });
    b = await api('POST', '/auth/login/2fa', { json: { pending_token: b.json?.pending_token, code: reuse } });
    ok('REPLAYING that same code is refused', b.status === 401, `got ${b.status}`);

    // ── JK-A7: the refused codes fed the per-account throttle ───────────────
    // LOCKOUT_FREE=1, so the first failure is free and the SECOND arms the
    // backoff — the point being that these are 2FA failures, which used to be
    // counted nowhere at all.
    db.prepare("UPDATE users SET failed_attempts=0, lockout_until=NULL WHERE email='alice@x.net'").run();
    let c;
    for (let i = 0; i < 2; i++) {
      jar.clear();
      c = await api('POST', '/auth/login', { json: { email: 'alice@x.net', password: 'password-a1' } });
      c = await api('POST', '/auth/login/2fa', { json: { pending_token: c.json?.pending_token, code: '000000' } });
    }
    ok('wrong 2FA codes increment the ACCOUNT throttle',
      db.prepare("SELECT failed_attempts AS n FROM users WHERE email='alice@x.net'").get().n >= 2);
    // …and the lockout those failures armed now bites at the PASSWORD step, with
    // the correct password: the account is throttled, not merely this endpoint.
    // Guessing the second factor can no longer be reset by re-authenticating.
    jar.clear();
    c = await api('POST', '/auth/login', { json: { email: 'alice@x.net', password: 'password-a1' } });
    ok('and the account is locked out even with the RIGHT password',
      c.status === 429 && c.json?.code === 'ACCOUNT_LOCKED', `${c.status} ${JSON.stringify(c.json)}`);
    db.prepare("UPDATE users SET failed_attempts=0, lockout_until=NULL WHERE email='alice@x.net'").run();
    jar.clear();
  }

  // ── H3 · JK-A16: an over-long meta stays PARSEABLE ─────────────────────────
  {
    const rows = db.prepare('SELECT meta FROM auth_events WHERE meta IS NOT NULL').all();
    let parsed = 0;
    for (const row of rows) { try { JSON.parse(row.meta); parsed++; } catch { /* counted below */ } }
    ok('every audit record with meta is valid JSON', parsed === rows.length,
      `${rows.length - parsed} of ${rows.length} unparseable`);
  }

  // ── I · JK-A4, fail closed: no key → no enrollment ─────────────────────────
  {
    const port2 = port + 501, base2 = `http://127.0.0.1:${port2}`;
    let log2 = '';
    const env2 = { ...child.spawnargs && process.env, PORT: String(port2), DB_PATH: join(tmp, 'auth2.db'),
      JKOS_AUTH_PRIVATE_KEY: privateKey, JKOS_AUTH_PUBLIC_KEY: publicKey,
      COOKIE_DOMAIN: 'localhost', AUTH_ORIGIN: base2, PORTAL_URL: base2, NODE_ENV: 'test',
      RL_CREDENTIALS: '10000' };
    delete env2.JKOS_2FA_ENC_KEY;
    const c2 = spawn(process.execPath, [SERVER], { env: env2, stdio: ['ignore', 'pipe', 'pipe'] });
    c2.stdout.on('data', d => { log2 += d; }); c2.stderr.on('data', d => { log2 += d; });
    try {
      let up = false;
      for (let i = 0; i < 60 && !up; i++) {
        try { up = (await fetch(base2 + '/health')).ok; } catch { /* not up */ }
        if (!up) await sleep(100);
      }
      ok('keyless instance boots', up, log2);
      const reg = await fetch(base2 + '/auth/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'bob@x.net', password: 'password-b1' }),
      });
      const cookies = (reg.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).join('; ');
      const setup = await fetch(base2 + '/auth/2fa/totp/setup', {
        method: 'POST', headers: { Cookie: cookies, 'Content-Type': 'application/x-www-form-urlencoded' }, body: '',
      });
      ok('TOTP enrollment WITHOUT a sealing key → 503, not plaintext', setup.status === 503, `got ${setup.status}`);
    } finally {
      try { c2.kill('SIGKILL'); } catch { /* gone */ }
    }
  }

  // ── J · JK-A23: a mangled JKOS_SERVICE_CLIENTS refuses to BOOT ─────────────
  // The parser used to `continue` past a malformed entry, so a secret containing
  // a ',' or ':' produced a client that either silently did not exist or existed
  // with the wrong secret and the wrong grant. Both are invisible at runtime.
  {
    const bad = spawn(process.execPath, [SERVER], {
      env: {
        ...process.env, PORT: String(port + 502), DB_PATH: join(tmp, 'auth3.db'),
        JKOS_AUTH_PRIVATE_KEY: privateKey, JKOS_AUTH_PUBLIC_KEY: publicKey,
        COOKIE_DOMAIN: 'localhost', NODE_ENV: 'test',
        // A secret with a ':' in it — the entry cuts, and the tail parses as scopes.
        JKOS_SERVICE_CLIENTS: 'lazuros:sec:ret:beigeboard:write',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let badLog = '';
    bad.stdout.on('data', d => { badLog += d; }); bad.stderr.on('data', d => { badLog += d; });
    const code = await new Promise((resolve) => {
      bad.on('exit', resolve);
      setTimeout(() => { try { bad.kill('SIGKILL'); } catch { /* gone */ } resolve('timeout'); }, 8000);
    });
    ok('a malformed service-client entry refuses to boot', code !== 0 && code !== 'timeout', `exit ${code}`);
    ok('and it names the position without printing the secret',
      /entry #1/.test(badLog) && !badLog.includes('sec:ret'), badLog.slice(-200));
  }

  // ── K · C6: the server-rendered HTML escapes what it interpolates ─────────
  // views.js renders user-controlled values (name, email) into markup, and the
  // nonce CSP is defence in depth, not a substitute for escaping.
  {
    const { escHtml, jsonForScript } = await import('../src/util.js').then(m => m.default ?? m);
    ok('escHtml neutralises tags, quotes and ampersands',
      escHtml(`<img src=x onerror='p'>&"`) === '&lt;img src=x onerror=&#39;p&#39;&gt;&amp;&quot;',
      escHtml(`<img src=x onerror='p'>&"`));
    ok('escHtml escapes & FIRST (no double-escaping)', escHtml('&lt;') === '&amp;lt;', escHtml('&lt;'));
    // ⚠️ JSON.stringify alone is NOT safe inside <script>: it leaves `<` alone,
    // so a value containing `</script>` ends the element.
    ok('jsonForScript cannot break out of a script block',
      !jsonForScript('</script><script>alert(1)//').includes('</script>'),
      jsonForScript('</script><script>alert(1)//'));

    // And the rendered pages actually use them: a registered name full of markup
    // must come back escaped, not live.
    jar.clear();
    const evil = '<img src=x onerror=alert(1)>';
    await api('POST', '/auth/register', { json: { email: 'evil@x.net', password: 'password-e1', name: evil } });
    const page = await api('GET', '/auth/dashboard');
    ok('a markup-laden display name renders escaped on the dashboard',
      page.text.includes('&lt;img src=x') && !page.text.includes('<img src=x onerror'),
      page.text.slice(0, 160));
  }

  // ── L · C7: the audience claim is now VERIFIED, not merely minted ─────────
  // One cookie goes to every *.jkos.net host, so `aud` is the containment that
  // stops a token minted for one app being spent at another. jkAuth minted it
  // and — the embarrassing half of JK-A14 — did not check it itself.
  {
    const { default: jwt } = await import('jsonwebtoken');
    // A fresh account: alice has TOTP on by now, so a password login there is a
    // challenge rather than a session.
    jar.clear();
    await api('POST', '/auth/register', { json: { email: 'aud@x.net', password: 'password-u1' } });
    const good = jar.get([...jar.keys()].find(k => k.startsWith('jkos_token')));
    const claims = JSON.parse(Buffer.from(good.split('.')[1], 'base64url').toString());
    ok('the access token carries an aud including jkAuth itself',
      [].concat(claims.aud || []).includes('auth'), JSON.stringify(claims.aud));

    // A token that is valid in every way EXCEPT its audience must be refused.
    const foreign = jwt.sign(
      { sub: String(claims.sub), email: claims.email, role: claims.role, scope: claims.scope },
      privateKey,
      { algorithm: 'RS256', issuer: 'jkos-auth', keyid: '1', audience: 'beigeboard', expiresIn: '5m' });
    const cookieName = [...jar.keys()].find(k => k.startsWith('jkos_token'));
    const r2 = await api('GET', '/auth/me', { cookie: `${cookieName}=${foreign}`, noStore: true });
    ok('a token minted for ANOTHER app is rejected here', r2.status === 401, `got ${r2.status}`);
  }

  // ── M · C4/WV-4: the write grant is a LADDER, so a caller can ask for less ─
  // The finding: `<app>:write` was one indivisible scope, so a client that
  // needed to create one row had to be handed the right to delete every row.
  {
    const { weaveWriteGate } = await import('@jkos/weave/server');
    const gate = weaveWriteGate({ scope: 'beigeboard:write' });
    const runGate = (user, method) => new Promise((resolve) => {
      const res = {
        statusCode: 200,
        status(c) { this.statusCode = c; return this; },
        json() { resolve(this.statusCode); return this; },
        setHeader() { return this },
      };
      gate({ method, user }, res, () => resolve(200));
    });

    const creator = { role: 'user', sub: '1', scope: ['beigeboard:read', 'beigeboard:create'] };
    ok('a create-only grant may POST', await runGate(creator, 'POST') === 200);
    ok('…and is REFUSED a DELETE', await runGate(creator, 'DELETE') === 403);
    ok('…and is REFUSED a PATCH', await runGate(creator, 'PATCH') === 403);

    // Backward compatibility is the reason the blanket scope survives: every
    // token minted before the ladder existed carries only `write`.
    const legacy = { role: 'user', sub: '1', scope: ['beigeboard:read', 'beigeboard:write'] };
    for (const m of ['POST', 'PATCH', 'DELETE']) {
      ok(`a legacy blanket write still passes ${m}`, await runGate(legacy, m) === 200);
    }

    // And a full human login carries the whole ladder — least privilege is not
    // "the owner may not delete his own rows".
    const claims = JSON.parse(Buffer.from(
      jar.get([...jar.keys()].find(k => k.startsWith('jkos_token'))).split('.')[1], 'base64url').toString());
    for (const verb of ['read', 'write', 'create', 'update', 'delete']) {
      ok(`a signed-in user's token carries beigeboard:${verb}`,
        (claims.scope || []).includes(`beigeboard:${verb}`), JSON.stringify(claims.scope));
    }
  }

  db.close();
} catch (e) {
  fail++;
  console.error('unhandled:', e);
}
done();
