// TEST-2 · Auth lifecycle harness — the root-of-everything tester.
//
//   node apps/jkauth/test/lifecycle.mjs
//
// Extends the smoke's coverage into the parts the rest of the suite's authorization
// stands on: it boots a REAL jkAuth (in-process RSA keypair, throwaway DB) and then
// drives tokens minted by the REAL routes through the REAL weave verify → write-gate
// chain (@jkos/weave/server) — the exact code every backend runs — plus the Python
// verifier (jkos-deploy/jkos_auth.py), so node↔python behavioural parity (the
// numeric-sub incident class) is pinned on tokens minted the way production mints them,
// not a hand-shaped stand-in.
//
// Covers: cookie flags on login · access token is a string-sub RS256 JWT that BOTH
// verifiers accept · silent refresh issues a fresh access token + rotates the refresh ·
// expiry is enforced (an expired JWT is rejected) · guest → READ_ONLY at the gate ·
// service-token mint → NO_USER_CONTEXT at the gate · on-behalf-of delegation → the
// write lands as the acting user · a non-delegation client cannot delegate.

import { spawn, spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { weaveAuth, weaveWriteGate, verifyToken, CODES } from '@jkos/weave/server';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER = join(__dirname, '..', 'server.js');
const repoRoot = join(__dirname, '..', '..', '..');
const deployDir = join(repoRoot, 'jkos-deploy');
const ISSUER = 'jkos-auth';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; } else { fail++; console.error(`  ✗ ${name}  ${extra}`); } };
const decode = (t) => JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString());

// ── Boot a jkAuth with service clients + one delegation-enrolled client ──────────
const tmp = mkdtempSync(join(tmpdir(), 'jkauth-lifecycle-'));
const port = 3400 + Math.floor(Math.random() * 1500);
const base = `http://127.0.0.1:${port}`;
const jar = new Map();
let serverLog = '';
const child = spawn(process.execPath, [SERVER], {
  env: {
    ...process.env,
    PORT: String(port),
    DB_PATH: join(tmp, 'auth.db'),
    JKOS_AUTH_PRIVATE_KEY: privateKey,
    JKOS_AUTH_PUBLIC_KEY: publicKey,
    COOKIE_DOMAIN: 'localhost',
    AUTH_ORIGIN: base,
    PORTAL_URL: base,
    NODE_ENV: 'test',
    GUEST_PASSWORD: 'guestpass123',
    // Two service clients; only 'prober' may act on-behalf-of a user.
    JKOS_SERVICE_CLIENTS: 'prober:probersecret:beigeboard:write,plain:plainsecret:beigeboard:write',
    JKOS_DELEGATION_CLIENTS: 'prober',
    RL_CREDENTIALS: '1000', RL_REFRESH: '1000', RL_GOOGLE: '1000',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', (d) => { serverLog += d; });
child.stderr.on('data', (d) => { serverLog += d; });

function foldCookies(res) {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const pair = c.split(';')[0];
    const i = pair.indexOf('=');
    const name = pair.slice(0, i).trim(), val = pair.slice(i + 1).trim();
    if (val === '') jar.delete(name); else jar.set(name, val);
  }
}
const cookieHeader = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
async function api(method, path, { json, cookie, noStore } = {}) {
  const h = {};
  if (cookie !== undefined) h.Cookie = cookie;
  else if (jar.size) h.Cookie = cookieHeader();
  let body;
  if (json !== undefined) { h['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  const res = await fetch(base + path, { method, headers: h, body, redirect: 'manual' });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  if (!noStore) foldCookies(res);
  let data = null; try { data = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, json: data, setCookie };
}
async function ready(tries = 60) {
  for (let i = 0; i < tries; i++) {
    try { if ((await fetch(base + '/health')).ok) return true; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}
function done(code) {
  try { child.kill('SIGKILL'); } catch { /* gone */ }
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
  console.log(`\nlifecycle: ${pass} passed, ${fail} failed`);
  process.exit(code ?? (fail ? 1 : 0));
}

// Drive the REAL identity gate + write gate over a token, the way a backend does.
// Resolves { blocked, code, user } — blocked=true means the write was refused.
function driveGate(token, { scope } = {}) {
  return new Promise((resolve) => {
    const req = { method: 'POST', headers: { authorization: `Bearer ${token}` }, cookies: {}, path: '/x' };
    const res = {
      _s: 200,
      status(c) { this._s = c; return this; },
      json(b) { resolve({ blocked: true, status: this._s, code: b?.code, user: req.user }); return this; },
      set() { return this; }, send() { resolve({ blocked: true, status: this._s, user: req.user }); return this; },
    };
    const auth = weaveAuth({ publicKey, issuer: ISSUER });
    const gate = weaveWriteGate(scope ? { scope } : {});
    auth(req, res, (err) => {
      if (err) { resolve({ blocked: true, error: String(err), user: req.user }); return; }
      gate(req, res, () => resolve({ blocked: false, user: req.user }));
    });
  });
}

try {
  if (!(await ready())) { console.error('jkAuth never became healthy:\n' + serverLog); done(1); }

  // ── 1. register → cookie flags + string-sub RS256 access token ────────────────
  const reg = await api('POST', '/auth/register', { json: { email: 'root@jkos.net', name: 'Root', password: 'password123' } });
  ok('register → 201 admin', reg.status === 201 && reg.json?.user?.role === 'admin', `${reg.status} ${JSON.stringify(reg.json?.user)}`);
  const tokCookie = reg.setCookie.find((c) => c.startsWith('jkos_token='));
  const refCookie = reg.setCookie.find((c) => c.startsWith('jkos_refresh='));
  ok('access cookie is HttpOnly + SameSite + Path=/', /HttpOnly/i.test(tokCookie || '') && /SameSite/i.test(tokCookie || '') && /Path=\//i.test(tokCookie || ''), tokCookie);
  ok('refresh cookie is HttpOnly', /HttpOnly/i.test(refCookie || ''), refCookie);
  const userTok = jar.get('jkos_token');
  const uc = decode(userTok);
  ok('access sub is a string (RFC 7519, the numeric-sub trap)', typeof uc.sub === 'string', JSON.stringify(uc.sub));
  ok('node weave verifier accepts the real access token', (() => { try { return verifyToken(userTok, { publicKey, issuer: ISSUER }).sub === uc.sub; } catch { return false; } })());
  const userId = uc.sub;

  // ── 2. silent refresh re-issues an access token + rotates the refresh ─────────
  //     (the access JWT can be byte-identical to the last one when both are minted in
  //     the same second — same claims + second-resolution iat — so we assert the
  //     MECHANISM: a fresh access cookie is set, the refresh rotates, the token verifies.)
  const beforeRef = jar.get('jkos_refresh');
  const refreshed = await api('POST', '/auth/refresh');
  const newTok = jar.get('jkos_token');
  ok('refresh → 200', refreshed.status === 200, `${refreshed.status}`);
  ok('silent refresh re-issued an access token cookie', refreshed.setCookie.some((c) => c.startsWith('jkos_token=')));
  ok('refresh token rotated', jar.get('jkos_refresh') && jar.get('jkos_refresh') !== beforeRef);
  ok('the refreshed access token verifies', (() => { try { return !!verifyToken(newTok, { publicKey, issuer: ISSUER }); } catch { return false; } })());

  // ── 3. expiry is enforced — an expired access token is rejected ───────────────
  const expired = jwt.sign({ sub: String(userId), email: 'root@jkos.net', role: 'admin', scope: [] }, privateKey,
    { algorithm: 'RS256', issuer: ISSUER, keyid: '1', expiresIn: '-1m' });
  let expiryEnforced = false;
  try { verifyToken(expired, { publicKey, issuer: ISSUER }); } catch (e) { expiryEnforced = e?.name === 'TokenExpiredError'; }
  ok('an expired access token is rejected (TokenExpiredError)', expiryEnforced);
  const meExpired = await api('GET', '/auth/me', { cookie: `jkos_token=${expired}`, noStore: true });
  ok('GET /auth/me with only an expired token → 401', meExpired.status === 401, `${meExpired.status}`);

  // ── 4. guest → READ_ONLY at the write gate ────────────────────────────────────
  const guestReg = await api('POST', '/auth/guest', { json: {}, noStore: true });
  const guestTok = (guestReg.setCookie.find((c) => c.startsWith('jkos_token=')) || '').split(';')[0].split('=')[1];
  ok('guest login issued a token', !!guestTok && decode(guestTok).role === 'guest', JSON.stringify(guestTok ? decode(guestTok).role : null));
  const guestGate = await driveGate(guestTok, { scope: 'beigeboard:write' });
  ok('guest write → blocked READ_ONLY', guestGate.blocked && guestGate.code === CODES.READ_ONLY, JSON.stringify(guestGate));

  // ── 5. a human write passes the guest/service gates ───────────────────────────
  const humanGate = await driveGate(userTok, {});
  ok('a real user write is NOT blocked by the role/service gates', humanGate.blocked === false, JSON.stringify(humanGate));

  // ── 6. service-token mint → NO_USER_CONTEXT at the write gate ──────────────────
  const svc = await api('POST', '/auth/token', { json: { client_id: 'prober', client_secret: 'probersecret', scope: 'beigeboard:write' }, noStore: true });
  ok('service token minted → 200', svc.status === 200 && !!svc.json?.access_token, `${svc.status} ${JSON.stringify(svc.json)}`);
  const svcTok = svc.json.access_token;
  const sc = decode(svcTok);
  ok('service token is typ:service, sub svc:<id>, no human sub, carries scope', sc.typ === 'service' && sc.sub === 'svc:prober' && !sc.email && Array.isArray(sc.scope) && sc.scope.includes('beigeboard:write'), JSON.stringify(sc));
  ok('a NORMAL service token carries no act claim', sc.act === undefined);
  const svcGate = await driveGate(svcTok, { scope: 'beigeboard:write' });
  ok('service write → blocked NO_USER_CONTEXT', svcGate.blocked && svcGate.code === CODES.NO_USER_CONTEXT, JSON.stringify(svcGate));

  // ── 7. on-behalf-of delegation → the write lands as the ACTING user ───────────
  const del = await api('POST', '/auth/token', { json: { client_id: 'prober', client_secret: 'probersecret', scope: 'beigeboard:write', on_behalf_of: userId }, noStore: true });
  ok('delegated token minted → 200', del.status === 200 && !!del.json?.access_token, `${del.status} ${JSON.stringify(del.json)}`);
  const delTok = del.json.access_token;
  const dc = decode(delTok);
  ok('delegated token stays typ:service but carries act=<userId>', dc.typ === 'service' && dc.act === String(userId), JSON.stringify(dc));
  const delGate = await driveGate(delTok, { scope: 'beigeboard:write' });
  ok('delegated write is NOT blocked', delGate.blocked === false, JSON.stringify(delGate));
  ok('the gate normalized the effective user to the acting user', delGate.user?.sub === String(userId) && delGate.user?.delegated === true && delGate.user?.svc === 'svc:prober', JSON.stringify(delGate.user));

  // ── 8. a non-delegation client cannot act on-behalf-of ────────────────────────
  const denied = await api('POST', '/auth/token', { json: { client_id: 'plain', client_secret: 'plainsecret', scope: 'beigeboard:write', on_behalf_of: userId }, noStore: true });
  ok('non-delegation client on_behalf_of → 403 NO_DELEGATION', denied.status === 403 && denied.json?.code === 'NO_DELEGATION', `${denied.status} ${JSON.stringify(denied.json)}`);

  // ── 9. cross-runtime: the SAME real tokens verify in python-jose (jkos_auth.py)
  //     The numeric-sub class — this is the runtime that 401'd /deploy. Fail (not
  //     skip) if jose is unimportable, unless CONTRACTS_SKIP_PYTHON=1.
  const PY = process.env.CONTRACTS_PYTHON || 'python3';
  const probe = spawnSync(PY, ['-c', 'import jose'], { encoding: 'utf8' });
  if (probe.status !== 0) {
    if (process.env.CONTRACTS_SKIP_PYTHON === '1') {
      console.log("  ⚠ SKIPPED python cross-verify — jose unimportable (CONTRACTS_SKIP_PYTHON=1).");
    } else {
      console.error(`\n✗ lifecycle: '${PY}' cannot import python-jose — the runtime that looped /deploy.\n` +
        `  Install python-jose or point CONTRACTS_PYTHON at a venv that has it (CONTRACTS_SKIP_PYTHON=1 to bypass).`);
      done(1);
    }
  } else {
    const keyFile = join(tmp, 'pub.pem'); writeFileSync(keyFile, publicKey);
    const uFile = join(tmp, 'user.txt'); writeFileSync(uFile, userTok);
    const sFile = join(tmp, 'svc.txt'); writeFileSync(sFile, svcTok);
    const dFile = join(tmp, 'del.txt'); writeFileSync(dFile, delTok);
    const pyScript = `
import os, sys
os.environ['JKOS_AUTH_PUBLIC_KEY'] = open(sys.argv[2]).read()
os.environ['JKOS_AUTH_ISSUER'] = '${ISSUER}'
sys.path.insert(0, sys.argv[1])
import jkos_auth
u = jkos_auth.verify_token(open(sys.argv[3]).read())
assert isinstance(u['sub'], str), 'python got non-string sub: %r' % (u['sub'],)
assert u['role'] == 'admin', u
s = jkos_auth.verify_token(open(sys.argv[4]).read())
assert s['sub'].startswith('svc:') and s.get('typ') == 'service', s
d = jkos_auth.verify_token(open(sys.argv[5]).read())
assert d.get('act') == u['sub'], d
print('PYOK', u['sub'], s['sub'])
`;
    const r = spawnSync(PY, ['-c', pyScript, deployDir, keyFile, uFile, sFile, dFile], { encoding: 'utf8' });
    ok('python-jose (jkos_auth.py) accepts the SAME real user/service/delegated tokens', r.status === 0 && /^PYOK /m.test(r.stdout || ''), (r.stderr || r.stdout || '').trim());
  }

  done();
} catch (e) {
  console.error('lifecycle harness error:', e);
  fail++;
  done(1);
}
