// TEST-6 · Multi-user collision sim — the spec for ARCH-7.
//
//   node apps/jkauth/test/multiuser.mjs
//
// Boots a REAL jkAuth (in-process RSA keypair, throwaway DB) with two humans
// (admin A + regular user B), a guest, and a delegation-enrolled service client,
// then drives the multi-user concerns ARCH-7 introduced — the ones a single-user
// harness can't see:
//
//   · preference ISOLATION — A's prefs never leak into B's blob
//   · DEEP MERGE (ARCH-7.2) — patching one slice (theme.primary) preserves the
//     sibling slices (theme.mode/secondary, effects) a shallow spread would drop
//   · OPTIMISTIC LOCK (ARCH-7.2) — a stale-version write 409s CONFLICT, and the
//     re-apply-onto-fresh-blob retry preserves the concurrent slice
//   · ROLE-SCOPED WIDGETS (ARCH-7.1) — an admin-only published widget is invisible
//     to a user/guest; publish stays admin-only
//   · audit scoping + delegated-write attribution in auth_events
//
// Item isolation across users is BeigeBoard's concern and is covered by
// apps/beigeboard/backend/test/items.smoke.mjs (TEST-4); this file owns the jkAuth
// half of the multi-user contract.

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

// ── Boot ─────────────────────────────────────────────────────────────────────
const tmp = mkdtempSync(join(tmpdir(), 'jkauth-multiuser-'));
// Band clear of the test-port registry (3980–3996) + discover spares (4083–4085).
const port = 5500 + Math.floor(Math.random() * 500);
const base = `http://127.0.0.1:${port}`;
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
    JKOS_SERVICE_CLIENTS: 'prober:probersecret:beigeboard:write',
    JKOS_DELEGATION_CLIENTS: 'prober',
    RL_CREDENTIALS: '1000', RL_REFRESH: '1000',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', (d) => { serverLog += d; });
child.stderr.on('data', (d) => { serverLog += d; });

// A per-client cookie jar so A / B / guest hold independent sessions.
function newJar() { return new Map(); }
function foldCookies(jar, res) {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const pair = c.split(';')[0];
    const i = pair.indexOf('=');
    const name = pair.slice(0, i).trim(), val = pair.slice(i + 1).trim();
    if (val === '') jar.delete(name); else jar.set(name, val);
  }
}
async function api(jar, method, path, { json } = {}) {
  const h = {};
  if (jar && jar.size) h.Cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  let body;
  if (json !== undefined) { h['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  const res = await fetch(base + path, { method, headers: h, body, redirect: 'manual' });
  if (jar) foldCookies(jar, res);
  let data = null; try { data = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, json: data };
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
  console.log(`\nmultiuser: ${pass} passed, ${fail} failed`);
  process.exit(code ?? (fail ? 1 : 0));
}

try {
  if (!(await ready())) { console.error('jkAuth never became healthy:\n' + serverLog); done(1); }

  const A = newJar(), B = newJar(), G = newJar();

  // ── 1. two humans (admin A, user B) + a guest ─────────────────────────────────
  const regA = await api(A, 'POST', '/auth/register', { json: { email: 'a@jkos.net', name: 'Alice', password: 'password123' } });
  ok('A registers → 201 admin (first non-guest)', regA.status === 201 && regA.json?.user?.role === 'admin', `${regA.status} ${JSON.stringify(regA.json?.user)}`);
  const aId = String(regA.json.user.id);
  const regB = await api(B, 'POST', '/auth/register', { json: { email: 'b@jkos.net', name: 'Bob', password: 'password123' } });
  ok('B registers → 201 user (second is not admin)', regB.status === 201 && regB.json?.user?.role === 'user', `${regB.status} ${JSON.stringify(regB.json?.user)}`);
  const bId = String(regB.json.user.id);
  const guest = await api(G, 'POST', '/auth/guest', { json: { password: 'guestpass123' } });
  ok('guest login → 200', guest.status === 200 && guest.json?.user?.role === 'guest', `${guest.status} ${JSON.stringify(guest.json)}`);

  // ── 2. preference isolation — A and B have independent blobs ───────────────────
  await api(A, 'PATCH', '/auth/profile', { json: { preferences: { theme: { mode: 'dark', primary: '#aa0000', secondary: '#00aa00' } } } });
  await api(B, 'PATCH', '/auth/profile', { json: { preferences: { theme: { mode: 'light', primary: '#0000bb', secondary: '#bb00bb' } } } });
  const profA = await api(A, 'GET', '/auth/profile');
  const profB = await api(B, 'GET', '/auth/profile');
  ok("A's prefs are A's", profA.json?.preferences?.theme?.primary === '#aa0000', JSON.stringify(profA.json?.preferences));
  ok("B's prefs are B's (no cross-user leak)", profB.json?.preferences?.theme?.primary === '#0000bb', JSON.stringify(profB.json?.preferences));
  ok('GET /auth/profile exposes prefs_version cursor', typeof profA.json?.prefs_version === 'number', JSON.stringify(profA.json?.prefs_version));

  // ── 3. DEEP MERGE — patching theme.primary keeps mode + secondary ─────────────
  const vBefore = profA.json.prefs_version;
  const merged = await api(A, 'PATCH', '/auth/profile', { json: { preferences: { theme: { primary: '#123456' } }, prefs_version: vBefore } });
  ok('versioned patch → 200 + advanced prefs_version', merged.status === 200 && merged.json?.prefs_version === vBefore + 1, JSON.stringify(merged.json));
  const afterMerge = await api(A, 'GET', '/auth/profile');
  const tm = afterMerge.json?.preferences?.theme || {};
  ok('deep merge kept the sibling keys a shallow spread would drop', tm.primary === '#123456' && tm.mode === 'dark' && tm.secondary === '#00aa00', JSON.stringify(tm));

  // ── 4. OPTIMISTIC LOCK — a stale-version write 409s, retry preserves both ──────
  const vNow = afterMerge.json.prefs_version;
  const first = await api(A, 'PATCH', '/auth/profile', { json: { preferences: { effects: { grain: true } }, prefs_version: vNow } });
  ok('first writer (fresh version) → 200', first.status === 200 && first.json?.prefs_version === vNow + 1, JSON.stringify(first.json));
  // A second tab still holding the OLD version tries to write a different slice.
  const stale = await api(A, 'PATCH', '/auth/profile', { json: { preferences: { lazuros: { enabled: false } }, prefs_version: vNow } });
  ok('stale-version write → 409 CONFLICT', stale.status === 409 && stale.json?.code === 'CONFLICT', `${stale.status} ${JSON.stringify(stale.json)}`);
  ok('409 hands back the current version + blob to re-apply onto', stale.json?.prefs_version === vNow + 1 && stale.json?.preferences?.effects?.grain === true, JSON.stringify(stale.json));
  // Re-apply the same slice onto the fresh version (what the shared hook's retry does).
  const retry = await api(A, 'PATCH', '/auth/profile', { json: { preferences: { lazuros: { enabled: false } }, prefs_version: stale.json.prefs_version } });
  ok('retry at the fresh version → 200', retry.status === 200, `${retry.status} ${JSON.stringify(retry.json)}`);
  const afterRace = await api(A, 'GET', '/auth/profile');
  ok('both racing slices survived (grain AND lazuros.enabled)',
    afterRace.json?.preferences?.effects?.grain === true && afterRace.json?.preferences?.lazuros?.enabled === false,
    JSON.stringify(afterRace.json?.preferences));
  // A patch WITHOUT a version still works (fire-and-forget HUD autosave path).
  const noVer = await api(A, 'PATCH', '/auth/profile', { json: { preferences: { hud: { placed: [] } } } });
  ok('versionless patch still accepted (deep-merged, no lock)', noVer.status === 200, `${noVer.status}`);
  ok('versionless patch did not drop earlier slices', (await api(A, 'GET', '/auth/profile')).json?.preferences?.effects?.grain === true);

  // ── 5. ROLE-SCOPED WIDGETS (ARCH-7.1) ──────────────────────────────────────────
  const pubOpen = await api(A, 'POST', '/auth/widgets', { json: { id: 'w-open', label: 'Open', kind: 'metric' } });
  ok('admin publishes an all-roles widget → ok', pubOpen.status === 200 && pubOpen.json?.ok, JSON.stringify(pubOpen.json));
  const pubAdmin = await api(A, 'POST', '/auth/widgets', { json: { id: 'w-admin', label: 'Admin Only', kind: 'metric', allowed_roles: ['admin'] } });
  ok('admin publishes an admin-only widget → ok', pubAdmin.status === 200 && pubAdmin.json?.ok, JSON.stringify(pubAdmin.json));

  const idsFor = (r) => (r.json?.widgets || []).map((w) => w.id).sort();
  const wA = await api(A, 'GET', '/auth/widgets');
  const wB = await api(B, 'GET', '/auth/widgets');
  const wG = await api(G, 'GET', '/auth/widgets');
  ok('admin sees BOTH widgets', JSON.stringify(idsFor(wA)) === JSON.stringify(['w-admin', 'w-open']), JSON.stringify(idsFor(wA)));
  ok('user sees only the all-roles widget', JSON.stringify(idsFor(wB)) === JSON.stringify(['w-open']), JSON.stringify(idsFor(wB)));
  ok('guest sees only the all-roles widget', JSON.stringify(idsFor(wG)) === JSON.stringify(['w-open']), JSON.stringify(idsFor(wG)));
  const adminDef = (wA.json.widgets || []).find((w) => w.id === 'w-admin');
  ok('allowed_roles round-trips to the admin workshop view', Array.isArray(adminDef?.allowed_roles) && adminDef.allowed_roles.includes('admin'), JSON.stringify(adminDef?.allowed_roles));
  const pubByUser = await api(B, 'POST', '/auth/widgets', { json: { id: 'w-sneaky', label: 'Nope' } });
  ok('a non-admin cannot publish → 403', pubByUser.status === 403, `${pubByUser.status}`);
  ok('the rejected publish did not land (still 2 widgets for admin)', (await api(A, 'GET', '/auth/widgets')).json.widgets.length === 2);

  // ── 6. audit scoping + delegated-write attribution ─────────────────────────────
  const del = await api(null, 'POST', '/auth/token', { json: { client_id: 'prober', client_secret: 'probersecret', scope: 'beigeboard:write', on_behalf_of: aId } });
  ok('delegated service token minted on-behalf-of A → 200', del.status === 200 && !!del.json?.access_token, `${del.status} ${JSON.stringify(del.json)}`);

  const evB = await api(B, 'GET', '/auth/events');
  ok('a non-admin only sees their OWN audit events', (evB.json?.events || []).length > 0 && evB.json.events.every((e) => String(e.user_id) === bId), JSON.stringify(evB.json?.events?.map((e) => e.user_id)));
  const evA = await api(A, 'GET', '/auth/events');
  const userIds = new Set((evA.json?.events || []).map((e) => String(e.user_id)));
  ok('an admin sees the whole suite audit (multiple users)', userIds.has(aId) && userIds.has(bId), JSON.stringify([...userIds]));
  const delegationEvent = (evA.json?.events || []).find((e) => {
    try { return e.type === 'service_token' && JSON.parse(e.meta || '{}').act === aId; } catch { return false; }
  });
  ok('the delegated mint is attributed to the acting user in auth_events', !!delegationEvent, JSON.stringify((evA.json?.events || []).filter((e) => e.type === 'service_token')));

  done();
} catch (e) {
  console.error('multiuser harness error:', e);
  fail++;
  done(1);
}
