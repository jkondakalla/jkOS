// usePlayerEngine.ts — the playback engine behind PlayerBar (task 5.4).
//
// One persistent <audio> element (created imperatively, never re-created across
// requests) plus one source of truth: `globalPos`, seconds across the whole book. The
// engine maps that to a per-file (fileIndex, offset) via position.ts on the way OUT to
// <audio>, and back on every `timeupdate` on the way IN. Everything else — the
// scrubber, chapter nav, sleep timer, bookmarks, the debounced progress upsert —
// reasons purely in global seconds and never touches the file boundaries directly.
//
// Design notes:
//  • Authoritative playback data lives in refs (no stale closures inside <audio>
//    event handlers); a thin layer of useState mirrors only what the bar renders.
//  • The whole imperative API is built ONCE via a lazy ref init, closing over the
//    (stable) refs + setState, so every handler identity is stable for the lifetime
//    of the mount — the effect wiring never needs to re-subscribe.
import { useEffect, useMemo, useRef, useState } from 'react';
import { authFetch } from '@jkos/auth-client';
import {
  coverUrl, createBookmark, createProgress, deleteBookmark, getBook,
  listBookmarks, listProgress, streamUrl, updateProgress,
  type BookDetail, type BookmarkRow, type ProgressRow,
} from '../api';
import { onPlayRequest, publishPosition, type PlayRequest } from './controller';
import {
  buildFileMap, clamp, currentNav, EMPTY_MAP, locate, navPoints, toGlobal,
  type FileMap, type NavPoint,
} from './position';

export const RATE_PRESETS = [0.75, 1, 1.25, 1.5, 1.75, 2, 2.5] as const;
export type SleepMode = 'off' | '15' | '30' | '45' | '60' | 'chapter';

const RATE_KEY = 'papyros.player.rate';   // papyros-namespaced (task requirement)
const SKIP_SEC = 30;
const PROGRESS_DEBOUNCE_MS = 5000;
const PREV_RESTART_SEC = 3;   // >3s into a chapter, "prev" restarts it (the standard idiom)

// ── Compat-pipeline recovery (decode-failure auto-fallback) ────────────────────────
// Firefox's strict mp4parse rejects the moov box on some otherwise-valid .m4b files
// (NS_ERROR_DOM_MEDIA_METADATA_ERR) that ffmpeg itself decodes cleanly — the backend's
// two-rung compat pipeline (apps/papyros/backend/src/media.js) normalizes the
// container server-side on request: POST <streamUrl>/prepare kicks off (or joins) an
// ffmpeg run, the client polls the same route until it reports {ready:true}, then
// reloads the file with `?compat=<n>` appended so /api/stream serves the generated
// variant instead of the source.
const COMPAT_POLL_INTERVAL_MS = 2000;
const COMPAT_POLL_TIMEOUT_MS = 120_000;   // ~120s bound — a rung that never finishes gives up, not hangs forever

/** Per-(bookId,fileIndex) key into the session-only compat-level map — matches the
 *  `${bookId}-${fileIndex}` naming src/media.js keys its cached variants by (though
 *  this key is only ever used client-side, never sent on the wire). */
function compatKeyFor(bookId: number, fileIndex: number): string {
  return `${bookId}:${fileIndex}`;
}

function readInitialRate(): number {
  try {
    const v = Number(localStorage.getItem(RATE_KEY));
    return (RATE_PRESETS as readonly number[]).includes(v) ? v : 1;
  } catch {
    return 1;
  }
}

export interface PlayerApi {
  visible: boolean;
  book: BookDetail | null;
  playing: boolean;
  buffering: boolean;
  /** Human-readable playback failure (decode/network/autoplay-blocked), null when fine.
   *  Cleared on the next successful `play` or file load. Without this, a MediaError or
   *  a rejected play() is INVISIBLE — the bar just sits paused (bit us on staging). */
  error: string | null;
  globalPos: number;
  total: number;
  rate: number;
  points: NavPoint[];
  currentIndex: number;
  chapterLabel: string | null;
  bookmarks: BookmarkRow[];
  sleepMode: SleepMode;
  sleepRemainingMs: number | null;
  toggle(): void;
  seekTo(globalSec: number): void;
  skip(deltaSec: number): void;
  prevChapter(): void;
  nextChapter(): void;
  cycleRate(): void;
  setSleep(mode: SleepMode): void;
  addBookmarkHere(): void;
  jumpBookmark(pos: number): void;
  removeBookmark(id: number): void;
}

export function usePlayerEngine(): PlayerApi {
  // ── Rendered state (only what the bar draws) ──────────────────────────────
  const [visible, setVisible] = useState(false);
  const [book, setBook] = useState<BookDetail | null>(null);
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [globalPos, setGlobalPos] = useState(0);
  const [rate, setRate] = useState<number>(readInitialRate);
  const [bookmarks, setBookmarks] = useState<BookmarkRow[]>([]);
  const [sleepMode, setSleepMode] = useState<SleepMode>('off');
  const [sleepRemainingMs, setSleepRemainingMs] = useState<number | null>(null);

  // ── Authoritative refs (read inside <audio> event handlers) ───────────────
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const bookRef = useRef<BookDetail | null>(null);
  const mapRef = useRef<FileMap>(EMPTY_MAP);
  const pointsRef = useRef<NavPoint[]>([]);
  const arrayIndexRef = useRef(0);           // current playlist cursor
  const rateRef = useRef(rate);
  const pendingSeekRef = useRef<number | null>(null);   // in-file offset to apply on loadedmetadata
  const wantPlayRef = useRef(false);         // autoplay intent for the loading file
  const globalPosRef = useRef(0);
  const progressRowRef = useRef<ProgressRow | null>(null);
  const writeTimerRef = useRef<number | null>(null);
  const writeInFlightRef = useRef(false);
  const writeQueuedRef = useRef<boolean | null>(null);  // latest queued finished-flag
  const lastWrittenRef = useRef<{ pos: number; finished: boolean } | null>(null);
  const reqSeqRef = useRef(0);               // guards racing async loads
  // Session-only memory of which compat rung (0 none, 1 remux, 2 re-encode) is active
  // for a given (bookId, fileIndex) — bumped by attemptCompatRecovery below, read by
  // loadFile to append `?compat=<n>` to the stream URL. `recoveringRef` is the
  // reentrancy guard: an error arriving while a recovery is already in flight (e.g. a
  // stray event off the src loadFile is about to replace) must not spawn a second,
  // parallel poll loop.
  const compatLevelRef = useRef<Map<string, 0 | 1 | 2>>(new Map());
  const recoveringRef = useRef(false);
  const sleepRef = useRef<{ mode: SleepMode; until: number | null; chapterEnd: number | null }>(
    { mode: 'off', until: null, chapterEnd: null },
  );
  const sleepTimerRef = useRef<number | null>(null);
  const lastPublishRef = useRef(0);          // Date.now() of the last publishPosition() call

  // ── The imperative engine, built exactly once (stable closures over refs) ──
  const engineRef = useRef<ReturnType<typeof buildEngine> | null>(null);
  if (!engineRef.current) engineRef.current = buildEngine();
  const eng = engineRef.current;

  function buildEngine() {
    // ---- Live position broadcast (controller.ts's publishPosition) ----------
    // Immediate on loads/seeks (so BookDetail's chapter fill snaps to a nav click
    // rather than waiting on the next throttled tick); onTime below throttles its
    // own calls to ~1/s since timeupdate fires ~4x/s.
    function publishNow(g: number): void {
      const b = bookRef.current;
      if (b) publishPosition({ bookId: b.id, globalPos: g });
      lastPublishRef.current = Date.now();
    }

    // ---- Progress upsert (serialized find-or-create, skip-unchanged) --------
    async function doWrite(finished: boolean): Promise<void> {
      const b = bookRef.current;
      if (!b) return;
      const posInt = Math.floor(globalPosRef.current);
      const last = lastWrittenRef.current;
      if (last && last.pos === posInt && last.finished === finished) return;   // unchanged
      if (writeInFlightRef.current) { writeQueuedRef.current = finished; return; }
      writeInFlightRef.current = true;
      const payload = {
        book_ref: b.id,
        position: globalPosRef.current,
        duration: mapRef.current.total,
        last_played: new Date().toISOString(),
        finished,
      };
      try {
        const row = progressRowRef.current
          ? await updateProgress(progressRowRef.current.id, payload)
          : await createProgress(payload);
        // Guard against a late write for the OUTGOING book (a swap can start while
        // this one is in flight): only adopt the row/cursor if it's still this book.
        if (bookRef.current && bookRef.current.id === row.book_ref) {
          progressRowRef.current = row;
          lastWrittenRef.current = { pos: posInt, finished };
        }
      } catch {
        /* non-fatal — a later tick retries with the newer position */
      } finally {
        writeInFlightRef.current = false;
      }
      const queued = writeQueuedRef.current;
      if (queued != null) { writeQueuedRef.current = null; void doWrite(queued); }
    }

    function scheduleWrite(): void {
      if (writeTimerRef.current != null) return;   // one 5s window at a time
      writeTimerRef.current = window.setTimeout(() => {
        writeTimerRef.current = null;
        void doWrite(false);
      }, PROGRESS_DEBOUNCE_MS);
    }

    function flushNow(): void {
      if (writeTimerRef.current != null) { clearTimeout(writeTimerRef.current); writeTimerRef.current = null; }
      void doWrite(false);
    }

    // ---- Play rejection / media error surfacing -----------------------------
    // A rejected play() or a MediaError used to be swallowed silently — the bar sat
    // paused with zero signal (bit us on staging: "playback doesn't work"). Surface
    // both; onPlay/loadFile clear the message once something works again.
    function playFailed(err: unknown): void {
      const name = (err as { name?: string } | null)?.name;
      if (name === 'AbortError') return;   // load() superseded the play() — routine, not a failure
      console.error('[papyros] play() rejected', err);
      setPlaying(false);
      if (name === 'NotAllowedError') {
        // Autoplay policy: the deferred play() outlived the click's transient
        // activation (slow metadata load — e.g. an 80MB moov-at-end m4b). Pressing
        // the bar's play button is a fresh gesture and will succeed.
        setError('Autoplay blocked — press play to start.');
      } else if (name === 'NotSupportedError') {
        setError('This audio format is not supported by your browser.');
      } else {
        setError('Playback failed — see the browser console.');
      }
    }

    // ---- Loading a file into the persistent <audio> ------------------------
    function loadFile(arrayIndex: number, offset: number, autoplay: boolean): void {
      const audio = audioRef.current;
      const b = bookRef.current;
      const map = mapRef.current;
      if (!audio || !b) return;
      const file = map.files[arrayIndex];
      if (!file) return;
      setError(null);
      arrayIndexRef.current = arrayIndex;
      pendingSeekRef.current = Math.max(0, offset);
      wantPlayRef.current = autoplay;
      // A prior decode failure on this exact (book, file) may have bumped its compat
      // level this session (attemptCompatRecovery below) — replay that choice on every
      // load so a re-seek/re-open doesn't retry the raw original and fail again.
      // Start on the pre-generated lossless remux when the server says it's ready
      // (compat_ready off /api/book) — Firefox's mp4parse rejects some real-world m4b
      // moovs, so beginning on the normalized container skips the fail→generate→retry
      // dance entirely. A session-bumped level (a decode failure THIS session) wins.
      const readyLevel = file.compat_ready ? 1 : 0;
      const level = Math.max(compatLevelRef.current.get(compatKeyFor(b.id, file.index)) ?? 0, readyLevel);
      audio.src = level > 0 ? `${streamUrl(b.id, file.index)}?compat=${level}` : streamUrl(b.id, file.index);
      audio.playbackRate = rateRef.current;   // some browsers reset rate on src change
      audio.load();
      const g = toGlobal(map, arrayIndex, offset);
      globalPosRef.current = g;
      setGlobalPos(g);                          // reflect immediately (before metadata)
      publishNow(g);
      // Every load — book swap, file-boundary seek, auto-advance, or a compat-recovery
      // reload — is a fresh "current load attempt". Bumping here (not just in
      // handleRequest) is what lets attemptCompatRecovery's poll loop detect it was
      // superseded by ANY of those, not just a full book swap.
      reqSeqRef.current += 1;
    }

    // ---- Seek in GLOBAL seconds (same file → currentTime, else swap src) ----
    function seekTo(globalSec: number): void {
      const map = mapRef.current;
      const audio = audioRef.current;
      if (!audio || !bookRef.current) return;
      const g = clamp(globalSec, 0, map.total);
      const { arrayIndex, offset } = locate(map, g);
      if (arrayIndex === arrayIndexRef.current && audio.src) {
        try { audio.currentTime = offset; } catch { /* metadata not ready yet */ }
        globalPosRef.current = g;
        setGlobalPos(g);
        publishNow(g);
      } else {
        loadFile(arrayIndex, offset, !audio.paused);   // preserve play/pause across the boundary
      }
      lastWrittenRef.current = null;                    // force the new position to persist next tick
      scheduleWrite();
    }

    function skip(deltaSec: number): void {
      seekTo(globalPosRef.current + deltaSec);
    }

    // ---- Chapter (or file-boundary) prev/next ------------------------------
    function nextChapter(): void {
      const pts = pointsRef.current;
      if (pts.length === 0) return;
      const cur = currentNav(pts, globalPosRef.current);
      if (cur + 1 < pts.length) seekTo(pts[cur + 1].start);
    }
    function prevChapter(): void {
      const pts = pointsRef.current;
      if (pts.length === 0) return;
      const cur = currentNav(pts, globalPosRef.current);
      const into = globalPosRef.current - pts[cur].start;
      if (into > PREV_RESTART_SEC || cur === 0) seekTo(pts[cur].start);
      else seekTo(pts[cur - 1].start);
    }

    // ---- Transport ----------------------------------------------------------
    function toggle(): void {
      const audio = audioRef.current;
      if (!audio || !bookRef.current) return;
      if (audio.paused) { wantPlayRef.current = true; void audio.play().catch(playFailed); }
      else audio.pause();
    }

    function cycleRate(): void {
      const i = (RATE_PRESETS as readonly number[]).indexOf(rateRef.current);
      const next = RATE_PRESETS[(i + 1) % RATE_PRESETS.length];
      rateRef.current = next;
      if (audioRef.current) audioRef.current.playbackRate = next;
      setRate(next);
      try { localStorage.setItem(RATE_KEY, String(next)); } catch { /* private mode */ }
    }

    // ---- Sleep timer --------------------------------------------------------
    function clearSleepInterval(): void {
      if (sleepTimerRef.current != null) { clearInterval(sleepTimerRef.current); sleepTimerRef.current = null; }
    }
    function fireSleep(): void {
      audioRef.current?.pause();            // onPause flushes progress
      clearSleepInterval();
      sleepRef.current = { mode: 'off', until: null, chapterEnd: null };
      setSleepMode('off');
      setSleepRemainingMs(null);
    }
    function setSleep(mode: SleepMode): void {
      clearSleepInterval();
      if (mode === 'off') {
        sleepRef.current = { mode: 'off', until: null, chapterEnd: null };
        setSleepMode('off');
        setSleepRemainingMs(null);
        return;
      }
      if (mode === 'chapter') {
        const pts = pointsRef.current;
        const idx = currentNav(pts, globalPosRef.current);
        sleepRef.current = { mode, until: null, chapterEnd: pts[idx]?.end ?? mapRef.current.total };
        setSleepMode('chapter');
        setSleepRemainingMs(null);   // rendered as "end of chapter", not a countdown
        return;
      }
      const until = Date.now() + Number(mode) * 60_000;
      sleepRef.current = { mode, until, chapterEnd: null };
      setSleepMode(mode);
      setSleepRemainingMs(until - Date.now());
      sleepTimerRef.current = window.setInterval(() => {
        const rem = (sleepRef.current.until ?? 0) - Date.now();
        if (rem <= 0) fireSleep();
        else setSleepRemainingMs(rem);
      }, 1000);
    }

    // ---- Bookmarks ----------------------------------------------------------
    function loadBookmarks(bookId: number): void {
      listBookmarks().then(
        (all) => setBookmarks(all.filter((bm) => bm.book_ref === bookId).sort((a, b) => a.position - b.position)),
        () => setBookmarks([]),
      );
    }
    function addBookmarkHere(): void {
      const b = bookRef.current;
      if (!b) return;
      const pos = globalPosRef.current;
      const pts = pointsRef.current;
      const title = pts.length ? pts[currentNav(pts, pos)]?.title ?? null : null;
      createBookmark({ book_ref: b.id, position: pos, title }).then(
        (row) => setBookmarks((bs) => [...bs, row].sort((a, b2) => a.position - b2.position)),
        () => {},
      );
    }
    function jumpBookmark(pos: number): void {
      seekTo(pos);
      wantPlayRef.current = true;
      void audioRef.current?.play().catch(playFailed);
    }
    function removeBookmark(id: number): void {
      deleteBookmark(id).then(
        () => setBookmarks((bs) => bs.filter((bm) => bm.id !== id)),
        () => {},
      );
    }

    // ---- MediaSession (nice-to-have; fully guarded) -------------------------
    function setMediaSession(b: BookDetail): void {
      if (!('mediaSession' in navigator)) return;
      const ms = (navigator as any).mediaSession;
      try {
        const MM = (window as any).MediaMetadata;
        if (MM) {
          ms.metadata = new MM({
            title: b.title,
            artist: b.author ?? '',
            album: b.series ?? '',
            artwork: b.cover_path ? [{ src: coverUrl(b.id), sizes: '512x512', type: 'image/jpeg' }] : [],
          });
        }
        ms.setActionHandler('play', () => toggle());
        ms.setActionHandler('pause', () => toggle());
        ms.setActionHandler('seekbackward', () => skip(-SKIP_SEC));
        ms.setActionHandler('seekforward', () => skip(SKIP_SEC));
        ms.setActionHandler('previoustrack', () => prevChapter());
        ms.setActionHandler('nexttrack', () => nextChapter());
        ms.setActionHandler('seekto', (d: any) => { if (d && typeof d.seekTime === 'number') seekTo(d.seekTime); });
      } catch { /* older/partial implementations */ }
    }
    function setMediaPlayback(state: 'playing' | 'paused'): void {
      if (!('mediaSession' in navigator)) return;
      try { (navigator as any).mediaSession.playbackState = state; } catch { /* ignore */ }
    }

    // ---- Decode-failure auto-recovery (compat pipeline) ---------------------
    // Triggered from onError below when audio.error.code is 3 (decode) or 4
    // (src-not-supported) and this (book,file) hasn't already exhausted both compat
    // rungs. Bumps the level, asks the backend to build that rung (POST
    // <streamUrl>/prepare), polls until it reports {ready:true} (bounded, ~120s), then
    // reloads the SAME file at the position playback failed at — derived from
    // globalPosRef via locate(), per the file-map's own mapping, not from whatever
    // arrayIndex/offset were in flight when the error fired.
    async function attemptCompatRecovery(): Promise<void> {
      if (recoveringRef.current) return;   // reentrancy guard — see the ref's comment above
      const b = bookRef.current;
      const file = mapRef.current.files[arrayIndexRef.current];
      if (!b || !file) return;
      const key = compatKeyFor(b.id, file.index);
      const level = compatLevelRef.current.get(key) ?? 0;
      if (level >= 2) return;   // both rungs already tried this session — nothing left to attempt

      recoveringRef.current = true;
      const seq = reqSeqRef.current;   // a book/file swap bumps this (loadFile does, on every call)
      const nextLevel = (level + 1) as 1 | 2;
      compatLevelRef.current.set(key, nextLevel);
      const wantPlay = wantPlayRef.current;
      setError('Optimizing this file for your browser…');

      try {
        const prepareUrl = `${streamUrl(b.id, file.index)}/prepare`;
        let ready = false;
        const deadline = Date.now() + COMPAT_POLL_TIMEOUT_MS;
        while (Date.now() < deadline) {
          if (seq !== reqSeqRef.current) return;   // superseded — bail without touching error state
          try {
            const res = await authFetch(prepareUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ level: nextLevel }),
            });
            if (seq !== reqSeqRef.current) return;
            if (res.ok) {
              const body = await res.json().catch(() => null);
              if (body?.ready) { ready = true; break; }
            } else if (res.status >= 400 && res.status < 500) {
              break;   // the request itself is invalid — polling further won't help
            }
          } catch {
            // network hiccup — keep polling until the deadline
          }
          await new Promise((r) => setTimeout(r, COMPAT_POLL_INTERVAL_MS));
        }
        if (seq !== reqSeqRef.current) return;
        if (!ready) {
          // Final failure for this rung: timed out or the backend rejected the
          // request. Leave the REAL error mapping (same message onError would have
          // shown without recovery) rather than the transient "Optimizing…" one.
          setError('Could not decode this file — your browser may lack AAC/M4B support.');
          return;
        }
        const { arrayIndex, offset } = locate(mapRef.current, globalPosRef.current);
        loadFile(arrayIndex, offset, wantPlay);
      } finally {
        recoveringRef.current = false;
      }
    }

    // ---- <audio> event handlers --------------------------------------------
    function onLoaded(): void {
      const audio = audioRef.current;
      if (!audio) return;
      if (pendingSeekRef.current != null) {
        const dur = Number.isFinite(audio.duration) ? audio.duration : pendingSeekRef.current;
        try { audio.currentTime = Math.min(pendingSeekRef.current, dur); } catch { /* ignore */ }
        pendingSeekRef.current = null;
      }
      audio.playbackRate = rateRef.current;
      if (wantPlayRef.current) void audio.play().catch(playFailed);
    }
    function onTime(): void {
      const audio = audioRef.current;
      if (!audio) return;
      const g = toGlobal(mapRef.current, arrayIndexRef.current, audio.currentTime);
      globalPosRef.current = g;
      setGlobalPos(g);
      if (Date.now() - lastPublishRef.current >= 1000) publishNow(g);
      if (!audio.paused) scheduleWrite();
      const sl = sleepRef.current;
      if (sl.mode === 'chapter' && sl.chapterEnd != null && g >= sl.chapterEnd - 0.25) fireSleep();
    }
    function onPlay(): void { setPlaying(true); setBuffering(false); setError(null); setMediaPlayback('playing'); }
    function onPause(): void { setPlaying(false); setMediaPlayback('paused'); flushNow(); }
    function onWaiting(): void { setBuffering(true); }
    function onPlaying(): void { setBuffering(false); setPlaying(true); }
    function onError(): void {
      const audio = audioRef.current;
      const e = audio?.error;
      if (!e) return;
      // Decode / src-not-supported (codes 3/4) on a file that hasn't already
      // exhausted both compat rungs this session → try the compat pipeline instead of
      // surfacing the raw error. recoveringRef guards against a stray error arriving
      // while a recovery attempt is already in flight (spawning a second, parallel
      // poll loop) — attemptCompatRecovery re-checks the level itself too.
      if ((e.code === 3 || e.code === 4) && !recoveringRef.current) {
        const b = bookRef.current;
        const file = mapRef.current.files[arrayIndexRef.current];
        const level = b && file ? (compatLevelRef.current.get(compatKeyFor(b.id, file.index)) ?? 0) : 2;
        if (b && file && level < 2) {
          console.error('[papyros] media error, attempting compat recovery', { code: e.code, level, src: audio.currentSrc });
          setBuffering(false);
          setPlaying(false);
          void attemptCompatRecovery();
          return;
        }
      }
      // MediaError codes: 1 aborted · 2 network · 3 decode · 4 src-not-supported.
      const msg =
        e.code === 3 ? 'Could not decode this file — your browser may lack AAC/M4B support.' :
        e.code === 4 ? 'This audio format is not supported by your browser.' :
        e.code === 2 ? 'Network error while streaming — check the connection and press play.' :
        'Playback was aborted.';
      console.error('[papyros] media error', { code: e.code, message: e.message, src: audio?.currentSrc });
      setBuffering(false);
      setPlaying(false);
      setError(msg);
    }
    function onEnded(): void {
      const next = arrayIndexRef.current + 1;
      if (next < mapRef.current.files.length) {
        loadFile(next, 0, true);          // auto-advance, offset 0
      } else {
        globalPosRef.current = mapRef.current.total;
        setGlobalPos(mapRef.current.total);
        publishNow(mapRef.current.total);
        wantPlayRef.current = false;
        setPlaying(false);
        setMediaPlayback('paused');
        if (writeTimerRef.current != null) { clearTimeout(writeTimerRef.current); writeTimerRef.current = null; }
        void doWrite(true);                // mark finished at true book end
      }
    }

    // ---- The play request from a view (the controller seam) ----------------
    async function handleRequest(req: PlayRequest): Promise<void> {
      setVisible(true);
      const audio = audioRef.current;
      // Same book already loaded → seek (never reload); a bare request just plays.
      if (bookRef.current && bookRef.current.id === req.bookId && mapRef.current.total > 0) {
        if (req.position != null) seekTo(req.position);
        wantPlayRef.current = true;
        if (audio && audio.paused) void audio.play().catch(playFailed);
        return;
      }
      // Different book → flush the outgoing book, then swap everything.
      const seq = ++reqSeqRef.current;
      flushNow();
      let b: BookDetail;
      try { b = await getBook(req.bookId); } catch { return; }
      if (seq !== reqSeqRef.current) return;   // superseded by a newer request

      const map = buildFileMap(b.files);
      bookRef.current = b;
      mapRef.current = map;
      pointsRef.current = navPoints(map, b.chapters);
      progressRowRef.current = null;
      lastWrittenRef.current = null;

      // Resolve the start position: explicit ?? saved (unfinished) ?? 0.
      let rows: ProgressRow[] = [];
      try { rows = await listProgress(); } catch { /* start from 0 */ }
      if (seq !== reqSeqRef.current) return;
      const existing = rows.find((r) => r.book_ref === b.id) ?? null;
      progressRowRef.current = existing;
      let start: number;
      if (req.position != null) start = req.position;
      else if (existing && !existing.finished) start = existing.position;
      else start = 0;
      start = clamp(start, 0, map.total);

      loadBookmarks(b.id);
      setBook(b);
      setSleep('off');                          // a fresh book cancels any armed timer
      setMediaSession(b);
      const { arrayIndex, offset } = locate(map, start);
      loadFile(arrayIndex, offset, true);
    }

    return {
      handleRequest, flushNow,
      handlers: { onLoaded, onTime, onPlay, onPause, onWaiting, onPlaying, onEnded, onError },
      controls: {
        toggle, seekTo, skip, prevChapter, nextChapter, cycleRate,
        setSleep, addBookmarkHere, jumpBookmark, removeBookmark,
      },
    };
  }

  // ── Wire the persistent <audio> + global listeners (once) ─────────────────
  useEffect(() => {
    const audio = new Audio();
    audio.preload = 'auto';
    audio.playbackRate = rateRef.current;
    audioRef.current = audio;
    const h = eng.handlers;
    audio.addEventListener('loadedmetadata', h.onLoaded);
    audio.addEventListener('timeupdate', h.onTime);
    audio.addEventListener('play', h.onPlay);
    audio.addEventListener('pause', h.onPause);
    audio.addEventListener('waiting', h.onWaiting);
    audio.addEventListener('playing', h.onPlaying);
    audio.addEventListener('ended', h.onEnded);
    audio.addEventListener('error', h.onError);

    const unsub = onPlayRequest(eng.handleRequest);
    const onVis = () => { if (document.visibilityState === 'hidden') eng.flushNow(); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('beforeunload', eng.flushNow);

    return () => {
      unsub();
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('beforeunload', eng.flushNow);
      audio.removeEventListener('loadedmetadata', h.onLoaded);
      audio.removeEventListener('timeupdate', h.onTime);
      audio.removeEventListener('play', h.onPlay);
      audio.removeEventListener('pause', h.onPause);
      audio.removeEventListener('waiting', h.onWaiting);
      audio.removeEventListener('playing', h.onPlaying);
      audio.removeEventListener('ended', h.onEnded);
      audio.removeEventListener('error', h.onError);
      if (writeTimerRef.current != null) clearTimeout(writeTimerRef.current);
      if (sleepTimerRef.current != null) clearInterval(sleepTimerRef.current);
      audio.pause();
      audio.src = '';
    };
  }, [eng]);

  // ── Derived-for-render (must match what handlers set on the refs) ─────────
  const rmap = useMemo(() => (book ? buildFileMap(book.files) : EMPTY_MAP), [book]);
  const points = useMemo(() => (book ? navPoints(rmap, book.chapters) : []), [book, rmap]);
  const currentIndex = points.length ? currentNav(points, globalPos) : -1;
  const chapterLabel = currentIndex >= 0 ? points[currentIndex]?.title ?? null : null;

  return {
    visible, book, playing, buffering, error, globalPos, total: rmap.total, rate,
    points, currentIndex, chapterLabel, bookmarks, sleepMode, sleepRemainingMs,
    ...eng.controls,
  };
}
