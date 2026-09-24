'use strict';
// session/validate.js — every shape the listening session accepts from a client,
// checked in one PURE place (no DB, no I/O), so the routes stay readable and the
// rules can be driven directly by a test.
//
// ⚠️ Everything here arrives from a browser the user controls, and the session is
// relayed to every OTHER device of that user. A malformed queue written once would
// be pushed to, and loaded by, every instance — so nothing is stored or relayed that
// has not passed through here. Refusal is a 400 with the reason; nothing is
// "repaired" into a value the caller did not send.

const { isPlayContext } = require('../playContext');

/** A device id is a client-generated UUID (crypto.randomUUID). It names a device
 *  only WITHIN one user — the table's key is (user_id, device_id) — so a guessed or
 *  forged id can at most name one of the caller's own devices. */
const DEVICE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KINDS = new Set(['desktop', 'phone', 'tablet', 'speaker']);
/** A queue item: a bare track id (legacy), `kouros:<id>` or `book:<id>` — the
 *  grammar of src/player/sources.ts's encodeRef/decodeRef, and nothing else. */
const REF = /^(?:(?:kouros|book):)?\d{1,12}$/;
const REPEAT = new Set(['off', 'all', 'one']);
/** @jkos/player's SleepMode, less 'off' (absent = off): minutes, or end of chapter. */
const SLEEP = new Set(['15', '30', '45', '60', 'segment']);
const MAX_QUEUE = 5000;
const MAX_NAME = 60;
const MAX_POSITION_MS = 7 * 24 * 3600 * 1000;   // a week: longer than any audiobook

const isInt = (v) => Number.isInteger(v);
const isBool = (v) => typeof v === 'boolean';

function deviceId(v) {
  return typeof v === 'string' && DEVICE_ID.test(v) ? v.toLowerCase() : null;
}

/** A display name: trimmed, 1–60 chars, no control characters. */
function deviceName(v) {
  if (typeof v !== 'string') return null;
  const s = v.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return s.length >= 1 && s.length <= MAX_NAME ? s : null;
}

function deviceKind(v) {
  return typeof v === 'string' && KINDS.has(v) ? v : null;
}

function ref(v) {
  if (typeof v === 'number' && isInt(v) && v >= 0) return String(v);
  return typeof v === 'string' && REF.test(v) ? v : null;
}

/** The queue the output device reports — `@jkos/player/core`'s Queue, exactly:
 *  { items: string[], cursor, policy: { shuffle, repeat, shuffleSeed, shuffleOrder } }.
 *  Returns the normalised queue, or an error string. */
function queue(v) {
  if (!v || typeof v !== 'object') return 'queue must be an object';
  if (!Array.isArray(v.items) || v.items.length > MAX_QUEUE) return `queue.items must be an array of at most ${MAX_QUEUE}`;
  const items = [];
  for (const it of v.items) {
    const r = ref(it);
    if (r == null) return 'queue.items holds something that is not a track or book ref';
    items.push(r);
  }
  const n = items.length;
  if (!isInt(v.cursor) || v.cursor < -1 || v.cursor >= n || (n === 0) !== (v.cursor === -1)) {
    return 'queue.cursor must index queue.items (-1 exactly when it is empty)';
  }
  const p = v.policy;
  if (!p || typeof p !== 'object') return 'queue.policy must be an object';
  if (!isBool(p.shuffle) || !REPEAT.has(p.repeat) || typeof p.shuffleSeed !== 'number' || !Number.isFinite(p.shuffleSeed)) {
    return 'queue.policy needs shuffle (boolean), repeat (off|all|one) and a finite shuffleSeed';
  }
  if (!Array.isArray(p.shuffleOrder) || p.shuffleOrder.length > MAX_QUEUE) {
    return 'queue.policy.shuffleOrder must be an array';
  }
  /* While shuffle is ON the order is what next/prev walk, so it must be a whole
     permutation of the items — every reducer keeps it one (resyncShuffle, removeAt's
     re-shuffle). While shuffle is OFF it means nothing (Queue's own type: "Empty while
     shuffle is off"), and it is NOT kept in step: `shuffle(q, false)` leaves the last
     order in place and nothing resyncs it, so shuffle-on → off → remove one leaves an
     order longer than the queue with an index past its end. Refusing that would 400
     every report of a perfectly working player until shuffle came back on — so an
     off order is dropped, not judged (session.smoke.mjs drives exactly that queue). */
  let shuffleOrder = [];
  if (p.shuffle) {
    const seen = new Set();
    for (const i of p.shuffleOrder) if (isInt(i) && i >= 0 && i < n) seen.add(i);
    if (p.shuffleOrder.length !== n || seen.size !== n) {
      return 'queue.policy.shuffleOrder must be a permutation of queue.items while shuffle is on';
    }
    shuffleOrder = [...p.shuffleOrder];
  }
  return { items, cursor: v.cursor, policy: { shuffle: p.shuffle, repeat: p.repeat, shuffleSeed: p.shuffleSeed, shuffleOrder } };
}

function positionMs(v) {
  return isInt(v) && v >= 0 && v <= MAX_POSITION_MS ? v : null;
}

function rate(v) {
  return typeof v === 'number' && v >= 0.5 && v <= 3 ? v : null;
}

function volume(v) {
  return typeof v === 'number' && v >= 0 && v <= 1 ? v : null;
}

/** The output device's report: the state it is actually in. Returns
 *  { ok: state } or { error }. */
function stateReport(b) {
  if (!b || typeof b !== 'object') return { error: 'body must be an object' };
  const q = queue(b.queue);
  if (typeof q === 'string') return { error: q };
  const item = b.item_ref == null ? null : ref(b.item_ref);
  if (b.item_ref != null && item == null) return { error: 'item_ref must be a track or book ref' };
  if (b.context != null && !isPlayContext(b.context)) return { error: 'context must be a KourOS route (src/playContext.js)' };
  const pos = positionMs(b.position_ms);
  if (pos == null) return { error: 'position_ms must be a whole number of milliseconds' };
  if (!isBool(b.playing)) return { error: 'playing must be a boolean' };
  const r = rate(b.rate);
  if (r == null) return { error: 'rate must be between 0.5 and 3' };
  const vol = b.volume == null ? null : volume(b.volume);
  if (b.volume != null && vol == null) return { error: 'volume must be between 0 and 1' };
  if (b.muted != null && !isBool(b.muted)) return { error: 'muted must be a boolean' };
  const err = b.error == null ? null : (typeof b.error === 'string' && b.error.length <= 64 ? b.error : undefined);
  if (err === undefined) return { error: 'error must be a short code' };
  /* The sleep timer runs ON the output, so without this a remote would show "off"
     while a 30-minute timer counted down on the laptop across the room. Remaining is
     anchored at reported_at exactly like the position; 'segment' (end of chapter) has
     no clock, so no remaining. */
  const sleepMode = b.sleep_mode == null || b.sleep_mode === 'off' ? null : b.sleep_mode;
  if (sleepMode != null && !SLEEP.has(sleepMode)) return { error: 'sleep_mode must be off, 15, 30, 45, 60 or segment' };
  const sleepMs = b.sleep_remaining_ms == null ? null : positionMs(b.sleep_remaining_ms);
  if (b.sleep_remaining_ms != null && (sleepMs == null || sleepMode == null || sleepMode === 'segment')) {
    return { error: 'sleep_remaining_ms is whole milliseconds, and only for a timed sleep_mode' };
  }
  return {
    ok: {
      queue: q, item_ref: item, context: b.context || null, position_ms: pos, playing: b.playing, rate: r,
      volume: vol, muted: b.muted == null ? null : b.muted, error: err,
      sleep_mode: sleepMode, sleep_remaining_ms: sleepMs,
    },
  };
}

/* ── Commands ─────────────────────────────────────────────────────────────────
   What one device asks the OUTPUT device to do. The server relays, it does not
   play: the output applies each command through its own player and reports the
   state it lands in (routes.js). So a command is validated for SHAPE here, and its
   effect is whatever the output's player makes of it. */
const COMMANDS = {
  play: () => ({}),
  pause: () => ({}),
  seek: (a) => (positionMs(a && a.position_ms) != null ? { position_ms: a.position_ms } : 'seek needs position_ms'),
  skip: (a) => (a && isInt(a.delta_ms) && Math.abs(a.delta_ms) <= 3600e3 ? { delta_ms: a.delta_ms } : 'skip needs delta_ms (±1 h)'),
  next: () => ({}),
  prev: () => ({}),
  segment: (a) => (a && (a.dir === 'next' || a.dir === 'prev') ? { dir: a.dir } : 'segment needs dir next|prev'),
  jump: (a) => (a && isInt(a.index) && a.index >= 0 && a.index < MAX_QUEUE ? { index: a.index } : 'jump needs an index'),
  load: (a) => {
    if (!a || !Array.isArray(a.items) || a.items.length === 0 || a.items.length > MAX_QUEUE) return `load needs 1–${MAX_QUEUE} items`;
    const items = a.items.map(ref);
    if (items.some((r) => r == null)) return 'load.items holds something that is not a track or book ref';
    if (!isInt(a.startIndex) || a.startIndex < 0 || a.startIndex >= items.length) return 'load.startIndex must index items';
    if (a.position_ms != null && positionMs(a.position_ms) == null) return 'load.position_ms must be whole milliseconds';
    if (a.context != null && !isPlayContext(a.context)) return 'load.context must be a KourOS route';
    return { items, startIndex: a.startIndex, position_ms: a.position_ms == null ? null : a.position_ms, context: a.context || null };
  },
  enqueue: (a) => {
    if (!a || !Array.isArray(a.items) || a.items.length === 0 || a.items.length > MAX_QUEUE) return `enqueue needs 1–${MAX_QUEUE} items`;
    const items = a.items.map(ref);
    if (items.some((r) => r == null)) return 'enqueue.items holds something that is not a track or book ref';
    if (a.where !== 'next' && a.where !== 'end') return 'enqueue needs where next|end';
    return { items, where: a.where };
  },
  remove: (a) => (a && isInt(a.index) && a.index >= 0 ? { index: a.index } : 'remove needs an index'),
  reorder: (a) => (a && isInt(a.from) && isInt(a.to) && a.from >= 0 && a.to >= 0 ? { from: a.from, to: a.to } : 'reorder needs from and to'),
  shuffle: (a) => (a && isBool(a.on) ? { on: a.on } : 'shuffle needs on'),
  repeat: (a) => (a && REPEAT.has(a.mode) ? { mode: a.mode } : 'repeat needs mode off|all|one'),
  rate: () => ({}),   // cycle the book rate one preset (the player's own verb)
  sleep: (a) => (a && ['off', '15', '30', '45', '60', 'segment'].includes(a.mode) ? { mode: a.mode } : 'sleep needs a mode'),
  /* Addressed to a NAMED device rather than the output: every device keeps its own
     volume (Jag, 2026-09-23), and the picker sets any of them. */
  volume: (a) => {
    if (!a || deviceId(a.device) == null) return 'volume needs a device';
    const v = a.level == null ? null : volume(a.level);
    if (a.level != null && v == null) return 'volume.level must be between 0 and 1';
    if (a.muted != null && !isBool(a.muted)) return 'volume.muted must be a boolean';
    if (v == null && a.muted == null) return 'volume needs level and/or muted';
    return { device: deviceId(a.device), level: v, muted: a.muted == null ? null : a.muted };
  },
};

/** { ok: { from, op, args } } or { error }.
 *
 *  `from` is OPTIONAL: a KourOS instance names itself, but a command may come from
 *  something that is not a device at all — a BeigeBoard routine's DO ("pause the
 *  music at 11"), a script on a service token. Deduplication is the suite's own
 *  `idempotency_key` (WEAVE §3.4), read by the route, not a field of this shape: a
 *  bespoke key name would be one the trigger engine never sends. */
function command(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return { error: 'body must be an object' };
  let from = null;
  if (b.from != null) {
    from = deviceId(b.from);
    if (!from) return { error: 'from, when given, must be the sending device id (a UUID)' };
  }
  const make = COMMANDS[b.op];
  if (typeof b.op !== 'string' || !make || !Object.prototype.hasOwnProperty.call(COMMANDS, b.op)) {
    return { error: `op must be one of ${Object.keys(COMMANDS).join(', ')}` };
  }
  const args = make(b.args);
  if (typeof args === 'string') return { error: args };
  return { ok: { from, op: b.op, args } };
}

module.exports = {
  deviceId, deviceName, deviceKind, ref, queue, positionMs, rate, volume, stateReport, command,
  COMMAND_OPS: Object.freeze(Object.keys(COMMANDS)), MAX_QUEUE, MAX_NAME,
};
