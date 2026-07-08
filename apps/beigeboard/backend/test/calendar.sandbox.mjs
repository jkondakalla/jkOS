// TEST-8 — calendar sync sandbox (harness for BUG-2 + ARCH-3).
//
// Drives the pure per-provider normalizers (normalizeGoogle/normalizeOutlook/
// normalizeICal) with fixture upstream payloads — no HTTP, no real accounts — plus
// the shared writer's wipe guard and the secret-at-rest round-trip. Asserts:
//   • cross-provider CONSISTENCY: the SAME logical event as Google JSON / Graph JSON
//     / ICS normalizes to the SAME row (the invariant ARCH-3's one contract buys);
//   • all-day EXCLUSIVE-end handling agrees across providers;
//   • malformed / empty upstream is skipped, never thrown;
//   • the iCloud TZID + RRULE LIMITATIONS are pinned as documented behaviour (so a
//     future ical.js swap is a deliberate, test-visible change);
//   • the empty-upstream WIPE GUARD (BUG-2): skip unless ?force, and honest counts;
//   • CALENDAR_ENC_KEY round-trips (encrypt → not-plaintext → decrypt) + the legacy
//     plaintext passthrough.
//
// Env is set BEFORE any src/ require so the calendar modules open a throwaway DB and
// crypto sees a key. Run under TZ=UTC so wall-clock normalization is deterministic.
//
//   node apps/beigeboard/backend/test/calendar.sandbox.mjs

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

process.env.TZ = 'UTC';                       // deterministic local wall-clock
const tmp = mkdtempSync(join(tmpdir(), 'bb-cal-'));
process.env.DB_PATH = join(tmp, 'test.db');
process.env.CALENDAR_ENC_KEY = 'a'.repeat(64); // 64 hex → AES-256 key
process.env.NODE_ENV = '';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { normalizeGoogle }  = require('../src/calendar/google.js');
const { normalizeOutlook } = require('../src/calendar/outlook.js');
const { normalizeICal }    = require('../src/calendar/icloud.js');
const { replaceCalendarSource } = require('../src/calendar/replace.js');
const { encryptSecret, decryptSecret } = require('../src/crypto.js');
const { run, all } = require('../src/db.js');

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error('  ✗ ' + msg); } };
const sched = (e) => e && ({ due_date: e.due_date, scheduled_time: e.scheduled_time, scheduled_end: e.scheduled_end, end_date: e.end_date });
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function done() {
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
  console.log(`\ncalendar.sandbox: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

try {
  // ── A. cross-provider consistency: one UTC timed event, three upstream shapes ──
  const g = normalizeGoogle([{ summary: 'Team sync', description: 'd', location: 'Room 1',
    start: { dateTime: '2026-07-10T09:00:00Z' }, end: { dateTime: '2026-07-10T10:00:00Z' } }]);
  const o = normalizeOutlook([{ subject: 'Team sync', bodyPreview: 'd', location: { displayName: 'Room 1' },
    isAllDay: false, start: { dateTime: '2026-07-10T09:00:00', timeZone: 'UTC' }, end: { dateTime: '2026-07-10T10:00:00', timeZone: 'UTC' } }]);
  const c = normalizeICal(
    'BEGIN:VEVENT\r\nSUMMARY:Team sync\r\nDESCRIPTION:d\r\nLOCATION:Room 1\r\nDTSTART:20260710T090000Z\r\nDTEND:20260710T100000Z\r\nEND:VEVENT');
  ok(g.length === 1 && o.length === 1 && c.length === 1, 'A: each provider yields exactly one event');
  const want = { due_date: '2026-07-10', scheduled_time: '09:00', scheduled_end: '10:00', end_date: null };
  ok(eq(sched(g[0]), want), `A: google schedule = ${JSON.stringify(sched(g[0]))}`);
  ok(eq(sched(o[0]), want), `A: outlook schedule = ${JSON.stringify(sched(o[0]))}`);
  ok(eq(sched(c[0]), want), `A: icloud schedule = ${JSON.stringify(sched(c[0]))}`);
  ok(eq(sched(g[0]), sched(o[0])) && eq(sched(o[0]), sched(c[0])), 'A: same-event-same-times across all three providers');
  ok(g[0].title === 'Team sync' && o[0].title === 'Team sync' && c[0].title === 'Team sync', 'A: title agrees');
  ok(g[0].location === 'Room 1' && o[0].location === 'Room 1' && c[0].location === 'Room 1', 'A: location agrees');

  // ── B. all-day multi-day: EXCLUSIVE upstream end → INCLUSIVE last day, agreeing ──
  const gAllDay = normalizeGoogle([{ summary: 'Trip', start: { date: '2026-07-10' }, end: { date: '2026-07-12' } }]);
  const oAllDay = normalizeOutlook([{ subject: 'Trip', isAllDay: true,
    start: { dateTime: '2026-07-10T00:00:00', timeZone: 'UTC' }, end: { dateTime: '2026-07-12T00:00:00', timeZone: 'UTC' } }]);
  const cAllDay = normalizeICal(
    'BEGIN:VEVENT\r\nSUMMARY:Trip\r\nDTSTART;VALUE=DATE:20260710\r\nDTEND;VALUE=DATE:20260712\r\nEND:VEVENT');
  const wantAllDay = { due_date: '2026-07-10', scheduled_time: null, scheduled_end: null, end_date: '2026-07-11' };
  ok(eq(sched(gAllDay[0]), wantAllDay), `B: google all-day = ${JSON.stringify(sched(gAllDay[0]))}`);
  ok(eq(sched(oAllDay[0]), wantAllDay), `B: outlook all-day = ${JSON.stringify(sched(oAllDay[0]))}`);
  ok(eq(sched(cAllDay[0]), wantAllDay), `B: icloud all-day = ${JSON.stringify(sched(cAllDay[0]))}`);

  // ── C. single all-day (no multi-day) → end_date null across providers ──
  const g1 = normalizeGoogle([{ summary: 'Holiday', start: { date: '2026-07-10' }, end: { date: '2026-07-11' } }]);
  const c1 = normalizeICal('BEGIN:VEVENT\r\nSUMMARY:Holiday\r\nDTSTART;VALUE=DATE:20260710\r\nDTEND;VALUE=DATE:20260711\r\nEND:VEVENT');
  ok(g1[0].end_date === null && g1[0].scheduled_time === null, 'C: google single all-day → no end_date, no time');
  ok(c1[0].end_date === null && c1[0].scheduled_time === null, 'C: icloud single all-day → no end_date, no time');

  // ── D. malformed / empty upstream is skipped, never thrown ──
  ok(normalizeGoogle([{ description: 'no start' }]).length === 0, 'D: google event with no start → skipped');
  ok(normalizeOutlook([{ subject: 'no end', start: { dateTime: '2026-07-10T09:00:00', timeZone: 'UTC' } }]).length === 0, 'D: outlook event missing end → skipped');
  ok(normalizeICal('BEGIN:VEVENT\r\nSUMMARY:no start\r\nEND:VEVENT').length === 0, 'D: icloud VEVENT with no DTSTART → skipped');
  ok(normalizeGoogle([]).length === 0 && normalizeOutlook(undefined).length === 0 && normalizeICal('').length === 0, 'D: empty/absent upstream → []');
  ok(normalizeGoogle(null).length === 0, 'D: null items → []');

  // ── E. PINNED iCloud limitations (documented in icloud.js header) ──
  //     TZID ignored: a zoned local time is stored as its raw wall-clock, NOT converted.
  const tz = normalizeICal('BEGIN:VEVENT\r\nSUMMARY:Zoned\r\nDTSTART;TZID=America/New_York:20260710T090000\r\nDTEND;TZID=America/New_York:20260710T100000\r\nEND:VEVENT');
  ok(tz.length === 1 && tz[0].scheduled_time === '09:00' && tz[0].scheduled_end === '10:00',
    `E: iCloud TZID is ignored — raw wall time 09:00 stored (got ${tz[0]?.scheduled_time})`);
  //     RRULE not expanded: a recurring VEVENT contributes only its base instance.
  const rr = normalizeICal('BEGIN:VEVENT\r\nSUMMARY:Daily standup\r\nDTSTART:20260710T090000Z\r\nDTEND:20260710T091500Z\r\nRRULE:FREQ=DAILY;COUNT=3\r\nEND:VEVENT');
  ok(rr.length === 1, `E: iCloud RRULE is not expanded — one base instance only (got ${rr.length})`);

  // ── F. empty-upstream WIPE GUARD (BUG-2), driven through the shared writer ──
  const insert = (source) => run('INSERT INTO items (user_id,kind,scope,title,source) VALUES (?,?,?,?,?)', [1, 'event', 'day', 'x', source]);
  const count = (source) => all('SELECT id FROM items WHERE user_id=1 AND source=?', [source]).length;
  insert('google'); insert('google');
  const guard = replaceCalendarSource('google', 1, [], { force: false });
  ok(guard.skipped === true && guard.reason === 'empty-upstream' && guard.synced === 0, 'F: empty upstream with local rows → skipped {reason:empty-upstream}');
  ok(count('google') === 2, 'F: guard preserved the 2 local rows (no wipe)');
  const forced = replaceCalendarSource('google', 1, [], { force: true });
  ok(forced.skipped === false && forced.synced === 0 && count('google') === 0, 'F: ?force=1 overrides the guard → rows wiped');
  const wrote = replaceCalendarSource('google', 1, [[1, 'event', 'day', 'new', null, 'google', '2026-07-10', null, null, null, null]], { force: false });
  ok(wrote.synced === 1 && wrote.skipped === false && count('google') === 1, 'F: a non-empty upstream replaces normally');
  const emptyNoLocal = replaceCalendarSource('outlook', 1, [], { force: false });
  ok(emptyNoLocal.synced === 0 && emptyNoLocal.skipped === false, 'F: empty upstream with NO local rows → synced 0, not "skipped" (nothing to protect)');

  // ── G. secret-at-rest round-trip (CALENDAR_ENC_KEY set) ──
  const ct = encryptSecret('refresh-token-xyz');
  ok(typeof ct === 'string' && ct.startsWith('enc:v1:'), 'G: encryptSecret tags ciphertext enc:v1:');
  ok(ct !== 'refresh-token-xyz' && !ct.includes('refresh-token-xyz'), 'G: ciphertext does not contain the plaintext');
  ok(decryptSecret(ct) === 'refresh-token-xyz', 'G: decryptSecret round-trips the value');
  ok(decryptSecret('legacy-plaintext') === 'legacy-plaintext', 'G: legacy un-tagged rows pass through (safe key rollout)');
  ok(encryptSecret(null) === null, 'G: null secret passes through untouched');
} catch (e) {
  console.error('calendar.sandbox crashed:', e);
  fail++;
} finally {
  done();
}
