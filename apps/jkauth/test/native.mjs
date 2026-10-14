// TEST-6 · Native sign-in (routes/native.js) — PKCE, single-use codes, transport-bound
// sessions, and the staging gate's Bearer path.
//
//   node apps/jkauth/test/native.mjs
//
// A native app (KourOS Alpha) signs in through a Custom Tab and keeps its tokens itself.
// Every control below is one that would fail SILENTLY if it went missing — sign-in would
// still "work", for the app and for whoever else had the code or the token:
//   A  an unknown client, a redirect URI that is not the registered one, a client of the
//      other environment, or a request without S256 PKCE gets a dead end — never a redirect
//   B  signing in round-trips back to the exact authorize request; the consent page names
//      the account and lets the app's scheme through form-action (Chrome enforces it on the
//      302, so without it the code is minted and never delivered)
//   C  the consent ticket is bound to the person and the request: tampered, cross-user or
//      cookie-less posts are refused; Cancel returns access_denied with the state
//   D  a code is redeemed once, only with its verifier, client and redirect URI; a wrong
//      verifier spends it; an expired one is dead; a replay burns what it minted
//   E  refresh rotates; a benign race is 409 REFRESH_RACE; a replay past the grace window
//      burns the family
//   F  the TRANSPORT binding: a native refresh token is no cookie, a cookie is no native
//      refresh token, and the database refuses to rewrite either (migration 024's triggers)
//   G  the staging gate (/auth/require-admin) takes a Bearer USER token — an admin's passes,
//      a user's is 403, a service token or garbage is 401
//   H  revoke signs the app out (always 200); the trail is in auth_events
//   I  with JKOS_NATIVE_ENV unset, every /auth/native route is 404
//
// Boots the REAL server on a throwaway port + temp DB and drives it over real HTTP, like
// security.mjs.

import { generateKeyPairSync, createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { startServer, testPort } from '../../../test/lib/smoke.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER = join(__dirname, '..', 'server.js');
const CLIENTS = JSON.parse(readFileSync(join(__dirname, '..', 'src', 'native-clients.json'), 'utf8')).clients;
const STAGING = CLIENTS.find((c) => c.env === 'staging');
const PRODUCTION = CLIENTS.find((c) => c.env === 'production');

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; } else { fail++; console.error(`  ✗ ${name}  ${extra}`); } };
const section = (s) => console.log(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const tmp = mkdtempSync(join(tmpdir(), 'jkauth-native-'));
const DB_PATH = join(tmp, 'auth.db');
// A band no other jkAuth test uses (4300, 5500, 6100–7100 are taken).
const port = testPort(7300, 400);
const base = `http://127.0.0.1:${port}`;
const GRACE_MS = 400;
const CODE_TTL_MS = 1500;

const env = {
  DB_PATH,
  JKOS_AUTH_PRIVATE_KEY: privateKey, JKOS_AUTH_PUBLIC_KEY: publicKey,
  COOKIE_DOMAIN: 'localhost', AUTH_ORIGIN: base, PORTAL_URL: base,
  NODE_ENV: 'test',
  JKOS_NATIVE_ENV: 'staging',
  REFRESH_GRACE_MS: String(GRACE_MS),
  NATIVE_CODE_TTL_MS: String(CODE_TTL_MS),
  JKOS_SERVICE_CLIENTS: 'robot:robotsecret:auth:read',
  RL_CREDENTIALS: '10000', RL_REFRESH: '10000',
};
const server = startServer({ port, service: 'jkauth', args: [SERVER], env });

// ── a minimal browser: one cookie jar per person ─────────────────────────────
function browser() {
  const jar = new Map();
  const fold = (res) => {
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const pair = c.split(';')[0];
      const i = pair.indexOf('=');
      const name = pair.slice(0, i).trim(), val = pair.slice(i + 1).trim();
      if (val === '') jar.delete(name); else jar.set(name, val);
    }
  };
  return {
    jar,
    async req(method, path, { json, form, headers = {}, noCookies } = {}) {
      const h = { ...headers };
      if (!noCookies && jar.size) h.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
      let body;
      if (json !== undefined) { h['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
      if (form !== undefined) { h['Content-Type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(form).toString(); }
      const res = await fetch((path.startsWith('http') ? '' : base) + path, { method, headers: h, body, redirect: 'manual' });
      if (!noCookies) fold(res);
      const text = await res.text();
      let data = null; try { data = JSON.parse(text); } catch { /* HTML */ }
      return { status: res.status, json: data, text, location: res.headers.get('location'), csp: res.headers.get('content-security-policy') || '' };
    },
  };
}
const app = browser();   // the native app's own HTTP client — never holds a cookie
const api = (path, json, headers) => app.req('POST', path, { json, headers, noCookies: true });

// ── PKCE, as the app does it ──────────────────────────────────────────────────
const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function pkce() {
  const verifier = b64url(randomBytes(32));
  return { verifier, challenge: b64url(createHash('sha256').update(verifier).digest()), state: b64url(randomBytes(16)) };
}
function authorizePath(client, p, over = {}) {
  const q = new URLSearchParams({
    response_type: 'code', client_id: client.client_id, redirect_uri: client.redirect_uri,
    code_challenge: p.challenge, code_challenge_method: 'S256', state: p.state, ...over,
  });
  return `/auth/native/authorize?${q}`;
}
const consentOf = (html) => (/name="consent" value="([^"]+)"/.exec(html) || [])[1];
const paramsOf = (location) => new URL(location).searchParams;

/** Drive one person's browser from authorize to the app's redirect; returns { code, state, location }. */
async function signIn(person, p, decision = 'allow') {
  const page = await person.req('GET', authorizePath(STAGING, p));
  const consent = consentOf(page.text);
  const back = await person.req('POST', '/auth/native/authorize', { form: { consent, decision } });
  const q = back.location ? paramsOf(back.location) : new URLSearchParams();
  return { page, back, code: q.get('code'), state: q.get('state'), error: q.get('error') };
}
const exchange = (code, verifier, over = {}) => api('/auth/native/token', {
  grant_type: 'authorization_code', code, code_verifier: verifier,
  client_id: STAGING.client_id, redirect_uri: STAGING.redirect_uri, ...over,
});
const refresh = (token, over = {}) => api('/auth/native/token', {
  grant_type: 'refresh_token', refresh_token: token, client_id: STAGING.client_id, ...over,
});
const claims = (jwt) => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
const db = () => new Database(DB_PATH);

function done(extra) {
  server.stop();
  extra?.stop?.();
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
  if (fail && server.log()) console.error('\n── server log ──\n' + server.log());
  console.log(`\nnative: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

let off = null;
try {
  const up = await server.ready();
  if (!up.ok) {
    fail++;
    console.error(`jkAuth never became healthy — ${up.why}:\n` + server.log());
    done();
  }
  ok('native-clients.json lists a staging and a production client', !!STAGING && !!PRODUCTION
    && STAGING.redirect_uri === `${STAGING.client_id}:/oauth2redirect`);

  // Two people: the first registration is the admin, the second an ordinary user.
  const admin = browser(), user = browser();
  ok('admin registers', (await admin.req('POST', '/auth/register', { json: { email: 'admin@native.test', password: 'native-admin-pw' } })).status === 201);
  ok('user registers', (await user.req('POST', '/auth/register', { json: { email: 'user@native.test', password: 'native-user-pw' } })).status === 201);

  // ── A · refusals are dead ends ──────────────────────────────────────────────
  section('A · refused requests never redirect');
  const p0 = pkce();
  for (const [what, path] of [
    ['an unknown client', authorizePath({ client_id: 'net.evil.app', redirect_uri: 'net.evil.app:/oauth2redirect' }, p0)],
    ['a redirect URI that is not the registered one', authorizePath(STAGING, p0, { redirect_uri: 'https://evil.example/cb' })],
    ['a registered scheme with another path', authorizePath(STAGING, p0, { redirect_uri: STAGING.client_id + ':/elsewhere' })],
    ["the other environment's client", authorizePath(PRODUCTION, p0)],
    ['no PKCE', authorizePath(STAGING, p0, { code_challenge: '' })],
    ['PKCE plain', authorizePath(STAGING, p0, { code_challenge_method: 'plain' })],
    ['response_type=token', authorizePath(STAGING, p0, { response_type: 'token' })],
    ['no state', authorizePath(STAGING, p0, { state: '' })],
  ]) {
    const r = await admin.req('GET', path);
    ok(`${what} → 400, no Location`, r.status === 400 && !r.location, `got ${r.status} ${r.location || ''}`);
  }

  // ── B · sign-in round trip + consent page ───────────────────────────────────
  section('B · the round trip and the consent page');
  const anon = browser();
  const p1 = pkce();
  const bounce = await anon.req('GET', authorizePath(STAGING, p1));
  const loginTo = bounce.location ? new URL(bounce.location, base).searchParams.get('redirect_to') : null;
  ok('signed out → 302 to the login page, carrying the exact authorize URL',
    bounce.status === 302 && loginTo === base + authorizePath(STAGING, p1), `${bounce.status} ${bounce.location}`);
  // Sign in through the form (as the Custom Tab would) and land back on the request.
  const login = await anon.req('POST', '/auth/login', { form: { email: 'admin@native.test', password: 'native-admin-pw', remember_me: '1', redirect_to: loginTo } });
  ok('the login form returns to the authorize request', login.status === 302 && login.location === loginTo, `${login.status} ${login.location}`);
  const page = await anon.req('GET', login.location);
  ok('consent page renders for the signed-in account', page.status === 200 && page.text.includes('admin@native.test') && !!consentOf(page.text));
  ok('consent page names the app from jkAuth\'s own list', page.text.includes(STAGING.name));
  const scheme = STAGING.redirect_uri.split(':')[0];
  ok("consent page's form-action admits the app's scheme (and only adds that)",
    page.csp.includes(`form-action 'self' ${scheme}:`) && !/form-action[^;]*https?:/.test(page.csp), page.csp);
  const plainCsp = (await anon.req('GET', '/auth/login')).csp;
  ok("every other page keeps form-action 'self' alone", /form-action 'self';/.test(plainCsp), plainCsp);

  // ── C · the consent ticket ──────────────────────────────────────────────────
  section('C · consent is bound to the person and the request');
  const pc = pkce();
  const cpage = await admin.req('GET', authorizePath(STAGING, pc));
  const ticket = consentOf(cpage.text);
  const parts = ticket.split('.');
  const forged = [parts[0], Buffer.from(JSON.stringify({ ...claims(ticket), ruri: 'https://evil.example/cb' })).toString('base64url'), parts[2]].join('.');
  ok('a tampered ticket → 400', (await admin.req('POST', '/auth/native/authorize', { form: { consent: forged, decision: 'allow' } })).status === 400);
  ok('a ticket posted with no session cookie → 400 (cross-site POSTs carry none)',
    (await admin.req('POST', '/auth/native/authorize', { form: { consent: ticket, decision: 'allow' }, noCookies: true })).status === 400);
  ok("another person's session cannot spend the admin's ticket",
    (await user.req('POST', '/auth/native/authorize', { form: { consent: ticket, decision: 'allow' } })).status === 400);
  const deny = await admin.req('POST', '/auth/native/authorize', { form: { consent: ticket, decision: 'deny' } });
  const dq = deny.location ? paramsOf(deny.location) : null;
  ok('Cancel → back to the app with access_denied and the state, no code',
    deny.status === 302 && deny.location.startsWith(STAGING.redirect_uri + '?') && dq.get('error') === 'access_denied'
      && dq.get('state') === pc.state && !dq.get('code'), deny.location);

  // ── D · codes ───────────────────────────────────────────────────────────────
  section('D · a code is single-use, verifier-bound, short-lived');
  const p2 = pkce();
  const s2 = await signIn(admin, p2);
  ok('Allow → back to the registered redirect with a code and the same state',
    s2.back.status === 302 && s2.back.location.startsWith(STAGING.redirect_uri + '?') && /^[A-Za-z0-9_-]{43}$/.test(s2.code || '') && s2.state === p2.state, s2.back.location);
  const stored = db().prepare('SELECT * FROM native_auth_codes').all();
  ok('the code is stored only as its hash', stored.length === 1 && stored[0].code_hash !== s2.code && !JSON.stringify(stored).includes(s2.code));
  const wrongV = await exchange(s2.code, pkce().verifier);
  ok('a wrong verifier → invalid_grant', wrongV.status === 400 && wrongV.json?.error === 'invalid_grant');
  ok('…and it SPENT the code: the right verifier is now refused too', (await exchange(s2.code, p2.verifier)).json?.error === 'invalid_grant');

  const p3 = pkce();
  const s3 = await signIn(admin, p3);
  ok('another client id at the token endpoint → 401 invalid_client', (await exchange(s3.code, p3.verifier, { client_id: PRODUCTION.client_id })).status === 401);
  ok('a mismatched redirect_uri → invalid_grant', (await exchange(s3.code, p3.verifier, { redirect_uri: STAGING.client_id + ':/x' })).json?.error === 'invalid_grant');

  const p4 = pkce();
  const s4 = await signIn(admin, p4);
  const t4 = await exchange(s4.code, p4.verifier);
  ok('the right code + verifier → 200 with a token pair', t4.status === 200 && t4.json?.token_type === 'Bearer'
    && t4.json.expires_in === 900 && /^[0-9a-f]{128}$/.test(t4.json.refresh_token || '') && t4.json.user?.email === 'admin@native.test', JSON.stringify(t4.json));
  const c4 = claims(t4.json.access_token);
  ok("the access token is the suite's user token, minted for KourOS", c4.sub === String(t4.json.user.id)
    && c4.azp === STAGING.app && [].concat(c4.aud).includes('kouros') && c4.typ === undefined, JSON.stringify(c4));
  const row4 = db().prepare('SELECT * FROM sessions WHERE token_hash=?').get(createHash('sha256').update(t4.json.refresh_token).digest('hex'));
  ok('the session row is bound to the client (client_id) and remembered', row4?.client_id === STAGING.client_id && row4.remember_me === 1);
  const replay = await exchange(s4.code, p4.verifier);
  ok('a replayed code → invalid_grant', replay.json?.error === 'invalid_grant');
  ok('…and it BURNED the session the first redemption minted', (await refresh(t4.json.refresh_token)).json?.error === 'invalid_grant'
    && db().prepare("SELECT COUNT(*) AS c FROM sessions WHERE family_id=? AND revoked_reason='code_reuse'").get(row4.family_id).c >= 1);

  const p5 = pkce();
  const s5 = await signIn(admin, p5);
  await sleep(CODE_TTL_MS + 200);
  ok('an expired code → invalid_grant', (await exchange(s5.code, p5.verifier)).json?.error === 'invalid_grant');

  // ── E · refresh ─────────────────────────────────────────────────────────────
  section('E · refresh rotates, races and reuse');
  const p6 = pkce();
  const t6 = (await exchange((await signIn(admin, p6)).code, p6.verifier)).json;
  const r1 = await refresh(t6.refresh_token);
  ok('refresh → a new pair', r1.status === 200 && r1.json.refresh_token && r1.json.refresh_token !== t6.refresh_token && r1.json.access_token);
  const race = await refresh(t6.refresh_token);
  ok('the old token again inside the grace window → 409 REFRESH_RACE', race.status === 409 && race.json?.code === 'REFRESH_RACE', JSON.stringify(race.json));
  const r2 = await refresh(r1.json.refresh_token);
  ok('the new token keeps working', r2.status === 200);
  await sleep(GRACE_MS + 150);
  const theft = await refresh(r1.json.refresh_token);
  ok('a spent token past the grace window → invalid_grant', theft.status === 400 && theft.json?.error === 'invalid_grant');
  ok('…and the whole family is burned (the live token dies with it)', (await refresh(r2.json.refresh_token)).json?.error === 'invalid_grant');
  ok('refresh with an unknown client → 401', (await refresh('x', { client_id: 'net.evil.app' })).status === 401);
  ok('an unknown grant type → 400 unsupported_grant_type', (await api('/auth/native/token', { grant_type: 'password', client_id: STAGING.client_id })).json?.error === 'unsupported_grant_type');

  // ── F · transport binding ───────────────────────────────────────────────────
  section('F · a native token is no cookie; a cookie is no native token');
  const p7 = pkce();
  const t7 = (await exchange((await signIn(admin, p7)).code, p7.verifier)).json;
  const asCookie = await app.req('POST', '/auth/refresh', { headers: { Cookie: `jkos_refresh=${t7.refresh_token}` }, noCookies: true });
  ok("a native refresh token presented as the browser's cookie → 401", asCookie.status === 401, `${asCookie.status}`);
  const t7b = await refresh(t7.refresh_token);
  ok('…and it was NOT consumed (the app can still refresh)', t7b.status === 200);
  // The LIVE token (t7's was just rotated, and a rotated token proves nothing here).
  const gateByCookie = await app.req('GET', '/auth/require-admin', { headers: { Cookie: `jkos_refresh=${t7b.json.refresh_token}` }, noCookies: true });
  ok("a native refresh token is not a session the gate's cookie fallback accepts", gateByCookie.status === 401);
  const browserRefresh = admin.jar.get('jkos_refresh');
  ok("the browser's refresh cookie at the native token endpoint → invalid_grant", (await refresh(browserRefresh)).json?.error === 'invalid_grant');
  ok("…and the browser's session survives that", (await admin.req('POST', '/auth/refresh')).status === 200);
  const d = db();
  let threw = null;
  try { d.prepare('UPDATE sessions SET client_id=NULL WHERE client_id IS NOT NULL').run(); } catch (e) { threw = e.message; }
  ok('the database refuses to change a session\'s transport (trigger)', /never changes transport/.test(threw || ''), threw);
  threw = null;
  try { d.prepare("UPDATE native_auth_codes SET used_at='2000-01-01T00:00:00.000Z' WHERE used_at IS NOT NULL").run(); } catch (e) { threw = e.message; }
  ok('the database refuses to re-stamp a redeemed code (trigger)', /redeemed at most once/.test(threw || ''), threw);
  d.close();

  // ── G · the staging gate's Bearer path ──────────────────────────────────────
  section('G · /auth/require-admin takes a Bearer user token');
  const p8 = pkce();
  const t8 = (await exchange((await signIn(admin, p8)).code, p8.verifier)).json;
  const bearer = (tok) => app.req('GET', '/auth/require-admin', { headers: { Authorization: `Bearer ${tok}` }, noCookies: true });
  ok("an admin's native access token passes the gate", (await bearer(t8.access_token)).status === 200);
  const p9 = pkce();
  const t9 = (await exchange((await signIn(user, p9)).code, p9.verifier)).json;
  ok("a non-admin's native access token → 403", (await bearer(t9.access_token)).status === 403);
  const svc = await api('/auth/token', { client_id: 'robot', client_secret: 'robotsecret', scope: 'auth:read' });
  ok('a service token carrying aud auth is minted (the precondition)', svc.status === 200 && [].concat(claims(svc.json.access_token).aud).includes('auth'), JSON.stringify(svc.json));
  ok('…and a service token is not a person: the gate refuses it (401)', (await bearer(svc.json.access_token)).status === 401);
  ok('a garbage Bearer → 401', (await bearer('not.a.jwt')).status === 401);
  ok('a consent ticket is not an access token (401)', (await bearer(ticket)).status === 401);

  // ── H · revoke + audit trail ────────────────────────────────────────────────
  section('H · revoke, and the trail');
  ok('revoke → 200', (await api('/auth/native/revoke', { client_id: STAGING.client_id, token: t8.refresh_token })).status === 200);
  ok('…and the app is signed out', (await refresh(t8.refresh_token)).json?.error === 'invalid_grant');
  ok('revoking an unknown token is still 200 (RFC 7009)', (await api('/auth/native/revoke', { client_id: STAGING.client_id, token: 'nope' })).status === 200);
  ok('revoke with an unknown client → 401', (await api('/auth/native/revoke', { client_id: 'net.evil.app', token: t9.refresh_token })).status === 401);
  ok("a refresh token can't be revoked through another client", (await refresh(t9.refresh_token)).status === 200);
  const types = new Set(db().prepare('SELECT type FROM auth_events').all().map((r) => r.type));
  for (const t of ['native_authorize_refused', 'native_consent', 'native_consent_denied', 'native_code', 'native_token',
    'native_token_refused', 'native_code_reuse', 'refresh_reuse', 'refresh_wrong_transport', 'native_revoke']) {
    ok(`audited: ${t}`, types.has(t));
  }
  const devices = await admin.req('GET', '/auth/security');
  ok("the account's devices list names the app", devices.status === 200 && devices.text.includes(STAGING.client_id));

  // ── I · off unless configured ───────────────────────────────────────────────
  section('I · JKOS_NATIVE_ENV unset → native sign-in is off');
  const port2 = testPort(7300, 400);
  off = startServer({ port: port2 === port ? port + 1 : port2, service: 'jkauth', args: [SERVER],
    env: { ...env, JKOS_NATIVE_ENV: '', DB_PATH: join(tmp, 'off.db') } });
  const up2 = await off.ready();
  ok('the second server boots', up2.ok, up2.why);
  if (up2.ok) {
    const b2 = `http://127.0.0.1:${port2 === port ? port + 1 : port2}`;
    const g = await fetch(b2 + authorizePath(STAGING, pkce()), { redirect: 'manual' });
    const t = await fetch(b2 + '/auth/native/token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    ok('authorize and token both 404', g.status === 404 && t.status === 404, `${g.status} ${t.status}`);
  }
} catch (e) {
  fail++;
  console.error('  ✗ threw:', e);
}
done(off);
