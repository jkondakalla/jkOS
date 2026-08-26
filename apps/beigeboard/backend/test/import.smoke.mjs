// Integration smoke test for POST /api/import (BeigeBoard bulk / AI import).
//
// Boots the REAL server.js against a throwaway SQLite DB on a spare port (no auth
// key configured → weave dev-stub user sub=1), then exercises the import contract
// end to end: nested trees, flat ref/parent graphs, appending under an existing
// item, field aliases/defaults, validate-then-write atomicity, dryRun, and cycle
// rejection. Tears the server + temp DB down at the end.
//
//   node apps/beigeboard/backend/test/import.smoke.mjs

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKEND = join(__dirname, '..');
// Claimed in the suite-manifest port registry ('beigeboard:import.smoke') — the
// `port-registry` probe holds this literal to that claim.
const PORT = 3987;
const BASE = `http://127.0.0.1:${PORT}`;
// The /health payload must name THIS app. A bare 200 once passed eight
// assertions against a stray server from ANOTHER app on a shared port (OPS-1);
// the uniform health contract carries the app id precisely so a smoke can tell.
const SERVICE = 'beigeboard';

const tmp = mkdtempSync(join(tmpdir(), 'bb-import-'));
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
const list = async (qs = '') => (await req('GET', '/api/items' + qs)).json || [];

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
  console.log(`\nimport.smoke: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

try {
  if (!(await waitForHealth())) {
    fail++;
    console.error('server never became healthy'
      + (exited ? ` (exited code=${exited.code} signal=${exited.signal})` : '')
      + ':\n' + serverLog);
    done();
  }

  // ── A. nested tree: goal → milestones → tasks (kinds inferred from depth) ──
  const A = await req('POST', '/api/import', {
    defaults: { accent: '#B85C3A', tags: ['alpha'] },
    items: [{
      title: 'Learn to play guitar',
      done_means: 'Play 3 songs from memory',
      target_date: '2026-12-31',
      children: [
        { title: 'Master open chords', children: [
          { title: 'Practice G, C, D', date: '2026-07-01', time: '18:00' },
          { title: 'Chord transitions',  date: '2026-07-02' },
        ] },
        { title: 'Play a full song' },
      ],
    }],
  });
  ok(A.status === 201, `A: 201 (got ${A.status} ${JSON.stringify(A.json)})`);
  ok(A.json?.created === 5, `A: created 5 (got ${A.json?.created})`);

  const alpha = await list('?tags=alpha');
  const at = (t) => alpha.find(x => x.title === t);
  const goal = at('Learn to play guitar'), m1 = at('Master open chords'), t1 = at('Practice G, C, D');
  ok(goal?.kind === 'goal',  `A: root inferred goal (got ${goal?.kind})`);
  ok(goal?.scope === 'year', `A: goal scope→year (got ${goal?.scope})`);
  ok(goal?.target_date === '2026-12-31', 'A: goal target_date kept');
  ok(m1?.kind === 'milestone' && m1?.parent_id === goal?.id, 'A: milestone wired under goal');
  ok(t1?.kind === 'task' && t1?.parent_id === m1?.id, 'A: task wired under milestone');
  ok(t1?.due_date === '2026-07-01' && t1?.scheduled_time === '18:00', 'A: date/time aliases mapped');
  ok(Array.isArray(t1?.tags) && t1.tags.includes('alpha'), 'A: default tag applied to every node');

  // ── B. flat ref/parent graph ──
  const B = await req('POST', '/api/import', {
    defaults: { tags: ['beta'] },
    items: [
      { ref: 'g', title: 'Ship the app', kind: 'goal' },
      { ref: 'm', parent: 'g', title: 'MVP', kind: 'milestone' },
      { parent: 'm', title: 'Write the README' },
    ],
  });
  ok(B.status === 201 && B.json?.created === 3, `B: created 3 (got ${B.status} ${B.json?.created})`);
  const beta = await list('?tags=beta');
  const bg = beta.find(x => x.title === 'Ship the app');
  const bm = beta.find(x => x.title === 'MVP');
  const bt = beta.find(x => x.title === 'Write the README');
  ok(bm?.parent_id === bg?.id, 'B: ref child linked to ref parent');
  ok(bt?.parent_id === bm?.id, 'B: second-level ref link');

  // ── C. parent_id appends under an EXISTING item ──
  const C = await req('POST', '/api/import', { items: [{ title: 'Buy a capo', parent_id: goal.id, tags: ['gamma'] }] });
  ok(C.status === 201, `C: 201 (got ${C.status} ${JSON.stringify(C.json)})`);
  const gamma = await list('?tags=gamma');
  ok(gamma[0]?.parent_id === goal.id, 'C: appended under an existing goal id');

  // ── D. atomicity: ANY error → whole document rejected, nothing written ──
  const before = (await list()).length;
  const bad = await req('POST', '/api/import', {
    items: [
      { title: 'this one is fine' },
      { due_date: 'not-a-date' },            // missing title + malformed date
      { ref: 'x', parent: 'nope', title: 'dangling parent' },
    ],
  });
  ok(bad.status === 400, `D: rejected 400 (got ${bad.status})`);
  ok(Array.isArray(bad.json?.errors) && bad.json.errors.length >= 2, 'D: returns multiple precise errors');
  ok((await list()).length === before, `D: nothing written on error (count stayed ${before})`);

  // ── E. dryRun previews without writing ──
  const beforeDry = (await list()).length;
  const dry = await req('POST', '/api/import?dryRun=1', { items: [{ title: 'phantom', children: [{ title: 'kid' }] }] });
  ok(dry.status === 200 && dry.json?.dryRun === true && dry.json?.wouldCreate === 2, `E: dryRun wouldCreate 2 (got ${JSON.stringify(dry.json)})`);
  ok((await list()).length === beforeDry, 'E: dryRun wrote nothing');

  // ── F. cycle detection on ref graphs ──
  const cyc = await req('POST', '/api/import', { items: [
    { ref: 'a', parent: 'b', title: 'A' },
    { ref: 'b', parent: 'a', title: 'B' },
  ] });
  ok(cyc.status === 400 && cyc.json?.errors?.some(e => /cycle/.test(e)), 'F: parent cycle rejected');

  // ── G. updated_at is stamped on INSERT → the weave ?since delta returns new rows ──
  //     (regression guard: it used to be NULL on insert, so ?since silently dropped it)
  const G = await req('POST', '/api/import', { items: [{ title: 'delta probe', tags: ['delta'] }] });
  ok(G.status === 201, `G: created (got ${G.status})`);
  const gItem = (await list('?tags=delta'))[0];
  ok(gItem && typeof gItem.updated_at === 'string' && gItem.updated_at.length > 0, `G: updated_at stamped on insert (got ${JSON.stringify(gItem?.updated_at)})`);
  const since = await req('GET', '/api/items?since=2000-01-01');
  ok(Array.isArray(since.json) && since.json.some((x) => x.id === gItem?.id), 'G: ?since returns the newly-created row');

  // ── H. input hardening: clean + bound + no masquerade / no prototype pollution ──
  const H = await req('POST', '/api/import', { items: [{
    title: 'hardened',
    source: 'google',                 // reserved (calendar-owned) → must be dropped → 'bb'
    accent: 'red; background:url(x)',  // not a hex colour → must be dropped
    notes: 'x'.repeat(6000),           // over the 5000 cap → must be truncated
    scope: 'bogus',                    // unknown enum → must default to 'day'
    year: 'not-a-number',              // non-numeric → must be dropped (no crash)
    tags: ['t'.repeat(200), 'sec'],    // long tag → truncated to 60
    ['__proto__']: { polluted: true }, // own "__proto__" key → must be ignored, no pollution
  }] });
  ok(H.status === 201, `H: created despite dirty input (got ${H.status} ${JSON.stringify(H.json)})`);
  const hi = (await list('?tags=sec'))[0];
  ok(hi?.source === 'bb',  `H: reserved source 'google' dropped → bb (got ${hi?.source})`);
  ok(hi?.accent == null,   `H: non-hex accent dropped (got ${JSON.stringify(hi?.accent)})`);
  ok(typeof hi?.notes === 'string' && hi.notes.length === 5000, `H: notes truncated to cap (len ${hi?.notes?.length})`);
  ok(hi?.scope === 'day',  `H: unknown scope defaulted to day (got ${hi?.scope})`);
  ok(Array.isArray(hi?.tags) && hi.tags.every((t) => t.length <= 60), 'H: tags truncated to 60 chars');
  ok(({}).polluted === undefined, 'H: no prototype pollution from a "__proto__" key');

  // ── I. date/time hygiene: lenient input normalised, impossible values rejected ──
  // I.1 single-digit month/day/hour are zero-padded to the canonical YYYY-MM-DD /
  //     HH:MM the rest of the suite stores and string-sorts on (an AI emits 2026-7-1).
  const I1 = await req('POST', '/api/import', { items: [
    { title: 'lenient datetime', date: '2026-7-1', time: '9:05', tags: ['lenient'] },
  ] });
  ok(I1.status === 201, `I1: created (got ${I1.status} ${JSON.stringify(I1.json)})`);
  const li = (await list('?tags=lenient'))[0];
  ok(li?.due_date === '2026-07-01', `I1: date zero-padded 2026-7-1 → 2026-07-01 (got ${li?.due_date})`);
  ok(li?.scheduled_time === '09:05', `I1: time zero-padded 9:05 → 09:05 (got ${li?.scheduled_time})`);

  // I.2 a structurally-shaped but impossible calendar date is rejected, not stored
  //     (a bare regex would accept it → Invalid Date poisons every view that parses it).
  const beforeBad = (await list()).length;
  const I2 = await req('POST', '/api/import', { items: [{ title: 'bad date', due_date: '2026-13-45' }] });
  ok(I2.status === 400, `I2: impossible date rejected 400 (got ${I2.status})`);
  ok(I2.json?.errors?.some((e) => /due_date/.test(e)), 'I2: error names the bad date field');
  ok((await list()).length === beforeBad, 'I2: nothing written for the impossible date');

  // I.3 Feb 30 (round-trips to Mar 2) and an out-of-range clock time are both rejected.
  const I3 = await req('POST', '/api/import', { items: [
    { title: 'feb30',    due_date: '2026-02-30' },
    { title: 'bad time', scheduled_time: '25:00' },
  ] });
  ok(I3.status === 400 && (I3.json?.errors?.length >= 2),
    `I3: Feb-30 + 25:00 both rejected (got ${I3.status} ${JSON.stringify(I3.json?.errors)})`);

  // I.4 an explicitly-empty children array is a LEAF (task), not an empty goal.
  const I4 = await req('POST', '/api/import', { items: [{ title: 'no kids', children: [], tags: ['nokids'] }] });
  ok(I4.status === 201 && I4.json?.created === 1, `I4: created 1 (got ${I4.status} ${I4.json?.created})`);
  const nk = (await list('?tags=nokids'))[0];
  ok(nk?.kind === 'task', `I4: empty children → task, not goal (got ${nk?.kind})`);
} catch (e) {
  console.error('harness error:', e);
  fail++;
} finally {
  done();
}
