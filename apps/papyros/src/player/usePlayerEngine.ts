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
import {
  coverUrl, createBookmark, createProgress, deleteBookmark, getBook,
  listBookmarks, listProgress, streamUrl, updateProgress,
  type BookDetail, type BookmarkRow, type ProgressRow,
} from '../api';
import { onPlayRequest, type PlayRequest } from './controller';
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
  const sleepRef = useRef<{ mode: SleepMode; until: number | null; chapterEnd: number | null }>(
    { mode: 'off', until: null, chapterEnd: null },
  );
  const sleepTimerRef = useRef<number | null>(null);

  // ── The imperative engine, built exactly once (stable closures over refs) ──
  const engineRef = useRef<ReturnType<typeof buildEngine> | null>(null);
  if (!engineRef.current) engineRef.current = buildEngine();
  const eng = engineRef.current;

  function buildEngine() {
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

    // ---- Loading a file into the persistent <audio> ------------------------
    function loadFile(arrayIndex: number, offset: number, autoplay: boolean): void {
      const audio = audioRef.current;
      const b = bookRef.current;
      const map = mapRef.current;
      if (!audio || !b) return;
      const file = map.files[arrayIndex];
      if (!file) return;
      arrayIndexRef.current = arrayIndex;
      pendingSeekRef.current = Math.max(0, offset);
      wantPlayRef.current = autoplay;
      audio.src = streamUrl(b.id, file.index);
      audio.playbackRate = rateRef.current;   // some browsers reset rate on src change
      audio.load();
      const g = toGlobal(map, arrayIndex, offset);
      globalPosRef.current = g;
      setGlobalPos(g);                          // reflect immediately (before metadata)
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
      if (audio.paused) { wantPlayRef.current = true; void audio.play().catch(() => {}); }
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
      void audioRef.current?.play().catch(() => {});
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
      if (wantPlayRef.current) void audio.play().catch(() => {});
    }
    function onTime(): void {
      const audio = audioRef.current;
      if (!audio) return;
      const g = toGlobal(mapRef.current, arrayIndexRef.current, audio.currentTime);
      globalPosRef.current = g;
      setGlobalPos(g);
      if (!audio.paused) scheduleWrite();
      const sl = sleepRef.current;
      if (sl.mode === 'chapter' && sl.chapterEnd != null && g >= sl.chapterEnd - 0.25) fireSleep();
    }
    function onPlay(): void { setPlaying(true); setBuffering(false); setMediaPlayback('playing'); }
    function onPause(): void { setPlaying(false); setMediaPlayback('paused'); flushNow(); }
    function onWaiting(): void { setBuffering(true); }
    function onPlaying(): void { setBuffering(false); setPlaying(true); }
    function onEnded(): void {
      const next = arrayIndexRef.current + 1;
      if (next < mapRef.current.files.length) {
        loadFile(next, 0, true);          // auto-advance, offset 0
      } else {
        globalPosRef.current = mapRef.current.total;
        setGlobalPos(mapRef.current.total);
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
        if (audio && audio.paused) void audio.play().catch(() => {});
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
      handlers: { onLoaded, onTime, onPlay, onPause, onWaiting, onPlaying, onEnded },
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
    visible, book, playing, buffering, globalPos, total: rmap.total, rate,
    points, currentIndex, chapterLabel, bookmarks, sleepMode, sleepRemainingMs,
    ...eng.controls,
  };
}
