// packages/player/src/engine/rate.ts — pure playback-rate helpers (git history, Wave 15,
// item 15.3). Lifted verbatim from usePlayerEngine.ts's RATE_PRESETS + readInitialRate
// + cycleRate rate math, with the one change the generalization forces: localStorage is
// injected (a StorageLike) instead of referenced as a global, so the read/write is a
// self-contained pure unit test/engine.test.mjs can drive with a scripted store (the
// same "extract what's pure, test it in isolation" house pattern as core.test.mjs).
//
// No DOM, no React. The engine passes the real `localStorage` (or undefined) at the
// call site; when a store IS passed, the global is never referenced (`??` short-
// circuits), so this module transpiles + runs in plain Node.

/** The 7 rate presets, in cycle order. (verbatim from usePlayerEngine.ts) */
export const RATE_PRESETS = [0.75, 1, 1.25, 1.5, 1.75, 2, 2.5] as const;

/** The minimal Web Storage surface the rate helpers need. `localStorage` satisfies it. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Read the persisted rate, defaulting to 1 for a missing/invalid/non-preset value or
 *  a throwing store (private mode). Only a value that is exactly one of RATE_PRESETS is
 *  honored — same guard usePlayerEngine.ts's readInitialRate used. */
export function readPersistedRate(key: string, store?: StorageLike): number {
  try {
    const v = Number((store ?? localStorage).getItem(key));
    return (RATE_PRESETS as readonly number[]).includes(v) ? v : 1;
  } catch {
    return 1;
  }
}

/** Persist the rate; a throwing store (private mode) is swallowed, exactly as the
 *  original cycleRate's try/catch around localStorage.setItem. */
export function persistRate(key: string, rate: number, store?: StorageLike): void {
  try {
    (store ?? localStorage).setItem(key, String(rate));
  } catch {
    /* private mode — non-fatal */
  }
}

/** The next preset after `current`, wrapping. An unknown current rate (indexOf -1)
 *  wraps to RATE_PRESETS[0], matching the original `(i + 1) % length` with i === -1. */
export function nextRate(current: number): number {
  const i = (RATE_PRESETS as readonly number[]).indexOf(current);
  return RATE_PRESETS[(i + 1) % RATE_PRESETS.length];
}
