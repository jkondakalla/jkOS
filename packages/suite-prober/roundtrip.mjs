/**
 * roundtrip.mjs — the "writing sixth app" (TEST-3).
 *
 * The suite-prober is read-only by charter; this is its WRITE-mode sibling. It drives the
 * full BeigeBoard write contract end to end — create → read-back → ?since cursor →
 * update → complete → delete → verify clean — using ONLY the shapes it DISCOVERS from the
 * live capability/dataset docs. Nothing about `items` is hardcoded: it reads the
 * createItem/updateItem/completeItem/deleteItem capabilities and the items dataset's
 * filters from `/capabilities` + `/datasets`, so it exercises the ACTUAL published
 * contract. If a field is renamed in the docs but not the route (or vice-versa), this
 * fails — that is the point.
 *
 * Every row it writes is tagged `ext_ref: 'prober:<runid>'`, and cleanup deletes by that
 * prefix, so it is SAFE to run against a live staging stack (it only ever touches its own
 * rows).
 *
 * Two modes:
 *   node packages/suite-prober/roundtrip.mjs
 *       SMOKE — boots the real BeigeBoard backend on a throwaway port + temp SQLite DB
 *       with the weave dev-stub identity (sub=1), runs the round-trip, tears it down.
 *       This is what the gate runs (chained into the bb-backend `test` script).
 *
 *   node packages/suite-prober/roundtrip.mjs --live https://staging.jkos.net --token <jwt>
 *       LIVE — drives a DEPLOYED stack through the edge. Needs a token with
 *       beigeboard:write scope (or PROBE_TOKEN). No boot, no teardown.
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const BB_BACKEND = join(__dirname, '..', '..', 'apps', 'beigeboard', 'backend');

/* ── args ──────────────────────────────────────────────────────────────────────── */
const argv = process.argv.slice(2);
const flag = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
const liveBase = flag('--live');
const token = flag('--token') || process.env.PROBE_TOKEN || null;
const APP = 'beigeboard';

/* ── result plumbing ──────────────────────────────────────────────────────────── */
let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error('  ✗ ' + msg); } };
const runid = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const EXT = `prober:${runid}`;

/* ── HTTP ─────────────────────────────────────────────────────────────────────── */
let BASE, API; // BASE = origin; API = app api prefix (docs + item paths hang off it)
const headers = { 'Content-Type': 'application/json' };
if (token) headers.Authorization = `Bearer ${token}`;

async function http(method, url, body) {
  const r = await fetch(url, {
    method,
    headers: body !== undefined ? headers : (token ? { Authorization: headers.Authorization } : undefined),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null; try { json = await r.json(); } catch { /* non-JSON */ }
  return { status: r.status, json };
}

/* ── smoke boot (import.smoke house pattern) ──────────────────────────────────── */
let child = null, tmp = null, serverLog = '', exited = null;
// The one server this boots is the BeigeBoard backend, so /health must name that app.
// A bare 200 once passed eight assertions against a stray server from ANOTHER app on
// a shared port (OPS-1); the uniform health contract carries the app id so a smoke can
// tell. `APP` is already 'beigeboard' — the same id the live mode checks the docs for.
const SERVICE = APP;
async function waitForHealth(base, ms = 15000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (exited) return false; // the child is gone — polling the port can only find a stranger
    try {
      const res = await fetch(base + '/health');
      if (res.ok) {
        const body = await res.json().catch(() => ({}));
        if (body.service === SERVICE) return true;
        console.error(`  ✗ /health answered 200 but service=${JSON.stringify(body.service)} — ` +
                      `expected '${SERVICE}'. Another server owns this port.`);
        return false;
      }
    } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

function teardown(code) {
  if (child) { try { child.kill('SIGKILL'); } catch { /* gone */ } }
  if (tmp) { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ } }
  // The child's own words, on ANY failure — not only when health never came up.
  if ((fail || code) && serverLog) console.error('\n── server log ──\n' + serverLog);
  console.log(`\nroundtrip (${liveBase ? 'live' : 'smoke'}): ${pass} passed, ${fail} failed`);
  process.exit(code ?? (fail ? 1 : 0));
}

/* ── discovery: read the doc, don't assume it ─────────────────────────────────── */
function capByFieldPath(caps, id) { return (caps || []).find((c) => c.id === id) || null; }
/** Resolve a capability's URL, substituting :id from the row. */
function capUrl(cap, row) {
  let p = cap.path; // e.g. '/items' or '/items/:id'
  if (row && /:id/.test(p)) p = p.replace(':id', String(row.id));
  return API + p;
}

async function main() {
  if (liveBase) {
    BASE = liveBase.replace(/\/+$/, '');
    // Live edge prefixes the app's api base (…/api/beigeboard); derive it from the manifest.
    const seed = require('@jkos/suite-manifest').registrySeed().find((r) => r.id === APP);
    API = BASE + (seed?.api_base || `/api/${APP}`);
    if (!token) console.error('  ⚠ live mode with no --token/PROBE_TOKEN — writes will 401 unless the edge is open');
  } else {
    // Claimed in the suite-manifest port registry ('suite-prober:roundtrip') — the
    // `port-registry` probe holds this literal to that claim. It used to be 3988,
    // shared with BeigeBoard's items.smoke — that overlap is exactly OPS-1.
    const PORT = 3994;
    BASE = `http://127.0.0.1:${PORT}`;
    API = BASE + '/api';
    tmp = mkdtempSync(join(tmpdir(), 'bb-roundtrip-'));
    child = spawn('node', ['server.js'], {
      cwd: BB_BACKEND,
      env: { ...process.env, NODE_ENV: '', PORT: String(PORT), DB_PATH: join(tmp, 'test.db') },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (d) => { serverLog += d; });
    child.stderr.on('data', (d) => { serverLog += d; });
    child.on('exit', (code, signal) => { exited = { code, signal }; });
    if (!(await waitForHealth(BASE))) {
      fail++;
      console.error('server never became healthy'
        + (exited ? ` (exited code=${exited.code} signal=${exited.signal})` : ''));
      teardown(1);
    }
  }

  // ── 1. DISCOVER the contract (only shapes we read, none we assume) ──
  const capsRes = await http('GET', `${API}/capabilities`);
  const dsRes = await http('GET', `${API}/datasets`);
  ok(capsRes.status === 200 && capsRes.json?.app === APP, `discover: capabilities doc served for ${APP} (got ${capsRes.status}/${capsRes.json?.app})`);
  ok(dsRes.status === 200 && dsRes.json?.app === APP, `discover: datasets doc served for ${APP} (got ${dsRes.status}/${dsRes.json?.app})`);
  const caps = capsRes.json?.capabilities || [];
  const itemsDs = (dsRes.json?.datasets || []).find((d) => d.id === 'items');
  ok(!!itemsDs, 'discover: an "items" dataset is declared');
  const create = capByFieldPath(caps, 'createItem');
  const update = capByFieldPath(caps, 'updateItem');
  const complete = capByFieldPath(caps, 'completeItem');
  const del = capByFieldPath(caps, 'deleteItem');
  ok(create && update && complete && del, 'discover: create/update/complete/delete capabilities all declared');
  const filterNames = new Set((itemsDs?.filters || []).map((f) => f.name));
  ok(filterNames.has('ext_ref_prefix'), 'discover: items dataset declares the ext_ref_prefix filter (per-app isolation)');
  ok(filterNames.has('since'), 'discover: items dataset declares the since (delta cursor) filter');
  const declaredFields = new Set((itemsDs?.item || []).map((f) => f.name));
  ok(declaredFields.size > 0, 'discover: items dataset declares a typed item shape');
  if (!create || !itemsDs) { console.error('  ✗ cannot proceed without the create capability + items dataset'); teardown(1); }

  const itemsUrl = API + itemsDs.path; // GET/list base

  const beforeCreate = new Date(Date.now() - 1000).toISOString();

  // ── 2. CREATE, tagged with our ext_ref ──
  const created = await http('POST', capUrl(create), {
    title: `prober round-trip ${runid}`,
    ext_ref: EXT,
  });
  ok(created.status === 201, `create: 201 (got ${created.status} ${JSON.stringify(created.json)?.slice(0, 120)})`);
  const row = created.json || {};
  ok(Number.isFinite(row.id), `create: returns a numeric id (got ${row.id})`);
  ok(row.ext_ref === EXT, `create: ext_ref round-trips (got ${row.ext_ref})`);
  // The returned row's keys must be a SUBSET of the declared item shape (declared ≡ served).
  const undeclared = Object.keys(row).filter((k) => !declaredFields.has(k));
  ok(undeclared.length === 0, `create: returned row keys ⊆ declared shape (undeclared: ${undeclared.join(', ') || 'none'})`);

  // ── 3. READ BACK via the declared ext_ref_prefix filter ──
  const mine = await http('GET', `${itemsUrl}?ext_ref_prefix=${encodeURIComponent('prober:')}`);
  ok(mine.status === 200 && Array.isArray(mine.json), `read: list returns an array (got ${mine.status})`);
  ok((mine.json || []).some((x) => x.id === row.id), 'read: our created row is found via ext_ref_prefix');

  // ── 4. ?since cursor SEES the new row (and a future cursor does not) ──
  const sinceSees = await http('GET', `${itemsUrl}?since=${encodeURIComponent(beforeCreate)}&ext_ref_prefix=${encodeURIComponent('prober:')}`);
  ok((sinceSees.json || []).some((x) => x.id === row.id), 'cursor: ?since before the write returns the new row');
  const future = new Date(Date.now() + 60_000).toISOString();
  const sinceFuture = await http('GET', `${itemsUrl}?since=${encodeURIComponent(future)}&ext_ref_prefix=${encodeURIComponent('prober:')}`);
  ok(!(sinceFuture.json || []).some((x) => x.id === row.id), 'cursor: ?since in the future excludes the row');

  // ── 5. UPDATE (the cross-app reschedule seam) ──
  const newTitle = `prober rescheduled ${runid}`;
  const updated = await http('PATCH', capUrl(update, row), { id: row.id, title: newTitle, due_date: '2027-01-15' });
  ok(updated.status === 200, `update: 200 (got ${updated.status})`);
  ok(updated.json?.title === newTitle && updated.json?.due_date === '2027-01-15', 'update: title + due_date changed');
  ok(updated.json?.updated_at && updated.json.updated_at >= beforeCreate, 'update: updated_at advanced (delta cursor stays coherent)');

  // ── 6. COMPLETE ──
  const done = await http('PATCH', capUrl(complete, row), { id: row.id, completed: true });
  ok(done.status === 200, `complete: 200 (got ${done.status})`);
  ok(done.json?.completed === 1 || done.json?.completed === true, `complete: row marked done (got ${JSON.stringify(done.json?.completed)})`);

  // ── 7. DELETE, then verify GONE ──
  const removed = await http('DELETE', capUrl(del, row));
  ok(removed.status === 200 && (removed.json?.ok === true), `delete: 200 {ok:true} (got ${removed.status})`);
  const after = await http('GET', `${itemsUrl}?ext_ref_prefix=${encodeURIComponent('prober:')}`);
  ok(!(after.json || []).some((x) => x.id === row.id), 'delete: the row is gone on read-back');

  // ── 8. CLEANUP — sweep any lingering prober rows (safety for live re-runs) ──
  const stragglers = (after.json || []).filter((x) => String(x.ext_ref || '').startsWith('prober:'));
  for (const s of stragglers) await http('DELETE', `${itemsUrl}/${s.id}`);
  ok(true, `cleanup: swept ${stragglers.length} lingering prober row(s)`);
}

try {
  await main();
} catch (e) {
  console.error('harness error:', e);
  fail++;
} finally {
  teardown();
}
