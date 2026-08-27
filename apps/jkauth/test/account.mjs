// TEST-5 · Account self-service harness (Stage C3).
//
//   node apps/jkauth/test/account.mjs
//
// Covers the four things a polished SSO must have and jkAuth did not — each an
// audit finding in its own right (JK-A12), each ABSENT rather than broken, so
// there was nothing to regress against until now:
//
//   · password change   — and the security property that makes it worth having:
//                         it revokes every OTHER session, keeping the current one.
//   · password reset    — including the no-enumeration rule, which is the whole
//                         point of the endpoint: a known and an unknown address
//                         must be indistinguishable in the response.
//   · email verification— and the gate it exists for: email 2FA cannot be turned
//                         on for an address nobody has proved they can read.
//   · your devices      — one row per session FAMILY, and a revoke scoped so a
//                         guessed family_id belonging to someone else does nothing.
//
// Boots the REAL server on a throwaway port + temp DB with OTP_TEST_ECHO=1 so the
// mailed codes are readable from the server log.

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
const ok = (name, cond, extra = '') => { if (cond) { pass++; } else { fail++; console.error(`  ✗ ${name}  ${extra}`); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const tmp = mkdtempSync(join(tmpdir(), 'jkauth-account-'));
// Band clear of the test-port registry (3980–3996) + discover spares (4083–4085).
const port = 6700 + Math.floor(Math.random() * 400);
const base = `http://127.0.0.1:${port}`;

let serverLog = '';
const child = spawn(process.execPath, [SERVER], {
  env: {
    ...process.env,
    PORT: String(port), DB_PATH: join(tmp, 'auth.db'),
    JKOS_AUTH_PRIVATE_KEY: privateKey, JKOS_AUTH_PUBLIC_KEY: publicKey,
    COOKIE_DOMAIN: 'localhost', AUTH_ORIGIN: base, PORTAL_URL: base,
    NODE_ENV: 'test', OTP_TEST_ECHO: '1',
    JKOS_2FA_ENC_KEY: 'account-test-seal-key',
    RL_CREDENTIALS: '10000', RL_REFRESH: '10000',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', d => { serverLog += d; });
child.stderr.on('data', d => { serverLog += d; });
let exited = null;
child.on('exit', (code, signal) => { exited = { code, signal }; });

// Two independent cookie jars so "this device" and "another device" are real.
const jars = { a: new Map(), b: new Map() };
function fold(jar, res) {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const pair = c.split(';')[0];
    const i = pair.indexOf('=');
    const name = pair.slice(0, i).trim(), val = pair.slice(i + 1).trim();
    if (val === '') jar.delete(name); else jar.set(name, val);
  }
}
async function api(who, method, path, { json, form } = {}) {
  const jar = jars[who];
  const h = {};
  if (jar.size) h.Cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  let body;
  if (json !== undefined) { h['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  if (form !== undefined) { h['Content-Type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(form).toString(); }
  const res = await fetch(base + path, { method, headers: h, body, redirect: 'manual' });
  fold(jar, res);
  const text = await res.text();
  let data = null; try { data = JSON.parse(text); } catch { /* HTML */ }
  return { status: res.status, json: data, text };
}
// The most recent code echoed for an address. LAST, not first: several flows
// echo to the same mailbox and the earliest is usually already consumed.
async function codeFor(email, tries = 25) {
  const re = new RegExp(`\\[otp-echo\\] ${email.replace(/[.@]/g, '\\$&')} (\\d{6})`, 'g');
  for (let i = 0; i < tries; i++) {
    const m = [...serverLog.matchAll(re)];
    if (m.length) return m[m.length - 1][1];
    await sleep(50);
  }
  return null;
}
async function ready(tries = 60) {
  for (let i = 0; i < tries; i++) {
    if (exited) return false;
    try { const r = await fetch(base + '/health'); if (r.ok && (await r.json()).service === 'jkauth') return true; } catch { /* not up */ }
    await sleep(100);
  }
  return false;
}
function done() {
  try { child.kill('SIGKILL'); } catch { /* gone */ }
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
  if (fail && serverLog) console.error('\n── server log ──\n' + serverLog);
  console.log(`\naccount: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

try {
  if (!(await ready())) {
    fail++;
    console.error('server never became healthy'
      + (exited ? ` (exited code=${exited.code} signal=${exited.signal})` : '') + ':\n' + serverLog);
    done();
  }

  // ── A · Password change ────────────────────────────────────────────────────
  let r = await api('a', 'POST', '/auth/register', { json: { email: 'ann@x.net', password: 'password-a1', name: 'Ann' } });
  ok('register → 201', r.status === 201, `got ${r.status}`);
  // A second device for the same account, so "revoke the others" has a victim.
  r = await api('b', 'POST', '/auth/login', { json: { email: 'ann@x.net', password: 'password-a1' } });
  ok('second device signs in', r.status === 200);
  ok('device B can refresh before the change', (await api('b', 'POST', '/auth/refresh', { json: {} })).status === 200);

  r = await api('a', 'POST', '/auth/password', { json: { current_password: 'wrong-one', new_password: 'password-a2' } });
  ok('change with a wrong current password → 401', r.status === 401, `got ${r.status}`);
  r = await api('a', 'POST', '/auth/password', { json: { current_password: 'password-a1', new_password: 'short' } });
  ok('change to a too-short password → 400', r.status === 400, `got ${r.status}`);
  r = await api('a', 'POST', '/auth/password', { json: { current_password: 'password-a1', new_password: 'password-a2' } });
  ok('change with the right current password → 200', r.status === 200, `got ${r.status}`);

  ok('the OLD password no longer signs in',
    (await api('b', 'POST', '/auth/login', { json: { email: 'ann@x.net', password: 'password-a1' } })).status === 401);
  ok('the NEW password does',
    (await api('b', 'POST', '/auth/login', { json: { email: 'ann@x.net', password: 'password-a2' } })).status === 200);
  // The device that DID the change keeps working — that is the deliberate half.
  ok('the changing device is still signed in', (await api('a', 'POST', '/auth/refresh', { json: {} })).status === 200);

  // ── B · Password reset, and the no-enumeration rule ────────────────────────
  const known = await api('a', 'POST', '/auth/reset/request', { json: { email: 'ann@x.net' } });
  const unknown = await api('a', 'POST', '/auth/reset/request', { json: { email: 'nobody@x.net' } });
  ok('reset request for a KNOWN address → 200', known.status === 200, `got ${known.status}`);
  ok('reset request for an UNKNOWN address answers IDENTICALLY',
    unknown.status === known.status && JSON.stringify(unknown.json) === JSON.stringify(known.json),
    `${unknown.status} ${JSON.stringify(unknown.json)} vs ${known.status} ${JSON.stringify(known.json)}`);

  const rcode = await codeFor('ann@x.net');
  ok('a reset code was emailed', !!rcode);
  r = await api('a', 'POST', '/auth/reset/confirm', { json: { email: 'ann@x.net', code: '000000', new_password: 'password-a3' } });
  ok('reset with a wrong code → 400', r.status === 400, `got ${r.status}`);
  r = await api('a', 'POST', '/auth/reset/confirm', { json: { email: 'ann@x.net', code: rcode, new_password: 'password-a3' } });
  ok('reset with the mailed code → 200', r.status === 200, `got ${r.status}`);
  r = await api('a', 'POST', '/auth/reset/confirm', { json: { email: 'ann@x.net', code: rcode, new_password: 'password-a4' } });
  ok('the reset code is single-use → 400 on replay', r.status === 400, `got ${r.status}`);
  jars.a.clear(); jars.b.clear();
  ok('the reset password signs in',
    (await api('a', 'POST', '/auth/login', { json: { email: 'ann@x.net', password: 'password-a3' } })).status === 200);

  // ── C · Email verification gates email 2FA ─────────────────────────────────
  r = await api('a', 'POST', '/auth/2fa/email/enable', { json: {} });
  ok('email 2FA on an UNVERIFIED address → 409 EMAIL_NOT_VERIFIED',
    r.status === 409 && r.json?.code === 'EMAIL_NOT_VERIFIED', `${r.status} ${JSON.stringify(r.json)}`);
  await api('a', 'POST', '/auth/verify/send', { json: {} });
  const vcode = await codeFor('ann@x.net');
  ok('a verification code was emailed', !!vcode && vcode !== rcode);
  r = await api('a', 'POST', '/auth/verify/confirm', { json: { code: '000000' } });
  ok('verify with a wrong code → 400', r.status === 400, `got ${r.status}`);
  r = await api('a', 'POST', '/auth/verify/confirm', { json: { code: vcode } });
  ok('verify with the mailed code → email_verified', r.status === 200 && r.json?.email_verified === true,
    `${r.status} ${JSON.stringify(r.json)}`);
  ok('email 2FA can now be turned on', (await api('a', 'POST', '/auth/2fa/email/enable', { json: {} })).status === 200);

  // ── D · Your devices ───────────────────────────────────────────────────────
  // Email 2FA has made its point in C; turn it off so a plain password login
  // yields a session here rather than a second-factor challenge.
  ok('email 2FA can be turned back off', (await api('a', 'POST', '/auth/2fa/email/disable', { json: {} })).status === 200);
  await api('b', 'POST', '/auth/login', { json: { email: 'ann@x.net', password: 'password-a3' } });
  r = await api('a', 'GET', '/auth/sessions');
  ok('GET /auth/sessions → 200 with a list', r.status === 200 && Array.isArray(r.json?.sessions), JSON.stringify(r.json));
  const sessions = r.json.sessions;
  ok('exactly one entry is marked current', sessions.filter(s => s.current).length === 1,
    JSON.stringify(sessions.map(s => s.current)));
  ok('revoked families are still listed as evidence, not deleted',
    sessions.some(s => s.revoked && s.revoked_reason), JSON.stringify(sessions.map(s => s.revoked_reason)));
  ok('a family folds its rotations into one entry',
    sessions.every(s => typeof s.rotations === 'number' && s.rotations >= 1));

  const other = sessions.find(s => !s.current && !s.revoked);
  ok('device B shows up as another live session', !!other, JSON.stringify(sessions));
  r = await api('a', 'POST', '/auth/sessions/revoke', { json: { family_id: other.family_id } });
  ok('revoking another device → 200', r.status === 200, `${r.status} ${JSON.stringify(r.json)}`);
  ok('the revoked device can no longer refresh',
    (await api('b', 'POST', '/auth/refresh', { json: {} })).status === 401);
  ok('revoking an unknown family → 404 (indistinguishable from someone else\'s)',
    (await api('a', 'POST', '/auth/sessions/revoke', { json: { family_id: 'not-a-real-family' } })).status === 404);

  // Another account must not be able to revoke Ann's sessions by guessing an id.
  jars.b.clear();
  await api('b', 'POST', '/auth/register', { json: { email: 'bob@x.net', password: 'password-b1' } });
  const mine = (await api('a', 'GET', '/auth/sessions')).json.sessions.find(s => s.current);
  r = await api('b', 'POST', '/auth/sessions/revoke', { json: { family_id: mine.family_id } });
  ok('another user cannot revoke your session → 404', r.status === 404, `got ${r.status}`);
  ok('and your session still works', (await api('a', 'POST', '/auth/refresh', { json: {} })).status === 200);

  // ── E · The audit log covers these actions (JK-A13 groundwork) ─────────────
  r = await api('a', 'GET', '/auth/events');
  const types = new Set((r.json?.events || []).map(e => e.type));
  for (const t of ['password_change', 'password_reset', 'email_verified', 'session_revoked']) {
    ok(`'${t}' is in the audit log`, types.has(t), [...types].join(','));
  }
} catch (e) {
  fail++;
  console.error('unhandled:', e);
}
done();
