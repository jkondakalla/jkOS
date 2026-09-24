'use strict';
// session/store.js — the listening session and the device list, in SQLite.
//
// ONE session per listener (`listening_session`, keyed by user_id): what is playing,
// where, the queue it came from, and the last position the OUTPUT device reported.
// It outlives every device — close the laptop mid-song and every other device still
// shows that song, paused at the second the laptop last reported, ready to resume.
//
// `rev` is the session's version: bumped on every write, carried on every event, so a
// client applies a snapshot only if it is newer than the one it holds.
//
// `reported_at` is the anchor a remote device extrapolates the moving position from —
// position_ms + (now − reported_at) × rate, while playing — and a TRIGGER stamps it on
// EVERY write (TRAPS.md: a stamp belongs to the database, not to each route that
// writes). Every writer hands in a position that is true NOW: the output's report, a
// transfer's extrapolated hand-off point, the pause written when the output vanishes.
// ⚠️ It used to be stamped only when a fact CHANGED, which is wrong exactly when it
// matters: an output stalled on a buffer reports the SAME position twice while
// "playing", the anchor stayed at the first report, and every remote scrubber ran on
// ahead of a player that had not moved.
//
// Devices are persisted so a NAME and a volume survive a reload; whether a device is
// ONLINE is not stored at all — it is the hub's live answer (session/hub.js).

const { SQL_NOW } = require('@jkos/weave/server');

const EMPTY_QUEUE = Object.freeze({
  items: [], cursor: -1, policy: { shuffle: false, repeat: 'off', shuffleSeed: 0, shuffleOrder: [] },
});

/** DDL for server.js's migrations — kept beside the queries that read it. */
const SESSION_DDL = `
  CREATE TABLE IF NOT EXISTS listening_session (
    user_id       INTEGER PRIMARY KEY,
    rev           INTEGER NOT NULL DEFAULT 0,
    active_device TEXT,
    queue         TEXT    NOT NULL,
    context       TEXT,
    item_ref      TEXT,
    position_ms   INTEGER NOT NULL DEFAULT 0,
    playing       INTEGER NOT NULL DEFAULT 0,
    rate          REAL    NOT NULL DEFAULT 1,
    sleep_mode    TEXT,                             -- the output's sleep timer; NULL = off
    sleep_remaining_ms INTEGER,                     -- at reported_at; NULL for 'segment'
    reported_at   TEXT    DEFAULT (${SQL_NOW}),
    updated_at    TEXT    DEFAULT (${SQL_NOW})
  );
  -- The inner UPDATE does not re-fire this trigger: SQLite's recursive_triggers is
  -- off unless a connection turns it on, and nothing here does.
  DROP TRIGGER IF EXISTS listening_session_stamp;
  CREATE TRIGGER listening_session_stamp AFTER UPDATE ON listening_session
    FOR EACH ROW
    BEGIN
      UPDATE listening_session SET reported_at = ${SQL_NOW}, updated_at = ${SQL_NOW}
       WHERE user_id = NEW.user_id;
    END;
`;

const DEVICES_DDL = `
  CREATE TABLE IF NOT EXISTS devices (
    user_id      INTEGER NOT NULL,
    device_id    TEXT    NOT NULL,
    name         TEXT    NOT NULL,
    kind         TEXT    NOT NULL CHECK (kind IN ('desktop', 'phone', 'tablet', 'speaker')),
    platform     TEXT,
    volume       REAL,
    muted        INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT    DEFAULT (${SQL_NOW}),
    last_seen_at TEXT    DEFAULT (${SQL_NOW}),
    PRIMARY KEY (user_id, device_id)
  );
`;

/** Migration 15's body: the sleep columns, on a table migration 13 built before them.
 *  A fresh database already has them (SESSION_DDL), so this only ALTERs an older one —
 *  migration 12's precedent. */
function addSleepColumns(db) {
  const cols = new Set(db.prepare('PRAGMA table_info(listening_session)').all().map((c) => c.name));
  if (!cols.has('sleep_mode')) db.exec('ALTER TABLE listening_session ADD COLUMN sleep_mode TEXT');
  if (!cols.has('sleep_remaining_ms')) db.exec('ALTER TABLE listening_session ADD COLUMN sleep_remaining_ms INTEGER');
}

/** A device unseen this long is forgotten on the next registration (the suite has no
 *  scheduler — a prune rides a write). */
const DEVICE_TTL_DAYS = 90;

function createSessionStore(db) {
  const q = {
    get: db.prepare('SELECT * FROM listening_session WHERE user_id = ?'),
    playing: db.prepare('SELECT user_id FROM listening_session WHERE playing = 1'),
    upsert: db.prepare(`
      INSERT INTO listening_session (user_id, rev, active_device, queue, context, item_ref, position_ms, playing, rate,
                                     sleep_mode, sleep_remaining_ms)
      VALUES (@user_id, 1, @active_device, @queue, @context, @item_ref, @position_ms, @playing, @rate,
              @sleep_mode, @sleep_remaining_ms)
      ON CONFLICT(user_id) DO UPDATE SET
        rev = rev + 1, active_device = @active_device, queue = @queue, context = @context,
        item_ref = @item_ref, position_ms = @position_ms, playing = @playing, rate = @rate,
        sleep_mode = @sleep_mode, sleep_remaining_ms = @sleep_remaining_ms`),
    devices: db.prepare('SELECT * FROM devices WHERE user_id = ? ORDER BY last_seen_at DESC'),
    device: db.prepare('SELECT * FROM devices WHERE user_id = ? AND device_id = ?'),
    register: db.prepare(`
      INSERT INTO devices (user_id, device_id, name, kind, platform)
      VALUES (@user_id, @device_id, @name, @kind, @platform)
      ON CONFLICT(user_id, device_id) DO UPDATE SET
        kind = @kind, platform = @platform, last_seen_at = ${SQL_NOW},
        -- A registration re-sends the device's DEFAULT name every boot; it must not
        -- overwrite one the listener chose. Only a rename (PATCH) changes a name.
        name = CASE WHEN @rename = 1 THEN @name ELSE name END`),
    rename: db.prepare('UPDATE devices SET name = ? WHERE user_id = ? AND device_id = ?'),
    remove: db.prepare('DELETE FROM devices WHERE user_id = ? AND device_id = ?'),
    touch: db.prepare(`UPDATE devices SET last_seen_at = ${SQL_NOW},
      volume = COALESCE(@volume, volume), muted = COALESCE(@muted, muted)
      WHERE user_id = @user_id AND device_id = @device_id`),
    prune: db.prepare(`DELETE FROM devices WHERE user_id = ? AND last_seen_at < ?`),
  };

  function toSession(row) {
    if (!row) {
      return {
        rev: 0, active_device: null, queue: EMPTY_QUEUE, context: null, item_ref: null,
        position_ms: 0, playing: false, rate: 1, sleep_mode: null, sleep_remaining_ms: null, reported_at: null,
      };
    }
    let queue = EMPTY_QUEUE;
    try { queue = JSON.parse(row.queue); } catch { /* validated on the way in; never expected */ }
    return {
      rev: row.rev, active_device: row.active_device, queue, context: row.context, item_ref: row.item_ref,
      position_ms: row.position_ms, playing: !!row.playing, rate: row.rate,
      sleep_mode: row.sleep_mode ?? null, sleep_remaining_ms: row.sleep_remaining_ms ?? null,
      reported_at: row.reported_at,
    };
  }

  function toDevice(row, online) {
    return {
      id: row.device_id, name: row.name, kind: row.kind, platform: row.platform,
      volume: row.volume, muted: !!row.muted, last_seen_at: row.last_seen_at,
      online: online.has(row.device_id),
    };
  }

  return {
    EMPTY_QUEUE,

    session(userId) {
      return toSession(q.get.get(userId));
    },

    /** Every listener whose session says it is playing — what a boot must re-watch. */
    playingUsers() {
      return q.playing.all().map((r) => r.user_id);
    },

    /** Replace the session's facts; returns the new session (rev bumped). */
    write(userId, s) {
      q.upsert.run({
        user_id: userId,
        active_device: s.active_device ?? null,
        queue: JSON.stringify(s.queue ?? EMPTY_QUEUE),
        context: s.context ?? null,
        item_ref: s.item_ref ?? null,
        position_ms: Math.max(0, Math.round(s.position_ms ?? 0)),
        playing: s.playing ? 1 : 0,
        rate: s.rate ?? 1,
        sleep_mode: s.sleep_mode ?? null,
        sleep_remaining_ms: s.sleep_remaining_ms == null ? null : Math.max(0, Math.round(s.sleep_remaining_ms)),
      });
      return toSession(q.get.get(userId));
    },

    devices(userId, online) {
      return q.devices.all(userId).map((r) => toDevice(r, online));
    },

    device(userId, deviceId) {
      return q.device.get(userId, deviceId) || null;
    },

    register(userId, { deviceId, name, kind, platform }) {
      const cutoff = new Date(Date.now() - DEVICE_TTL_DAYS * 864e5).toISOString();
      q.prune.run(userId, cutoff);
      q.register.run({ user_id: userId, device_id: deviceId, name, kind, platform: platform ?? null, rename: 0 });
      return q.device.get(userId, deviceId);
    },

    rename(userId, deviceId, name) {
      return q.rename.run(name, userId, deviceId).changes > 0;
    },

    remove(userId, deviceId) {
      return q.remove.run(userId, deviceId).changes > 0;
    },

    /** A report from a device: it is alive, and (when it says) this is its volume. */
    touch(userId, deviceId, { volume = null, muted = null } = {}) {
      q.touch.run({ user_id: userId, device_id: deviceId, volume, muted: muted == null ? null : (muted ? 1 : 0) });
    },
  };
}

module.exports = { createSessionStore, SESSION_DDL, DEVICES_DDL, addSleepColumns, EMPTY_QUEUE, DEVICE_TTL_DAYS };
