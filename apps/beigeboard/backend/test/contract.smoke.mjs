// TEST-7 — declared-vs-enforced contract gate for BeigeBoard.
//
// The whole point of ARCH-1 is that what BeigeBoard DECLARES (discovery.js's
// capability bodies + the `items` dataset shape, all derived from src/item-fields)
// is exactly what it ENFORCES. This test proves that end to end, generically — it
// reads the DECLARED docs (no field names hardcoded) and drives the REAL endpoints:
//
//   (A) enforced ⊆ declared — a genuinely-created row's keys are all present in the
//       declared `items` shape (catches a DB column that isn't declared to peers).
//   (B) every declared, mechanically-checkable constraint REJECTS a violating body:
//       a `max` string cap, a `date`/`time` typed field → 400 {code:'VALIDATION'}
//       on both the POST (create) and PATCH (update) write paths.
//   (C) reserved calendar-owned sources are rejected on direct writes (BUG-1).
//
// Enum constraints are intentionally NOT violated: a capability body's `kind` enum
// (e.g. [task,event]) is a curated *subset* of the column's real domain (the API
// legitimately creates goal/milestone rows), so "declared enum" is a UI hint, not a
// hard column constraint — testing it would be a false positive. Caps + date/time
// are true column constraints and safe to assert generically.
//
// Boots the REAL server.js on a throwaway DB + port under the weave dev-stub
// (no auth key → sub=1), the same house pattern as import.smoke.mjs.
//
//   node apps/beigeboard/backend/test/contract.smoke.mjs

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKEND = join(__dirname, '..');
const require = createRequire(import.meta.url);
const { CAPABILITIES, DATASETS } = require('../discovery.js');   // the DECLARED contract, as data

// Claimed in the suite-manifest port registry ('beigeboard:contract.smoke') — the
// `port-registry` probe holds this literal to that claim.
const PORT = 3989;
const BASE = `http://127.0.0.1:${PORT}`;
// The /health payload must name THIS app. A bare 200 once passed eight
// assertions against a stray server from ANOTHER app on a shared port (OPS-1);
// the uniform health contract carries the app id precisely so a smoke can tell.
const SERVICE = 'beigeboard';
const tmp = mkdtempSync(join(tmpdir(), 'bb-contract-'));
const DB_PATH = join(tmp, 'test.db');

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error('  ✗ ' + msg); } };

async function req(method, path, body) {
  const r = await fetch(BASE + path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null; try { json = await r.json(); } catch { /* non-JSON */ }
  return { status: r.status, json };
}

async function waitForHealth(ms = 15000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (exited) return false; // the child is gone — polling the port can only find a stranger
    try {
      const res = await fetch(BASE + '/health');
      if (res.ok) {
        const body = await res.json().catch(() => ({}));
        if (body.service === SERVICE) return true;
        console.error(`  ✗ /health answered 200 but service=${JSON.stringify(body.service)} — ` +
                      `expected '${SERVICE}'. Another server owns this port.`);
        return false;
      }
    } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 150));
  }
  return false;
}

const child = spawn('node', ['server.js'], {
  cwd: BACKEND,
  env: { ...process.env, NODE_ENV: '', PORT: String(PORT), DB_PATH },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
let exited = null; // fail fast: a child that dies pre-health must not be polled for
child.stdout.on('data', d => { serverLog += d; });
child.stderr.on('data', d => { serverLog += d; });
child.on('exit', (code, signal) => { exited = { code, signal }; });

function done() {
  try { child.kill('SIGKILL'); } catch { /* already gone */ }
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
  // The child's own words, on ANY failure — not only when health never came up.
  if (fail && serverLog) console.error('\n── server log ──\n' + serverLog);
  console.log(`\ncontract.smoke: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

// A violating value per declared, mechanically-checkable constraint. Returns a list
// of { label, value } — one per constraint the field carries.
function violations(field) {
  const out = [];
  if (typeof field.max === 'number') out.push({ label: `${field.name} max ${field.max}`, value: 'y'.repeat(field.max + 1) });
  if (field.type === 'date') out.push({ label: `${field.name} bad date`, value: '2026-13-40' });
  if (field.type === 'time') out.push({ label: `${field.name} bad time`, value: '99:99' });
  return out;
}

try {
  if (!(await waitForHealth())) {
    fail++;
    console.error('server never became healthy'
      + (exited ? ` (exited code=${exited.code} signal=${exited.signal})` : '')
      + ':\n' + serverLog);
    done();
  }

  const createCap =CAPABILITIES.capabilities.find(c => c.method === 'POST' && c.path === '/items');
  const updateCap = CAPABILITIES.capabilities.find(c => c.id === 'updateItem');
  const itemsDs   = DATASETS.datasets.find(d => d.id === 'items');
  ok(!!createCap, 'discovery declares a POST /items capability');
  ok(!!itemsDs && Array.isArray(itemsDs.item), 'discovery declares an `items` dataset with a row shape');

  const shapeNames = new Set(itemsDs.item.map(f => f.name));
  const baseline = { title: 'contract probe' };

  // ── (A) enforced ⊆ declared: a real created row's keys are all declared ──
  const created = await req('POST', '/api/items', baseline);
  ok(created.status === 201, `A: valid createItem body → 201 (got ${created.status})`);
  const row = created.json || {};
  const undeclared = Object.keys(row).filter(k => !shapeNames.has(k));
  ok(undeclared.length === 0, `A: every returned column is declared in the items shape (undeclared: ${undeclared.join(', ') || 'none'})`);
  const newId = row.id;

  // ── (B) every declared cap/date/time constraint REJECTS a violating POST body ──
  let checked = 0;
  for (const field of createCap.body) {
    for (const v of violations(field)) {
      checked++;
      const r = await req('POST', '/api/items', { ...baseline, [field.name]: v.value });
      ok(r.status === 400 && r.json?.code === 'VALIDATION',
        `B: POST violating ${v.label} → 400 VALIDATION (got ${r.status} ${r.json?.code || ''})`);
    }
  }
  ok(checked >= 3, `B: exercised at least 3 declared constraints (exercised ${checked})`);

  // ── (B') the SAME constraints are enforced on the PATCH (update) write path ──
  //     validateItemWrite is shared, so a declared updateItem constraint must reject too.
  const patchField = (updateCap?.body || []).find(f => typeof f.max === 'number' || f.type === 'date' || f.type === 'time');
  if (patchField && newId != null) {
    const v = violations(patchField)[0];
    const r = await req('PATCH', `/api/items/${newId}`, { [patchField.name]: v.value });
    ok(r.status === 400 && r.json?.code === 'VALIDATION',
      `B': PATCH violating ${v.label} → 400 VALIDATION (got ${r.status} ${r.json?.code || ''})`);
  } else {
    ok(true, "B': no declared updateItem constraint to exercise (skipped)");
  }

  // ── (C) reserved calendar-owned sources rejected on direct writes (BUG-1) ──
  for (const src of ['google', 'outlook', 'icloud']) {
    const r = await req('POST', '/api/items', { ...baseline, source: src });
    ok(r.status === 400 && r.json?.code === 'VALIDATION',
      `C: POST source='${src}' (calendar-reserved) → 400 VALIDATION (got ${r.status} ${r.json?.code || ''})`);
  }

  // ── control: a fully valid write with a declared date/time still succeeds ──
  const good = await req('POST', '/api/items', { ...baseline, due_date: '2026-07-07', scheduled_time: '09:30' });
  ok(good.status === 201, `control: valid due_date + scheduled_time → 201 (got ${good.status})`);
} catch (e) {
  console.error('contract.smoke crashed:', e);
  fail++;
} finally {
  done();
}
