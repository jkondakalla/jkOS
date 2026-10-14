// Native app sign-in harness — RFC 8252 + PKCE (routes/native.js, tokens.js "the native
// transport", migration 024).
//
//   node apps/jkauth/test/native.mjs
//
// A native app's sign-in is the one place jkAuth hands a token to something that is not a
// browser, so every control here is one a phone app's attacker would probe:
//   A  a client and its redirect URI are known before anything redirects to them; PKCE is
//      S256 or nothing; a staging client cannot sign in against production
//   B  a signed-out request goes through the ordinary login; a signed-in one gets a CONSENT
//      page, and only that person, in that browser, can answer it
//   C  a code is spent on its first exchange — a wrong verifier burns it, a replay revokes
//      the family it minted
//   D  the device session is a real session: rotation, reuse detection, the devices list,
//      revocation — and a refresh token only spends on the transport it was issued to
//   E  a Bearer USER token passes the staging gate; a service token never does
//   F  the schema holds the rules on its own (S256-shaped challenge, spend-once trigger),
//      and an unknown JKOS_NATIVE_ENV refuses to boot
//
// Boots the REAL server on a throwaway port + temp DB and drives it over real HTTP.

import { spawnSync } from 'node:child_process';
import { generateKeyPairSync, createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import Database from 'better-sqlite3';
import { startServer, testPort } from '../../../test/lib/smoke.mjs';

const require = createRequire(import.meta.url);
const jwt = require('jsonwebtoken');
const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER = join(__dirname, '..', 'server.js');
const CLIENTS = require('../src/native-clients.json');

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; } else { fail++; console.error(`  ✗ ${name}  ${extra}`); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const tmp = mkdtempSync(join(tmpdir(), 'jkauth-native-'));
const DB_PATH = join(tmp, 'auth.db');
// Band clear of the test-port registry and security.mjs's 6100–6599.
const port = testPort(6700, 400);
const base = `http://127.0.0.1:${port}`;
const GRACE_MS = 300;
const GUEST_PW = 'guestpass123';

const env = {
  DB_PATH,
  JKOS_AUTH_PRIVATE_KEY: privateKey, JKOS_AUTH_PUBLIC_KEY: publicKey,
  COOKIE_DOMAIN: 'localhost', AUTH_ORIGIN: base, PORTAL_URL: base,
  NODE_ENV: 'test', GUEST_PASSWORD: GUEST_PW,
  REFRESH_GRACE_MS: String(GRACE_MS),
  // An auth-audience scope on purpose: the token then verifies for jkAuth, so only resolveBearer's
  // typ check stands between it and the gate.
  JKOS_SERVICE_CLIENTS: 'bot:bot-secret-0123456789:auth:read|kouros:read',
  RL_CREDENTIALS: '10000', RL_REFRESH: '10000',
};
const server = startServer({ port, service: 'jkauth', args: [SERVER], env });

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
async function api(method, path, { json, form, cookie, bearer, noStore } = {}) {
  const h = {};
  if (cookie !== undefined) { if (cookie) h.Cookie = cookie; }
  else if (jar.size) h.Cookie = cookieHeader();
  if (bearer) h.Authorization = `Bearer ${bearer}`;
  let body;
  if (json !== undefined) { h['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  if (form !== undefined) { h['Content-Type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(form).toString(); }
  const res = await fetch(base + path, { method, headers: h, body, redirect: 'manual' });
  if (!noStore) foldCookies(res);
  const text = await res.text();
  let data = null; try { data = JSON.parse(text); } catch { /* HTML */ }
  return { status: res.status, json: data, text, location: res.headers.get('location') || '', headers: res.headers };
}
function done() {
  server.stop();
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
  if (fail && server.log()) console.error('\n── server log ──\n' + server.log());
  console.log(`\nnative: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

const client = CLIENTS.production[0];
const stagingClient = CLIENTS.staging[0];
const pkce = () => {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
};
const authorizeQs = (over = {}) => '/auth/native/authorize?' + new URLSearchParams({
  response_type: 'code', client_id: client.client_id, redirect_uri: client.redirect_uri,
  code_challenge_method: 'S256', state: 'st-' + randomBytes(6).toString('hex'), ...over,
}).toString();
const consentOf = (html) => /name="consent" value="([^"]+)"/.exec(html)?.[1]?.replace(/&amp;/g, '&');
const appParams = (location) => {
  if (!location.startsWith(client.redirect_uri)) return null;
  return Object.fromEntries(new URL(location).searchParams);
};
/** A full sign-in as the jar's user → { code, verifier, state }. */
async function signIn() {
  const { verifier, challenge } = pkce();
  const state = 'st-' + randomBytes(6).toString('hex');
  const page = await api('GET', authorizeQs({ code_challenge: challenge, state }));
  const r = await api('POST', '/auth/native/authorize', { form: { consent: consentOf(page.text), decision: 'allow' } });
  return { code: appParams(r.location)?.code, verifier, state, returnedState: appParams(r.location)?.state };
}
const exchange = (code, verifier, over = {}) => api('POST', '/auth/native/token', { cookie: '', json: {
  grant_type: 'authorization_code', client_id: client.client_id, redirect_uri: client.redirect_uri,
  code, code_verifier: verifier, ...over } });
const refresh = (token, clientId = client.client_id) => api('POST', '/auth/native/token', { cookie: '', json: {
  grant_type: 'refresh_token', client_id: clientId, refresh_token: token } });

try {
  const up = await server.ready();
  if (!up.ok) {
    fail++;
    console.error(`jkAuth never became healthy — ${up.why}:\n` + server.log());
    done();
  }
  const db = new Database(DB_PATH);
  const { challenge } = pkce();

  // ── A · nothing redirects to an app jkAuth doesn't know ─────────────────────
  ok('the generated registry has a production and a staging client, each with its own redirect',
    client?.redirect_uri === `${client?.client_id}:/oauth2redirect` && stagingClient?.client_id === `${client?.client_id}.staging`,
    JSON.stringify(CLIENTS));
  let r = await api('GET', authorizeQs({ client_id: 'com.evil.app', redirect_uri: 'com.evil.app:/oauth2redirect', code_challenge: challenge }));
  ok('unknown client → 400 page, no redirect', r.status === 400 && !r.location, `${r.status} ${r.location}`);
  r = await api('GET', authorizeQs({ redirect_uri: 'https://evil.example/cb', code_challenge: challenge }));
  ok('known client with a foreign redirect URI → 400 page, no redirect', r.status === 400 && !r.location, `${r.status} ${r.location}`);
  r = await api('GET', authorizeQs({ client_id: stagingClient.client_id, redirect_uri: stagingClient.redirect_uri, code_challenge: challenge }));
  ok('a STAGING client is unknown to a production jkAuth', r.status === 400 && !r.location, `${r.status}`);
  r = await api('GET', authorizeQs({ code_challenge_method: 'plain', code_challenge: challenge }));
  ok('PKCE "plain" → back to the app with invalid_request', appParams(r.location)?.error === 'invalid_request', r.location);
  r = await api('GET', authorizeQs({}));
  ok('no PKCE challenge at all → invalid_request', appParams(r.location)?.error === 'invalid_request', r.location);

  // ── B · sign-in goes through the ordinary login; consent belongs to one person ─
  r = await api('GET', authorizeQs({ code_challenge: challenge }));
  ok('signed out → the ordinary login page, returning to authorize',
    r.status === 302 && r.location.startsWith('/auth/login?redirect_to=') && decodeURIComponent(r.location).includes('/auth/native/authorize?'),
    r.location);
  r = await api('POST', '/auth/register', { json: { email: 'alice@x.net', password: 'password-a1', name: 'Alice' } });
  ok('register alice (first user → admin)', r.status === 201, `${r.status}`);
  const aliceId = db.prepare("SELECT id FROM users WHERE email='alice@x.net'").get().id;
  const aliceCookies = cookieHeader();
  r = await api('GET', authorizeQs({ code_challenge: challenge, state: 'abc' }));
  const consent = consentOf(r.text);
  ok('signed in → a consent page naming the app, nothing issued yet',
    r.status === 200 && r.text.includes(client.name) && !!consent
      && !db.prepare('SELECT 1 FROM native_auth_codes').get(), `${r.status}`);
  ok('the consent token is not an access token (no aud, no role)', (() => {
    const p = jwt.decode(consent); return p?.typ === 'native_consent' && !p.aud && !p.role;
  })());
  r = await api('POST', '/auth/native/authorize', { cookie: '', form: { consent, decision: 'allow' } });
  ok('consent posted WITHOUT the session cookie (a cross-site post) → 403, no code',
    r.status === 403 && !db.prepare('SELECT 1 FROM native_auth_codes').get(), `${r.status}`);
  r = await api('POST', '/auth/native/authorize', { form: { consent: consent.slice(0, -4) + 'AAAA', decision: 'allow' } });
  ok('a tampered consent token → 400', r.status === 400, `${r.status}`);
  r = await api('POST', '/auth/native/authorize', { form: { consent, decision: 'deny' } });
  ok('Cancel → back to the app with access_denied and its state',
    appParams(r.location)?.error === 'access_denied' && appParams(r.location)?.state === 'abc', r.location);
  ok('a refusal is audited', !!db.prepare("SELECT 1 FROM auth_events WHERE type='native_authorize_denied'").get());

  // ── C · a code is one exchange, bound to its verifier ───────────────────────
  let s = await signIn();
  ok('allow → a code back to the app, state round-tripped', !!s.code && s.returnedState === s.state, JSON.stringify(s));
  ok('the code is stored only as a hash', !db.prepare('SELECT 1 FROM native_auth_codes WHERE code_hash=?').get(s.code)
    && !!db.prepare('SELECT 1 FROM native_auth_codes WHERE code_hash=?').get(createHash('sha256').update(s.code).digest('hex')));
  r = await exchange(s.code, pkce().verifier);
  ok('the wrong PKCE verifier → invalid_grant', r.status === 400 && r.json?.error === 'invalid_grant', `${r.status} ${r.text}`);
  r = await exchange(s.code, s.verifier);
  ok('…and the code is now spent: even the right verifier fails', r.status === 400 && r.json?.error === 'invalid_grant', `${r.status}`);
  ok('a PKCE failure is audited', !!db.prepare("SELECT 1 FROM auth_events WHERE type='native_token_denied'").get());

  s = await signIn();
  r = await exchange(s.code, s.verifier, { redirect_uri: 'net.other:/oauth2redirect' });
  ok('the token request must name the client\'s own redirect URI', r.status === 400, `${r.status}`);
  s = await signIn();
  r = await exchange(s.code, s.verifier);
  const t1 = r.json;
  ok('the right verifier → tokens, no-store', r.status === 200 && !!t1?.access_token && !!t1?.refresh_token
    && t1.token_type === 'Bearer' && r.headers.get('cache-control')?.includes('no-store'), `${r.status} ${r.text}`);
  const claims = (() => { try { return jwt.verify(t1.access_token, publicKey, { algorithms: ['RS256'] }); } catch { return null; } })();
  ok('the access token is a normal user token for KourOS (azp, aud, role)',
    claims?.sub === String(aliceId) && claims.azp === client.app && claims.aud?.includes(client.app) && claims.role === 'admin',
    JSON.stringify(claims));
  const fam1 = db.prepare('SELECT family_id, client_id, remember_me FROM sessions WHERE token_hash=?')
    .get(createHash('sha256').update(t1.refresh_token).digest('hex'));
  ok('the device session is a session row on the native transport', fam1?.client_id === client.client_id && fam1.remember_me === 1,
    JSON.stringify(fam1));
  r = await exchange(s.code, s.verifier);
  ok('the same code replayed → invalid_grant', r.status === 400, `${r.status}`);
  ok('…and the family it minted is revoked (code_replay)',
    db.prepare('SELECT revoked_reason FROM sessions WHERE family_id=?').all(fam1.family_id).every(x => x.revoked_reason === 'code_replay'));
  r = await refresh(t1.refresh_token);
  ok('a refresh from the revoked family fails', r.status === 400 && r.json?.code === 'SESSION_EXPIRED', `${r.status} ${r.text}`);

  // ── D · the device session behaves like any session ─────────────────────────
  s = await signIn();
  const t2 = (await exchange(s.code, s.verifier)).json;
  r = await refresh(t2.refresh_token);
  const t3 = r.json;
  ok('refresh → new pair', r.status === 200 && !!t3?.refresh_token && t3.refresh_token !== t2.refresh_token, `${r.status} ${r.text}`);
  r = await api('POST', '/auth/refresh', { json: {}, cookie: `jkos_refresh=${t3.refresh_token}`, noStore: true });
  ok('a native refresh token presented as a browser cookie is unknown there', r.status === 401, `${r.status}`);
  r = await refresh(t3.refresh_token);
  const t4 = r.json;
  ok('…and did not burn the native family (it still rotates)', r.status === 200 && !!t4?.refresh_token, `${r.status} ${r.text}`);
  const browserRefresh = [...jar.entries()].find(([k]) => k.startsWith('jkos_refresh'))?.[1];
  r = await refresh(browserRefresh);
  ok('a browser refresh cookie presented to the native endpoint is unknown there', r.status === 400 && r.json?.code === 'SESSION_EXPIRED', `${r.status}`);
  r = await api('GET', '/auth/sessions', { json: undefined });
  const devices = r.json?.sessions || [];
  ok('the phone shows in the devices list as its client', devices.some(d => d.client_id === client.client_id && !d.revoked),
    JSON.stringify(devices));
  r = await api('GET', '/auth/security');
  ok('the Security page names the app', r.status === 200 && r.text.includes(`${client.name}</strong> app`), `${r.status}`);
  await sleep(GRACE_MS + 150);
  r = await refresh(t2.refresh_token);
  ok('a rotated native token replayed after grace → SESSION_REVOKED', r.status === 400 && r.json?.code === 'SESSION_REVOKED', `${r.status} ${r.text}`);
  const fam2 = db.prepare('SELECT family_id FROM sessions WHERE token_hash=?').get(createHash('sha256').update(t2.refresh_token).digest('hex')).family_id;
  ok('…the whole native family is burned as reuse, and audited',
    db.prepare('SELECT revoked_reason FROM sessions WHERE family_id=?').all(fam2).every(x => x.revoked_reason === 'reuse')
      && !!db.prepare("SELECT 1 FROM auth_events WHERE type='refresh_reuse'").get());
  r = await api('GET', '/auth/dashboard');
  ok('…without touching the browser session beside it', r.status === 200, `${r.status}`);

  s = await signIn();
  const t5 = (await exchange(s.code, s.verifier)).json;
  r = await api('POST', '/auth/native/revoke', { cookie: '', json: { client_id: client.client_id, token: t5.refresh_token } });
  ok('sign out from the app → 200', r.status === 200, `${r.status}`);
  r = await refresh(t5.refresh_token);
  ok('…and its refresh token is dead', r.status === 400 && r.json?.code === 'SESSION_EXPIRED', `${r.status}`);
  r = await api('POST', '/auth/native/revoke', { cookie: '', json: { client_id: client.client_id, token: 'not-a-token' } });
  ok('revoking an unknown token still answers 200 (RFC 7009)', r.status === 200, `${r.status}`);
  s = await signIn();
  const t6 = (await exchange(s.code, s.verifier)).json;
  const fam6 = db.prepare('SELECT family_id FROM sessions WHERE token_hash=?').get(createHash('sha256').update(t6.refresh_token).digest('hex')).family_id;
  r = await api('POST', '/auth/sessions/revoke', { json: { family_id: fam6 } });
  ok('the phone can be signed out from the browser\'s devices list', r.status === 200, `${r.status} ${r.text}`);
  r = await refresh(t6.refresh_token);
  ok('…which kills the app\'s refresh token', r.status === 400, `${r.status}`);

  // ── E · the staging edge gate ───────────────────────────────────────────────
  s = await signIn();
  const t7 = (await exchange(s.code, s.verifier)).json;
  r = await api('GET', '/auth/require-admin', { cookie: '', bearer: t7.access_token });
  ok('an admin\'s native Bearer token passes the staging gate', r.status === 200, `${r.status}`);
  r = await api('GET', '/auth/require-admin', { cookie: '', bearer: t7.access_token.slice(0, -3) + 'abc' });
  ok('a forged Bearer token does not', r.status === 401, `${r.status}`);
  r = await api('POST', '/auth/token', { cookie: '', json: { client_id: 'bot', client_secret: 'bot-secret-0123456789' } });
  const svc = r.json?.access_token;
  r = await api('GET', '/auth/require-admin', { cookie: '', bearer: svc });
  ok('a SERVICE token as Bearer never counts as a signed-in user', !!svc && r.status === 401, `${r.status}`);

  // guest: KourOS doesn't admit the guest role, so neither does its native sign-in
  jar.clear();
  r = await api('POST', '/auth/guest', { json: { password: GUEST_PW } });
  r = await api('GET', authorizeQs({ code_challenge: challenge, state: 'g' }));
  ok('a role the app does not admit → access_denied, no consent page', appParams(r.location)?.error === 'access_denied', `${r.status} ${r.location}`);
  jar.clear();

  // ── F · the schema holds the rules without the route ───────────────────────
  const insert = (ch) => { try {
    db.prepare(`INSERT INTO native_auth_codes (code_hash, client_id, redirect_uri, code_challenge, user_id, expires_at)
                VALUES (?,?,?,?,?,?)`).run('h' + randomBytes(8).toString('hex'), 'c', 'c:/r', ch, aliceId, new Date().toISOString());
    return true; } catch { return false; } };
  ok('the table refuses a non-S256 challenge (a plain verifier, 64 chars)', !insert('a'.repeat(64)));
  ok('…and one with characters outside base64url', !insert('+'.repeat(43)));
  ok('…and accepts a real S256 challenge', insert(challenge));
  const spentRow = db.prepare('SELECT code_hash FROM native_auth_codes WHERE used_at IS NOT NULL').get();
  let reSpent = true;
  try { db.prepare('UPDATE native_auth_codes SET used_at=? WHERE code_hash=?').run(new Date().toISOString(), spentRow.code_hash); }
  catch { reSpent = false; }
  ok('the spend-once trigger refuses to re-spend a code, whoever writes', !!spentRow && !reSpent);
  db.close();

  const bad = spawnSync(process.execPath, [SERVER], {
    env: { ...process.env, ...env, PORT: String(testPort(7200, 200)), DB_PATH: join(tmp, 'other.db'), JKOS_NATIVE_ENV: 'stagign' },
    encoding: 'utf8', timeout: 15000,
  });
  ok('an unknown JKOS_NATIVE_ENV refuses to boot', bad.status !== 0 && /JKOS_NATIVE_ENV/.test(bad.stderr), `exit ${bad.status}`);
} catch (e) {
  fail++;
  console.error('harness error:', e);
}
done();
