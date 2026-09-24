'use strict';
// session/routes.js — the listening session over HTTP: one live stream DOWN (SSE),
// plain POSTs UP. Every KourOS instance signed in as one listener sees the same
// session, any of them can be the OUTPUT (the one device that plays), and every other
// is a remote control for it — Spotify Connect's shape (Jag, 2026-09-23).
//
// ⭐ THE SERVER RELAYS; IT NEVER PLAYS. A command ("pause", "next", "play this album")
// is forwarded to the output device, which applies it through its own player and
// then REPORTS the state it actually landed in (POST /state). The session in the
// database is therefore always "what the output says is true" — never a guess the
// server made about what a command would do. Queue logic lives in exactly one place
// (the player), and a speaker daemon that registers later needs no queue logic here.
//
//   GET    /api/session                 snapshot: session + devices (+ online) + serverNow
//   GET    /api/session/events?device=  the live stream: hello, session, devices,
//                                       command (to the output only), reauth, pings
//   POST   /api/session/devices         register/refresh THIS device
//   PATCH  /api/session/devices/:id     rename
//   DELETE /api/session/devices/:id     forget an OFFLINE device
//   POST   /api/session/state           the OUTPUT device's report of what it is doing
//   POST   /api/session/commands        relay one command to the output (or a volume
//                                       to a named device)
//   POST   /api/session/transfer        make another device the output
//
// Security: every route is behind weaveAuth (server.js's /api gate) and every write
// is POST/PATCH/DELETE, so weaveWriteGate + `kouros:write` apply — ⚠️ never PUT, which
// the write gate does not cover. Everything is keyed by req.user.sub; a device id
// only names a device within its own listener. Bodies are validated whole
// (session/validate.js) before anything is stored or relayed.

const { randomUUID } = require('crypto');
const { Router } = require('express');
const { withIdempotency, idempotencyKeyOf, idempotencyKeyError } = require('@jkos/weave/server');
const V = require('./validate');

/** Keep-alive comment cadence. Under the edge's 60 s proxy_read_timeout and
 *  Cloudflare's 100 s idle cut, with room for a slow write. */
const PING_MS = 20_000;
/** A stream never outlives its token (below); without an `exp` (the dev stub) it is
 *  still recycled on this ceiling, so development exercises the reconnect too. */
const MAX_STREAM_MS = 15 * 60_000;
/** How long the OUTPUT may be gone (no open stream) while the session says it is
 *  playing, before the server records it paused. Long enough to ride out a `reauth`
 *  recycle or a phone hopping networks — the device reconnects and reports within
 *  it, and nobody sees a flicker — and short enough that a laptop lid closed
 *  mid-song reads as "paused at 2:14" everywhere within seconds, not "playing" for
 *  ever. */
const OFFLINE_GRACE_MS = 8_000;
/** How long a PLAYING session may go without a report from its output before the
 *  output is presumed gone. The client reports at least every 15 s while playing
 *  (src/session/usePlayerSession.ts's HEARTBEAT_MS), so this is three missed. */
const REPORT_STALE_MS = 45_000;

/** Per-listener token bucket for the write doors — a remote held on a "volume up"
 *  key, or a misbehaving client, must not be able to flood every device. */
function createLimiter({ perSec = 20, burst = 60 } = {}) {
  const buckets = new Map();
  return (userId) => {
    const k = String(userId);
    const now = Date.now();
    const b = buckets.get(k) || { tokens: burst, at: now };
    b.tokens = Math.min(burst, b.tokens + ((now - b.at) / 1000) * perSec);
    b.at = now;
    if (b.tokens < 1) { buckets.set(k, b); return false; }
    b.tokens -= 1;
    buckets.set(k, b);
    return true;
  };
}

/** Thrown inside the idempotent relay when no device can take the command — so the
 *  refusal rolls back instead of being remembered as the key's answer. */
class NoTarget extends Error {
  constructor(target) { super('no online target'); this.target = target || null; }
}

/** The position a playing session has reached NOW, extrapolated from its last
 *  report. The server's own answer — used to hand a transfer's new output a start
 *  point; clients do the same arithmetic for their scrubbers. */
function livePositionMs(s, now = Date.now()) {
  if (!s.playing || !s.reported_at) return s.position_ms;
  const since = Math.max(0, now - Date.parse(s.reported_at));
  return Math.round(s.position_ms + since * (s.rate || 1));
}

function createSessionRouter({ db, store, hub, offlineGraceMs = OFFLINE_GRACE_MS, reportStaleMs = REPORT_STALE_MS }) {
  const router = Router();
  const limited = createLimiter();
  /** userId → the pending "the output went away" timer (below). */
  const gone = new Map();
  /** userId → the report watchdog (below). */
  const stale = new Map();

  const uid = (req) => req.user && req.user.sub;
  const snapshot = (userId) => ({
    session: store.session(userId),
    devices: store.devices(userId, hub.online(userId)),
    serverNow: new Date().toISOString(),
  });
  const publishSession = (userId, session) => hub.publish(userId, 'session', { session, serverNow: new Date().toISOString() });
  const publishDevices = (userId) => hub.publish(userId, 'devices', { devices: store.devices(userId, hub.online(userId)) });
  const bad = (res, error) => res.status(400).json({ error });
  const conflict = (res, code, error, extra) => res.status(409).json({ error, code, ...extra });

  function throttle(req, res) {
    if (limited(uid(req))) return false;
    res.status(429).json({ error: 'Too many session writes — slow down', code: 'RATE_LIMITED' });
    return true;
  }

  /* ⚠️ THE OUTPUT CAN VANISH WITHOUT SAYING SO. A tab that closes cleanly reports
     `playing:false` on its way out (the client's pagehide keepalive); a laptop whose
     lid shuts, a phone that loses signal, a crashed tab, does not — and the session
     would go on saying "playing" for ever, every remote scrubber running on past a
     player that stopped. So when the output's LAST stream closes while the session
     is playing, wait out the grace and then record it paused where it had got to.
     The output stays the output: if it comes back and reports, it resumes the
     session — nothing else has to happen for a flaky network to heal.
     ⚠️ "Where it had got to" is extrapolated to the moment the stream CLOSED, not
     to the moment the timer fires — that would credit the listener with the whole
     grace period of music nobody heard. */
  function watchOutput(userId, deviceId) {
    const s = store.session(userId);
    // Only the OUTPUT's absence matters — and a remote closing must never cancel a
    // pause already pending for it, so this returns before touching the timer.
    if (s.active_device !== deviceId) return;
    clearTimeout(gone.get(String(userId)));
    gone.delete(String(userId));
    if (hub.online(userId).has(deviceId) || !s.playing) return;
    const closedAt = Date.now();
    const timer = setTimeout(() => {
      gone.delete(String(userId));
      const now = store.session(userId);
      if (now.active_device !== deviceId || !now.playing || hub.online(userId).has(deviceId)) return;
      // Still REPORTING since its stream dropped (its POSTs get through, its stream
      // does not): it is alive and playing, and saying otherwise would be the lie.
      if (Date.parse(now.reported_at) > closedAt) return;
      // Its sleep timer went with it — nothing is counting down any more.
      publishSession(userId, commit(userId, {
        ...now, position_ms: livePositionMs(now, closedAt), playing: false, sleep_mode: null, sleep_remaining_ms: null,
      }));
    }, offlineGraceMs);
    timer.unref();
    gone.set(String(userId), timer);
  }

  /* ⚠️ A SOCKET IS NOT A HEARTBEAT. The grace above starts when the output's stream
     CLOSES — and a phone that walks out of signal, or a laptop that sleeps, closes
     nothing: its TCP connection just stops answering, and the stream stays "open"
     until something times it out (nginx's send_timeout, a minute; a proxy that does
     not propagate aborts, never — the dev edge did exactly that). Meanwhile the
     session says "playing" and every remote's scrubber runs on.
     So the output's REPORTS are its heartbeat: while the session is playing, one
     must arrive every reportStaleMs, or the output is presumed gone — the session is
     recorded paused at the last position it REPORTED (the moment it stopped is not
     known; re-hearing a few seconds of an audiobook is harmless, skipping them is
     not), and its streams are dropped so presence stops claiming it. A device that
     was alive after all reconnects and reports, and the session resumes. Re-armed by
     every write that leaves the session playing (commit, below). */
  function watchReports(userId) {
    const k = String(userId);
    clearTimeout(stale.get(k));
    stale.delete(k);
    const s = store.session(userId);
    if (!s.playing || !s.active_device) return;
    const device = s.active_device;
    const anchor = s.reported_at;
    const timer = setTimeout(() => {
      stale.delete(k);
      const now = store.session(userId);
      if (!now.playing || now.active_device !== device || now.reported_at !== anchor) return;
      publishSession(userId, store.write(userId, { ...now, playing: false, sleep_mode: null, sleep_remaining_ms: null }));
      hub.drop(userId, device);
    }, reportStaleMs);
    timer.unref();
    stale.set(k, timer);
  }

  /** Every write to the session goes through here, so the watchdog can never be
   *  left armed for a session that stopped, or unarmed for one that started. */
  function commit(userId, facts) {
    const next = store.write(userId, facts);
    watchReports(userId);
    return next;
  }

  router.get('/api/session', (req, res) => {
    res.json(snapshot(uid(req)));
  });

  /* ── The live stream ─────────────────────────────────────────────────────────── */
  router.get('/api/session/events', (req, res) => { // app-private: a live SSE channel to this app's own instances — no GUI or peer binds a stream; the session it carries is the declared `session` dataset
    const userId = uid(req);
    const deviceId = V.deviceId(req.query.device);
    if (!deviceId) return bad(res, 'device must be this device\'s id (a UUID)');
    // Registered first (POST /devices): a stream is a read, and a read must not
    // write a device row as a side effect.
    if (!store.device(userId, deviceId)) {
      return res.status(404).json({ error: 'Register this device first (POST /api/session/devices)', code: 'UNKNOWN_DEVICE' });
    }

    let open = true;
    const write = (event, data) => {
      if (!open) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    const connId = hub.add(userId, deviceId, write, () => close());   // close() is hoisted, below
    if (!connId) return res.status(429).json({ error: 'Too many open streams for this listener', code: 'TOO_MANY_STREAMS' });

    res.status(200).set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      // no-transform: nothing between here and the browser may buffer or compress it.
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // nginx's proxy buffering would hold events back for as long as it liked; this
      // header switches it off for this response only (no nginx change needed).
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();

    // Back within the grace (a reauth recycle, a network hop): nothing is paused.
    if (store.session(userId).active_device === deviceId) {
      clearTimeout(gone.get(String(userId)));
      gone.delete(String(userId));
    }
    write('hello', { ...snapshot(userId), device: deviceId });
    publishDevices(userId);   // this device just came online — every other shows it

    const ping = setInterval(() => { if (open) res.write(': ping\n\n'); }, PING_MS);
    /* ⚠️ A STREAM MUST NOT OUTLIVE ITS CREDENTIAL. The token was checked once, when
       the stream opened; a long-lived channel that stayed open past `exp` would keep
       delivering a signed-out (or revoked) listener's session for as long as the
       socket lived. So it ends AT `exp`, saying why, and the client reopens through
       authFetch — which refreshes the cookie first. */
    const expMs = req.user && Number.isFinite(req.user.exp) ? req.user.exp * 1000 - Date.now() : MAX_STREAM_MS;
    const lifetime = Math.max(1000, Math.min(expMs, MAX_STREAM_MS));
    const reauth = setTimeout(() => { write('reauth', { reason: 'token-expiry' }); close(); }, lifetime);

    function close() {
      if (!open) return;
      open = false;
      clearInterval(ping);
      clearTimeout(reauth);
      hub.remove(userId, connId);
      try { res.end(); } catch { /* already gone */ }
      publishDevices(userId);   // offline, unless another tab of it holds a stream
      watchOutput(userId, deviceId);
    }
    // Both: Node 20 fires each on a client abort, but which one a given runtime or
    // proxy path fires first is not a contract — close() is idempotent.
    req.on('close', close);
    res.on('close', close);
    res.on('error', close);
  });

  /* ── Devices ─────────────────────────────────────────────────────────────────── */
  router.post('/api/session/devices', (req, res) => {
    if (throttle(req, res)) return;
    const b = req.body || {};
    const deviceId = V.deviceId(b.deviceId);
    const name = V.deviceName(b.name);
    const kind = V.deviceKind(b.kind);
    if (!deviceId || !name || !kind) return bad(res, 'deviceId (UUID), name (1–60 chars) and kind (desktop|phone|tablet|speaker) are required');
    const platform = b.platform == null ? null : V.deviceName(b.platform);
    const row = store.register(uid(req), { deviceId, name, kind, platform });
    publishDevices(uid(req));
    res.status(201).json({ device: store.devices(uid(req), hub.online(uid(req))).find((d) => d.id === row.device_id) });
  });

  router.patch('/api/session/devices/:id', (req, res) => {
    if (throttle(req, res)) return;
    const deviceId = V.deviceId(req.params.id);
    const name = V.deviceName(req.body && req.body.name);
    if (!deviceId || !name) return bad(res, 'a device id and a name (1–60 chars) are required');
    if (!store.rename(uid(req), deviceId, name)) return res.status(404).json({ error: 'No such device' });
    publishDevices(uid(req));
    res.json({ ok: true });
  });

  router.delete('/api/session/devices/:id', (req, res) => {
    if (throttle(req, res)) return;
    const userId = uid(req);
    const deviceId = V.deviceId(req.params.id);
    if (!deviceId) return bad(res, 'a device id is required');
    // An online device would simply re-register on its next boot; forgetting is for
    // a phone that was sold or a browser profile that is gone.
    if (hub.online(userId).has(deviceId)) return conflict(res, 'DEVICE_ONLINE', 'That device is online — close it first');
    if (!store.remove(userId, deviceId)) return res.status(404).json({ error: 'No such device' });
    const s = store.session(userId);
    if (s.active_device === deviceId) publishSession(userId, commit(userId, { ...s, active_device: null, playing: false }));
    publishDevices(userId);
    res.json({ ok: true });
  });

  /* ── The output's report ─────────────────────────────────────────────────────── */
  router.post('/api/session/state', (req, res) => {
    if (throttle(req, res)) return;
    const userId = uid(req);
    const b = req.body || {};
    const deviceId = V.deviceId(b.deviceId);
    if (!deviceId) return bad(res, 'deviceId is required');
    const r = V.stateReport(b);
    if (r.error) return bad(res, r.error);
    const s = store.session(userId);
    // Only the OUTPUT reports. Anyone else becomes the output by transfer first — so
    // two devices can never both believe they are playing the session.
    if (s.active_device !== deviceId) {
      return conflict(res, 'NOT_ACTIVE', 'This device is not the output — transfer to it first', { active_device: s.active_device });
    }
    const st = r.ok;
    store.touch(userId, deviceId, { volume: st.volume, muted: st.muted });
    const next = commit(userId, {
      active_device: deviceId, queue: st.queue, context: st.context, item_ref: st.item_ref,
      position_ms: st.position_ms, playing: st.playing, rate: st.rate,
      sleep_mode: st.sleep_mode, sleep_remaining_ms: st.sleep_remaining_ms,
    });
    publishSession(userId, st.error ? { ...next, error: st.error } : next);
    if (st.volume != null || st.muted != null) publishDevices(userId);
    res.json({ session: next });
  });

  /* ── Commands ────────────────────────────────────────────────────────────────── */
  router.post('/api/session/commands', (req, res) => {
    if (throttle(req, res)) return;
    const userId = uid(req);
    const r = V.command(req.body);
    if (r.error) return bad(res, r.error);
    const keyErr = idempotencyKeyError(req.body);   // present but unusable → refused, never a silent no-dedup
    if (keyErr) return res.status(400).json({ error: keyErr, code: 'VALIDATION' });
    const key = idempotencyKeyOf(req.body);
    const { from, op, args } = r.ok;
    // `from` is relayed to the output (which may say "paused from Phone"), so when
    // given it must name one of this listener's own registered devices.
    if (from && !store.device(userId, from)) {
      return res.status(404).json({ error: 'Register this device first (POST /api/session/devices)', code: 'UNKNOWN_DEVICE' });
    }

    /* ⭐ DEDUP AT THE WRITE DOOR (WEAVE §3.4). A relay is not idempotent by
       construction — "next" delivered twice skips two tracks — so a retried POST
       (a phone on a flaky network, a routine's re-delivered DO) must relay ONCE, and
       answer the retry with the first attempt's reply.
       ⚠️ "Nobody is online to take it" is decided INSIDE the wrapper and THROWN, not
       returned: a returned 409 would be remembered, and the same command retried a
       second after the output reconnects would be refused for a month. The throw
       rolls the key back with it. The online check still has to be inside rather than
       before, because a key that DID relay must replay its 202 even if the output
       has since gone — the command was delivered, and saying otherwise invites a
       third attempt. */
    let out;
    try {
      out = withIdempotency(db, {
        scope: 'kouros.session.commands', userId, key,
        write: () => {
          // A volume goes to the device it names; everything else to the output.
          const target = op === 'volume' ? args.device : store.session(userId).active_device;
          if (!target || !hub.online(userId).has(target)) throw new NoTarget(target);
          const id = key || randomUUID();
          hub.sendTo(userId, target, 'command', { id, from, op, args });
          return { status: 202, body: { relayed: true, target, id } };
        },
      });
    } catch (e) {
      if (!(e instanceof NoTarget)) throw e;
      return conflict(res, 'NO_ACTIVE_DEVICE', 'No device is online to take that command', { target: e.target });
    }
    if (out.replayed) res.set('Idempotent-Replay', 'true');
    res.status(out.status).json(out.body);
  });

  /* ── Transfer ────────────────────────────────────────────────────────────────── */
  router.post('/api/session/transfer', (req, res) => {
    if (throttle(req, res)) return;
    const userId = uid(req);
    const b = req.body || {};
    const to = V.deviceId(b.to);
    if (!to) return bad(res, 'to must be a device id');
    if (b.play != null && typeof b.play !== 'boolean') return bad(res, 'play must be a boolean');
    if (!store.device(userId, to)) return res.status(404).json({ error: 'No such device', code: 'UNKNOWN_DEVICE' });
    if (!hub.online(userId).has(to)) return conflict(res, 'DEVICE_OFFLINE', 'That device is not online');

    const s = store.session(userId);
    const from = s.active_device;
    const playing = b.play == null ? s.playing : b.play;
    // Where the music HAS got to, not where it was last reported — the new output
    // starts there, so a hand-off loses at most the report's staleness.
    // A sleep timer lived on the OLD output; the new one has none armed until it says so.
    const next = commit(userId, {
      ...s, active_device: to, position_ms: livePositionMs(s), playing, sleep_mode: null, sleep_remaining_ms: null,
    });
    // The server's own commands carry the same {id, from, op, args} shape a relayed
    // one does (from: null — no device sent them), so an output has one handler.
    if (from && from !== to) hub.sendTo(userId, from, 'command', { id: randomUUID(), from: null, op: 'release', args: {} });
    hub.sendTo(userId, to, 'command', { id: randomUUID(), from: null, op: 'takeover', args: { play: playing, session: next } });
    publishSession(userId, next);
    res.json({ session: next });
  });

  return router;
}

module.exports = { createSessionRouter, livePositionMs, createLimiter, PING_MS, MAX_STREAM_MS, OFFLINE_GRACE_MS };
