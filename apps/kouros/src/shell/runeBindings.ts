// runeBindings.ts — what a drawn rune DOES.
//
// ⭐ **THE TABLE IS DERIVED, NOT KEPT.** Every binding below is read out of the
// `PlayerComposition` that `@jkos/player/factory` produces for whatever is
// currently playing — so the same left-curl is the CHAPTER dial on an audiobook
// and the VOLUME dial on a track, because `createPlayer`'s `nav` capability says
// which of those the item has. Nothing here restates the music/audiobook
// distinction; it reads it.
//
// That is the whole reason this file is worth having. A hand-kept second table
// would agree with the player on the day it was written and drift the first time
// a capability moved — and the failure would be a gesture that fires the wrong
// verb, silently, only for one kind of item. Deriving it means the two cannot
// disagree: if a capability is off, the rune is simply unbound.
//
// ⚠️ **AN UNBOUND RUNE IS A FIRST-CLASS OUTCOME.** Several runes in the design
// have no verb behind them yet (sleep, clip, airplay, lyrics), and music has no
// bookmark to drop. They stay in the grammar and return `null` here, the way
// `videoPlayer()` carries `unbuilt: true` — the vocabulary stays inspectable
// without anything pretending the command exists.

import type { PlayerComposition, ControlId } from '@jkos/player/factory';
import { runeKey, type Rune } from '../gestures/rune';

/** The verbs an app hands the binder. Each is optional: a source that cannot do
 *  one simply leaves it out, and the rune that would have fired it is unbound. */
export interface RuneVerbs {
  toggle?: () => void;
  /** Walk the QUEUE — music's prev/next. */
  trackPrev?: () => void;
  trackNext?: () => void;
  /** Walk the current item's CHAPTERS — an audiobook's prev/next. */
  segmentPrev?: () => void;
  segmentNext?: () => void;
  /** Drop a mark at the current position. */
  addBookmark?: () => void;
  /** 0..1. */
  setVolume?: (level: number) => void;
  volume?: number;
  /** Seek, in seconds from the start of the item. */
  seekTo?: (seconds: number) => void;
  position?: number;
  duration?: number;
  /** Step the playback rate. ⚠️ A STEP, not a set: `PlayerApi` exposes
   *  `cycleRate()` and no `setRate(n)`, so the speed dial advances through the
   *  presets rather than sweeping. Adding `setRate` is a change to a package
   *  PapyrOS and KourOS share, and that is Jag's call, not this feature's. */
  cycleRate?: () => void;
  /** Jump to a chapter by index, and where we are among them. */
  seekSegment?: (index: number) => void;
  segmentIndex?: number;
  segmentCount?: number;
  /** Go somewhere. The corners are navigation and belong to the shell, not the
   *  player, so they are passed in rather than derived from the composition. */
  navigate?: (href: string) => void;
}

/** What a bound rune is, once resolved. */
export interface RuneAction {
  /** Shown live while the stroke is open, and on the commit toast. */
  label: string;
  /** The value a dial currently reads, for the live hub. Absent for a flick or
   *  a corner — they have no value, only an effect. */
  readout?: (turns: number) => string;
  /** Do it. `turns` is the signed turn since the dial engaged; a flick or corner
   *  ignores it. */
  run: (turns: number) => void;
}

/** How much one full turn of each dial is worth. Named, because these are the
 *  numbers that decide whether a dial feels geared right, and a tuning pass
 *  should change one line. */
export const VOLUME_PER_TURN = 1;        // the whole 0..1 range in one revolution
export const SCRUB_SEC_PER_TURN = 240;   // four minutes
export const SEGMENTS_PER_TURN = 6;      // six chapters
export const RATE_STEPS_PER_TURN = 4;    // four presses of the rate cycler

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** Seconds as m:ss. */
function clock(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** The corner destinations. These are the SECONDARY navigation — the radial's
 *  three sectors carry the primary destinations, and these reach the rest of the
 *  app, which is what makes retiring the tab bar safe. */
export const CORNER_DESTINATIONS: Record<string, { label: string; href: string }> = {
  'corner:ul': { label: 'LIBRARY', href: '#/browse' },
  'corner:ur': { label: 'SEARCH', href: '#/search' },
};

/**
 * Resolve a rune against the current player composition.
 *
 * Returns `null` when the rune is in the grammar but nothing is behind it — an
 * unbound corner, a bookmark on a track, a chapter dial on music. Callers show
 * the stroke and fire nothing.
 */
export function bindRune(
  rune: Rune,
  composition: PlayerComposition | null,
  verbs: RuneVerbs,
): RuneAction | null {
  const key = runeKey(rune);

  // ── Corners: navigation, independent of what is playing ────────────────────
  const dest = CORNER_DESTINATIONS[key];
  if (dest) {
    if (!verbs.navigate) return null;
    const go = verbs.navigate;
    return { label: dest.label, run: () => go(dest.href) };
  }
  if (rune.kind === 'corner' || rune.kind === 'cancel') return null;

  const has = (c: ControlId) =>
    composition != null &&
    (composition.transportControls.includes(c) || composition.actionControls.includes(c));

  // ── Flicks ─────────────────────────────────────────────────────────────────
  if (rune.kind === 'flick') {
    switch (rune.dir) {
      case 'u':
        return has('playPause') && verbs.toggle
          ? { label: 'PLAY / PAUSE', run: verbs.toggle }
          : null;
      case 'r':
        if (has('trackNext') && verbs.trackNext) return { label: 'NEXT TRACK', run: verbs.trackNext };
        if (has('segmentNext') && verbs.segmentNext) return { label: 'NEXT CHAPTER', run: verbs.segmentNext };
        return null;
      case 'l':
        if (has('trackPrev') && verbs.trackPrev) return { label: 'PREVIOUS', run: verbs.trackPrev };
        if (has('segmentPrev') && verbs.segmentPrev) return { label: 'PREVIOUS CHAPTER', run: verbs.segmentPrev };
        return null;
      case 'd':
        // Music has no bookmark to drop — `bookmarks` is off in musicPlayer().
        return has('bookmarks') && verbs.addBookmark
          ? { label: 'DROP MARK', run: verbs.addBookmark }
          : null;
    }
  }

  // ── Dials ──────────────────────────────────────────────────────────────────
  if (rune.kind === 'dial') {
    switch (rune.dir) {
      case 'r': {
        if (!has('volume') || !verbs.setVolume || verbs.volume == null) return null;
        const from = verbs.volume;
        const set = verbs.setVolume;
        const at = (turns: number) => clamp(from + turns * VOLUME_PER_TURN, 0, 1);
        return {
          label: 'VOLUME',
          readout: (t) => `${Math.round(at(t) * 100)}%`,
          run: (t) => set(at(t)),
        };
      }
      case 'd': {
        // Scrubbing is universal: seeking needs no capability, only a duration.
        if (!verbs.seekTo || verbs.position == null || verbs.duration == null) return null;
        const from = verbs.position;
        const total = verbs.duration;
        const seek = verbs.seekTo;
        const at = (turns: number) => clamp(from + turns * SCRUB_SEC_PER_TURN, 0, total);
        return {
          label: 'SCRUB',
          readout: (t) => clock(at(t)),
          run: (t) => seek(at(t)),
        };
      }
      case 'u': {
        if (!has('rate') || !verbs.cycleRate) return null;
        const cycle = verbs.cycleRate;
        // ⚠️ Stepped, not swept — see RuneVerbs.cycleRate. The dial advances the
        // cycler once per RATE_STEPS_PER_TURN-th of a turn, so the gesture is the
        // same motion the design asks for even though the underlying verb is a
        // press.
        const steps = (turns: number) => Math.round(turns * RATE_STEPS_PER_TURN);
        return {
          label: 'SPEED',
          readout: (t) => (steps(t) === 0 ? 'HOLD' : `${steps(t) > 0 ? '+' : ''}${steps(t)}`),
          run: (t) => { for (let k = 0; k < Math.abs(steps(t)); k++) cycle(); },
        };
      }
      case 'l': {
        if (!has('segmentNext') || !verbs.seekSegment ||
            verbs.segmentIndex == null || verbs.segmentCount == null) return null;
        const from = verbs.segmentIndex;
        const count = verbs.segmentCount;
        const go = verbs.seekSegment;
        const at = (turns: number) =>
          clamp(Math.round(from + turns * SEGMENTS_PER_TURN), 0, Math.max(0, count - 1));
        return {
          label: 'CHAPTER',
          readout: (t) => `CH ${String(at(t) + 1).padStart(2, '0')}`,
          run: (t) => go(at(t)),
        };
      }
    }
  }

  return null;
}
