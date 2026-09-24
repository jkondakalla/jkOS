// session/usePlayerSession.ts — THIS tab's engine, joined to the listening session.
//
// Jag, 2026-09-23: every KourOS instance signed in as one listener shows the same
// session; any of them can be the OUTPUT; every other is a remote for it; routing is
// Spotify's (anything you play from here plays on the output, and moving it is an
// explicit choice). This hook is where that stops being a protocol and becomes a
// player. It owns the tab's one engine and decides, from the session and the output
// lock, which of four things the tab is (session/route.ts), and everything follows
// from that one answer:
//
//   local   the engine plays; this tab REPORTS what it is doing and APPLIES commands
//   remote  the surfaces show the output's session (session/remote.ts) and every verb
//           is a command; the engine is silent
//   idle    nothing plays anywhere reachable; the engine holds the session's item
//           CUED at its second, so every device shows the same pause — and the
//           moment the engine starts playing (a press here, a view's request), this
//           tab CLAIMS the output
//   solo    no session (an old backend, a guest): the engine, exactly as before
//
// ⭐ ONE PATH FOR "DO X TO THE PLAYER". A command arriving at the output is applied
// through the same local PlayerApi a press on its own screen calls, so there is no
// second implementation of "next track" that could disagree with the first.
//
// ⚠️ THE DEVICE YOU TOUCH PLAYS — AND THE TOUCH IS WHAT MAKES THE SOUND. A browser
// only lets audio start inside a user gesture on the page making it (and iOS only in
// the gesture's own call stack). So a claim never waits on the network: the engine
// starts playing at once, on the press, and the transfer to this device follows. The
// takeover the server then sends back carries the OLD session, so for a few seconds
// after a claim of our own, a takeover is acknowledged and not adopted — or it would
// swap the album just chosen for the one it replaced.

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { DEFAULT_MESSAGES } from '@jkos/player/engine';
import type { SleepMode } from '@jkos/player/engine';
import { usePlayerEngine, type LocalPlayerApi, type PlayerApi } from '../player/usePlayerEngine';
import { decodeRef, encodeRef } from '../player/sources';
import { requestLocalEnqueue, requestLocalPlay, setPlayRouter } from '../player/controller';
import {
  announceSessionVolume, getSessionSnapshot, onSessionCommand, reportSessionState, sendSessionCommand, serverNow, startSession,
  subscribeSession, transferSession, type ListeningSession, type SessionCommand, type SessionDevice,
  type SessionSnapshot, type StateReport,
} from './client';
import { extrapolateMs } from './clock';
import { modeOf, type SessionMode } from './route';
import { awaitOutputLock, claimOutputLock, holdsOutputLock, onOutputLock, outputLockedElsewhere, releaseOutputLock } from './outputLock';
import { useRemotePlayer } from './remote';

/** While playing, the output reports at least this often — the anchor a remote's
 *  scrubber extrapolates from never gets older than this. */
const HEARTBEAT_MS = 15_000;
/** Edges arriving together (a track change is item + queue + position) report once. */
const REPORT_COALESCE_MS = 150;
/** How far a position may jump from where playing would have taken it before it
 *  counts as a SEEK worth reporting — from any path: a scrubber, a rune, the lock
 *  screen's seekto. */
const SEEK_JUMP_SEC = 1.5;
/** After this tab claims the output itself, the takeover echo is ignored this long. */
const SELF_CLAIM_MS = 5_000;
/** The longest reports wait for the engine to load an item it was just handed. */
const LOAD_HOLD_MS = 10_000;

const sameItem = (a: string | null | undefined, b: string | null | undefined) => {
  if (a == null || b == null) return a == null && b == null;
  const x = decodeRef(a); const y = decodeRef(b);
  return x.src === y.src && x.id === y.id;
};
const canonicalRef = (r: string) => { const d = decodeRef(r); return encodeRef(d.src, d.id); };

export interface PlayerSessionInfo {
  mode: SessionMode;
  snapshot: SessionSnapshot;
  /** The session's output device, when there is one. */
  output: SessionDevice | null;
  /** This device's row (for the picker's "This device"). */
  me: SessionDevice | null;
  /** Move playback to a device — this one ("Play here") or any other online one. */
  transferTo(deviceId: string): void;
}

export function useSessionSnapshot(): SessionSnapshot {
  return useSyncExternalStore(subscribeSession, getSessionSnapshot, getSessionSnapshot);
}

function useOutputLock(rev: number | undefined): { held: boolean; elsewhere: boolean } {
  const [held, setHeld] = useState(holdsOutputLock);
  const [elsewhere, setElsewhere] = useState(false);
  useEffect(() => onOutputLock(setHeld), []);
  // Another tab's lock is not an event here — re-ask whenever the session moves (a
  // tab that took it has just reported) or this tab's own hold changes.
  useEffect(() => {
    let cancelled = false;
    outputLockedElsewhere().then((v) => { if (!cancelled) setElsewhere(v); });
    return () => { cancelled = true; };
  }, [held, rev]);
  return { held, elsewhere };
}

export function useSessionPlayer(): { api: PlayerApi; local: LocalPlayerApi; info: PlayerSessionInfo } {
  useEffect(() => startSession(), []);
  const snapshot = useSessionSnapshot();
  const s = snapshot.session;
  const me = snapshot.me.id;
  const lock = useOutputLock(s?.rev);
  const outputRow = s?.active_device ? snapshot.devices.find((d) => d.id === s.active_device) ?? null : null;
  const mode = modeOf({
    available: snapshot.status !== 'unavailable' && snapshot.status !== 'starting',
    active: s?.active_device ?? null,
    me,
    activeOnline: !!outputRow?.online,
    holdsLock: lock.held,
    lockElsewhere: lock.elsewhere,
  });

  const local = usePlayerEngine({ mediaSession: mode !== 'remote' });

  // The latest of everything, for the handlers below that must not re-subscribe
  // every render (the command listener, the router, the heartbeat).
  const localRef = useRef(local); localRef.current = local;
  const modeRef = useRef(mode); modeRef.current = mode;
  const selfClaimUntil = useRef(0);

  /* ⚠️ AN ENGINE THAT WAS JUST HANDED AN ITEM HAS NOT LOADED IT YET. adopt() installs
     the queue at once, but the item arrives with a network round trip — until then
     the engine says "no item, position 0". A report in that window (a reloaded
     output claims its lock in milliseconds and reports 150 ms later; a takeover or a
     "Play here" reports straight after) erased the session's item and second on
     every remote — and for good, if the load failed or the tab closed first. So
     every adopt goes through here, and reports hold until the engine holds an item
     other than the one it had (or errors, or LOAD_HOLD_MS passes). */
  const loading = useRef<{ from: string | null; until: number } | null>(null);
  const adoptInto = useCallback((L: LocalPlayerApi, a: Parameters<LocalPlayerApi['adopt']>[0]) => {
    if (a.queue.items.length > 0 && a.queue.cursor >= 0) {
      loading.current = { from: L.item?.ref ?? null, until: Date.now() + LOAD_HOLD_MS };
    }
    L.adopt(a);
  }, []);
  const holding = () => {
    const l = loading.current;
    if (l && Date.now() >= l.until) loading.current = null;
    return loading.current;
  };

  /* ── Reporting (mode local) ────────────────────────────────────────────────────── */
  const buildReport = useCallback((): StateReport => {
    const L = localRef.current;
    const sleep: SleepMode = L.sleepMode;
    return {
      queue: L.queue,
      context: L.context,
      item_ref: L.item ? L.item.ref : null,
      position_ms: Math.max(0, Math.round(L.livePosition() * 1000)),
      playing: L.playing,
      rate: L.rate,
      volume: L.volume,
      muted: L.muted,
      sleep_mode: sleep === 'off' ? null : sleep,
      sleep_remaining_ms: sleep !== 'off' && sleep !== 'segment' && L.sleepRemainingMs != null ? Math.round(L.sleepRemainingMs) : null,
      error: L.error === DEFAULT_MESSAGES.autoplayBlocked ? 'autoplay-blocked' : null,
    };
  }, []);

  const reportTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reportNow = useCallback(() => {
    if (reportTimer.current) { clearTimeout(reportTimer.current); reportTimer.current = null; }
    const held = holding();
    if (held) {
      // Reported when the item lands (below), or when the hold runs out.
      reportTimer.current = setTimeout(() => { reportTimer.current = null; if (modeRef.current === 'local') reportNow(); }, held.until - Date.now());
      return;
    }
    void reportSessionState(buildReport());
  }, [buildReport]);
  const scheduleReport = useCallback(() => {
    if (reportTimer.current) return;
    reportTimer.current = setTimeout(() => { reportTimer.current = null; if (modeRef.current === 'local') reportNow(); }, REPORT_COALESCE_MS);
  }, [reportNow]);

  // The handed item landed (or failed): the hold is over, and the truth goes out.
  useEffect(() => {
    const l = loading.current;
    if (!l) return;
    const ref = local.item?.ref ?? null;
    if (!local.error && (ref === null || ref === l.from)) return;
    loading.current = null;
    if (reportTimer.current) { clearTimeout(reportTimer.current); reportTimer.current = null; }
    if (modeRef.current === 'local') scheduleReport();
  }, [local.item?.ref, local.error]); // eslint-disable-line react-hooks/exhaustive-deps

  // Every edge a remote would see.
  useEffect(() => {
    if (mode === 'local') scheduleReport();
  }, [mode, local.playing, local.item?.ref, local.queue, local.context, local.rate, local.volume, local.muted,
    local.sleepMode, local.error, scheduleReport]);

  // A seek, from whatever made it.
  const lastPos = useRef({ pos: 0, at: 0 });
  useEffect(() => {
    const now = performance.now();
    const last = lastPos.current;
    if (mode === 'local' && last.at) {
      const expected = last.pos + (local.playing ? ((now - last.at) / 1000) * (local.rate || 1) : 0);
      if (Math.abs(local.globalPos - expected) > SEEK_JUMP_SEC) scheduleReport();
    }
    lastPos.current = { pos: local.globalPos, at: now };
  }, [local.globalPos]); // eslint-disable-line react-hooks/exhaustive-deps

  // The heartbeat, while playing.
  useEffect(() => {
    if (mode !== 'local' || !local.playing) return;
    const t = setInterval(reportNow, HEARTBEAT_MS);
    return () => clearInterval(t);
  }, [mode, local.playing, reportNow]);

  // Leaving: the audio stops with the page, so say so while a request can still go.
  useEffect(() => {
    const onHide = () => {
      if (modeRef.current !== 'local') return;
      // Mid-load there is nothing true to say; the server's grace pauses the session.
      if (holding()) return;
      void reportSessionState({ ...buildReport(), playing: false }, { keepalive: true });
    };
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }, [buildReport]);

  // Not the output: nothing reports this device's volume, so it announces it — once
  // it is live, and on every change (the picker, a remote's fader, this screen's).
  const live = snapshot.status === 'live';
  useEffect(() => {
    if (!live || mode === 'local' || mode === 'solo') return;
    const t = setTimeout(() => void announceSessionVolume(local.volume, local.muted), 400);
    return () => clearTimeout(t);
  }, [live, mode === 'local', local.volume, local.muted]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Claiming the output ───────────────────────────────────────────────────────── */
  const claimHere = useCallback(async () => {
    selfClaimUntil.current = Date.now() + SELF_CLAIM_MS;
    await claimOutputLock({ steal: true });
    // The transfer writes the OLD session's facts with this device as the output;
    // the truth is what this engine is doing, so report it straight after.
    if (await transferSession(me, true)) reportNow();
  }, [me, reportNow]);

  // The engine started playing while this tab was NOT the output — a press on this
  // screen, a view's request, the lock screen. The device you touch becomes the one
  // playing.
  const prevPlaying = useRef(local.playing);
  useEffect(() => {
    const was = prevPlaying.current;
    prevPlaying.current = local.playing;
    if (was || !local.playing) return;
    if (mode !== 'idle' && mode !== 'remote') return;
    if (Date.now() < selfClaimUntil.current) return;   // a claim (or a takeover) already under way
    void claimHere();
  }, [local.playing]); // eslint-disable-line react-hooks/exhaustive-deps

  // The session names this device, but no tab of it plays (a reload, a crashed tab):
  // this tab takes the lock and becomes the output — paused, and saying so — rather
  // than leave every remote believing a song is still playing here.
  useEffect(() => {
    if (mode === 'idle' && s?.active_device === me && !lock.elsewhere) void claimOutputLock();
  }, [mode, s?.active_device, me, lock.elsewhere]);

  // This DEVICE is the output and another of its tabs plays it: wait in line for the
  // lock, so that when that tab closes this one inherits the device at once. ⚠️ A
  // one-off "is it held?" query answered too early: the closing tab's goodbye report
  // lands before its document (and its lock) is gone, so the query still said
  // "held elsewhere", and nothing ever asked again — the tab sat as a remote of its
  // own device, ignoring its own commands.
  useEffect(() => {
    if (s?.active_device !== me || lock.held || !lock.elsewhere) return;
    const ac = new AbortController();
    awaitOutputLock(ac.signal);
    return () => ac.abort();
  }, [s?.active_device, me, lock.held, lock.elsewhere]);

  // No longer the output (transferred away, or another tab of this browser took it):
  // stop making sound. Derived from the session rather than trusted to the `release`
  // command alone, so a lost command cannot leave two devices playing.
  useEffect(() => {
    if (mode !== 'remote') return;
    localRef.current.pause();
    if (holdsOutputLock() && getSessionSnapshot().session?.active_device !== me) releaseOutputLock();
  }, [mode, me]);

  /* ── The cue: every device shows the session, paused at its second ─────────────── */
  const cued = useRef<string | null>(null);   // `${ref}@${rev}` last cued — and the ref it left in the engine
  const cuedRef = useRef<string | null>(null);
  useEffect(() => {
    if (mode !== 'idle' && mode !== 'local') return;
    if (!s || !s.item_ref || s.queue.items.length === 0 || s.queue.cursor < 0) return;
    const engineRef = local.item?.ref ?? null;
    // Only ever replace a CUE — never something the listener chose on this screen,
    // and never an output's engine that is already holding an item.
    if (local.playing) return;
    if (engineRef !== null && (mode === 'local' || engineRef !== cuedRef.current)) return;
    const key = `${s.item_ref}@${s.rev}`;
    if (cued.current === key) return;
    cued.current = key;
    cuedRef.current = canonicalRef(s.item_ref);
    adoptInto(local, { queue: s.queue, context: s.context, position: extrapolateMs(s, serverNow()) / 1000, autoplay: false });
  }, [mode, s?.rev, local.item?.ref, local.playing]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Commands, at the output ───────────────────────────────────────────────────── */
  useEffect(() => onSessionCommand((cmd: SessionCommand) => {
    const L = localRef.current;
    const a = cmd.args || {};
    const snap = getSessionSnapshot();
    if (cmd.op === 'volume') {
      // Every device keeps its own volume, and the picker sets any of them.
      if (a.device !== snap.me.id) return;
      if (a.level != null) L.setVolume(a.level);
      if (a.muted != null) L.setMuted(a.muted);
      return;
    }
    if (cmd.op === 'takeover') { void takeOver(cmd, L); return; }
    if (cmd.op === 'release') {
      // Stop the sound now; the LOCK goes when the session says the output moved
      // (the effect above). ⚠️ Releasing it here opened a gap: the command arrives a
      // moment before the session event naming the new output, and in that moment
      // this tab read as "idle, the session names me, the lock is free" — and took
      // the lock straight back.
      if (holdsOutputLock()) L.pause();
      return;
    }
    // Everything else is for the tab that PLAYS this device — not its other tabs.
    if (!holdsOutputLock() || snap.session?.active_device !== snap.me.id) return;
    applyCommand(cmd.op, a, L, snap.session);
  }), []); // eslint-disable-line react-hooks/exhaustive-deps

  async function takeOver(cmd: SessionCommand, L: LocalPlayerApi) {
    // This tab asked for it (a press here): the engine is already playing what was
    // chosen; the takeover's session is the one it replaced.
    if (Date.now() < selfClaimUntil.current) { reportNow(); return; }
    // Moved here from another device. Whichever tab of this browser already plays
    // keeps playing; otherwise the first tab to hear it takes the lock.
    if (!(await claimOutputLock())) return;
    selfClaimUntil.current = Date.now() + SELF_CLAIM_MS;   // its playing edge is not a claim of its own
    const next: ListeningSession | undefined = cmd.args?.session;
    const play = !!cmd.args?.play;
    if (!next || !next.item_ref || next.queue.items.length === 0 || next.queue.cursor < 0) { reportNow(); return; }
    const at = extrapolateMs(next, serverNow()) / 1000;
    if (L.item && sameItem(L.item.ref, next.item_ref)) {
      // Already holding it (a cue): only the position and the play state move.
      L.seekTo(at);
      if (play) L.play(); else L.pause();
    } else {
      adoptInto(L, { queue: next.queue, context: next.context, position: at, autoplay: play });
    }
    scheduleReport();
  }

  function applyCommand(op: string, a: any, L: LocalPlayerApi, sess: ListeningSession | null) {
    switch (op) {
      case 'play':
        if (!L.item && sess?.item_ref) {
          adoptInto(L, { queue: sess.queue, context: sess.context, position: sess.position_ms / 1000, autoplay: true });
        } else L.play();
        break;
      case 'pause': L.pause(); break;
      case 'seek': L.seekTo(a.position_ms / 1000); break;
      case 'skip': L.skip(a.delta_ms / 1000); break;
      case 'next': L.trackNext(); break;
      case 'prev': L.trackPrev(); break;
      case 'segment': if (a.dir === 'next') L.nextSegment(); else L.prevSegment(); break;
      case 'jump': L.playQueueItem(a.index); break;
      case 'load':
        requestLocalPlay({
          trackIds: a.items, startIndex: a.startIndex,
          position: a.position_ms == null ? undefined : a.position_ms / 1000,
          context: a.context ?? undefined,
        });
        break;
      case 'enqueue': requestLocalEnqueue({ trackIds: a.items, where: a.where }); break;
      case 'remove': L.removeQueueItem(a.index); break;
      case 'reorder': L.reorderQueue(a.from, a.to); break;
      case 'shuffle': L.setShuffle(!!a.on); break;
      case 'repeat': L.setRepeat(a.mode); break;
      case 'rate': L.cycleRate(); break;
      case 'sleep': L.setSleep(a.mode); break;
      default: return;   // an op this build does not know — a newer remote; ignore, never guess
    }
    scheduleReport();
  }

  /* ── The router: where a VIEW's request plays ──────────────────────────────────── */
  useEffect(() => setPlayRouter({
    play(req) {
      if (modeRef.current !== 'remote') { requestLocalPlay(req); return; }
      const items = req.trackIds.map(String);
      if (!items.length) return;
      void sendSessionCommand('load', {
        items,
        startIndex: Math.min(Math.max(0, req.startIndex), items.length - 1),
        ...(req.position != null ? { position_ms: Math.round(req.position * 1000) } : {}),
        context: req.context ?? null,
      }).then((r) => {
        // The output went away between the snapshot and the press: play it here.
        if (r.code === 'NO_ACTIVE_DEVICE') requestLocalPlay(req);
      });
    },
    enqueue(req) {
      if (modeRef.current !== 'remote') { requestLocalEnqueue(req); return; }
      void sendSessionCommand('enqueue', { items: req.trackIds.map(String), where: req.where }).then((r) => {
        if (r.code === 'NO_ACTIVE_DEVICE') requestLocalEnqueue(req);
      });
    },
  }), []);

  /* ── What the surfaces read ────────────────────────────────────────────────────── */
  const remote = useRemotePlayer(s, outputRow, mode === 'remote', local);

  const transferTo = useCallback((deviceId: string) => {
    const snap = getSessionSnapshot();
    const sess = snap.session;
    if (deviceId !== snap.me.id) { void transferSession(deviceId); return; }
    // "Play here": start the sound INSIDE this press (the gesture is what the browser
    // allows audio on), then make it official.
    selfClaimUntil.current = Date.now() + SELF_CLAIM_MS;
    const L = localRef.current;
    if (sess && sess.item_ref && sess.queue.items.length && sess.queue.cursor >= 0) {
      const at = extrapolateMs(sess, serverNow()) / 1000;
      if (L.item && sameItem(L.item.ref, sess.item_ref)) { L.seekTo(at); L.play(); }
      else adoptInto(L, { queue: sess.queue, context: sess.context, position: at, autoplay: true });
    }
    void claimHere();
  }, [claimHere]);

  const info = useMemo<PlayerSessionInfo>(() => ({
    mode,
    snapshot,
    output: outputRow,
    me: snapshot.devices.find((d) => d.id === me) ?? null,
    transferTo,
  }), [mode, snapshot, outputRow, me, transferTo]);

  return { api: mode === 'remote' ? remote : local, local, info };
}
