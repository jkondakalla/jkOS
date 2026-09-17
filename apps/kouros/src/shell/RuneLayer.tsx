import {
  useCallback, useEffect, useLayoutEffect, useRef, useState,
  type PointerEvent as ReactPointerEvent, type ReactNode,
} from 'react';
import { usePlayer } from '../player/PlayerProvider';
import { useRuneGesture } from '../gestures/useRune';
import { bindRune, type RuneAction } from './runeBindings';
import type { Rune } from '../gestures/rune';
import './rune-layer.css';

/**
 * The transport, as strokes.
 *
 * Wraps a surface; a stroke drawn anywhere on it is read by `gestures/rune.ts`
 * and bound to a player verb by `runeBindings.ts`. This component holds neither
 * the grammar nor the vocabulary — it is the place they meet a running player,
 * and it exists mostly to render what the other two decided.
 *
 * ⚠️ **MOUNT IT ONLY ON A SURFACE THAT DOES NOT SCROLL.** A live rune surface
 * claims the pointer once a stroke is real, which is the same gesture a list
 * uses to scroll; the two readings of one downward drag cannot both win. Now
 * Playing is the natural home — it is a single screen with nothing to scroll,
 * it is where a listener's thumb already is, and it is the only place where
 * every one of these verbs is about the thing on screen. Putting this around a
 * library list would trade scrolling for gestures, which is not a trade anyone
 * asked for.
 *
 * ⚠️ …and "does not scroll" is MEASURED, not assumed. Now Playing is designed to
 * fit one screen, but a short viewport, a long title, a large accessibility font
 * or a browser with fat chrome can all push it past the fold — and on a surface
 * with `touch-action: none` that means a user who physically cannot reach the
 * transport controls, with nothing thrown and nothing to tell them why. So the
 * layer measures its own scroller and, when the content genuinely overflows,
 * STANDS DOWN: no touch-action, no pointer claim, ordinary scrolling, and the
 * buttons that were always there keep working. Losing the gestures on a cramped
 * screen is a worse experience; losing the screen is a broken one.
 *
 * ⚠️ **A STROKE THAT STARTS ON A CONTROL IS NOT A RUNE.** The surface under this
 * layer has its own drag control — the scrubber — and its own buttons and links.
 * Without the guard below, a pointerdown on the scrubber arms BOTH engines on
 * the same pointer: the layer captures it, the scrubber keeps its handler, and
 * the two fight over one drag. The symptom is a scrubber that jumps or sticks,
 * which looks like a scrubber bug and is not one. So a press that lands on
 * anything interactive is left alone, and the rune surface is everything else.
 *
 * ⚠️ **NOTHING FIRES UNTIL THE LIFT.** The preview below is what WOULD happen,
 * recomputed from the whole stroke every move, so a throw that curls stops
 * previewing NEXT TRACK and starts previewing VOLUME without anything having
 * been committed in between. `run()` is called exactly once, in `onCommit`.
 */

interface Live {
  rune: Rune;
  action: RuneAction | null;
}

export default function RuneLayer({ children }: { children: ReactNode }) {
  const p = usePlayer();
  const [live, setLive] = useState<Live | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Stand down if the surface has to scroll ────────────────────────────────
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [scrolls, setScrolls] = useState(false);
  useLayoutEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    // The scroller is the overlay container, not this element: `.kr-app.is-overlay`
    // is what carries `overflow-y: auto`.
    const scroller = (el.closest('.kr-app') as HTMLElement | null) ?? el;
    const measure = () => {
      // A couple of pixels of slack: sub-pixel layout rounding routinely reports
      // a 1px overflow on a page that visually fits, and standing down for that
      // would disable the feature almost everywhere.
      setScrolls(scroller.scrollHeight > scroller.clientHeight + 2);
    };
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(scroller);
    ro?.observe(el);
    window.addEventListener('resize', measure);
    return () => { ro?.disconnect(); window.removeEventListener('resize', measure); };
  }, [p.item?.ref]);

  // A stroke in flight when the surface starts scrolling (rotation, a font
  // change) must not be left half-drawn on a layer that no longer listens.
  useEffect(() => { if (scrolls) setLive(null); }, [scrolls]);

  /** The verbs, assembled fresh each render so a stroke always starts from the
   *  CURRENT state. A memo here would be the bug at one end: a volume dial whose
   *  origin was captured three tracks ago snaps the level on first turn. */
  const verbs = {
    toggle: p.toggle,
    trackPrev: p.trackPrev,
    trackNext: p.trackNext,
    setVolume: p.setVolume,
    volume: p.volume,
    seekTo: p.seekTo,
    position: p.globalPos,
    duration: p.total,
    segmentPrev: p.prevSegment,
    segmentNext: p.nextSegment,
    seekSegment: p.seekSegment,
    segmentIndex: p.segmentIndex,
    segmentCount: p.points.length,
    navigate: (href: string) => { window.location.hash = href; },
  };

  /* ⚠️ …and freezing them for the DURATION of a stroke is the bug at the other
     end. `bindRune` closes a dial over its origin — `from = verbs.volume`,
     `from = verbs.position` — and `position` advances in real time while the
     music plays. Rebuilt every frame (this component re-renders on every
     pointermove), a scrub dial would be computed against an origin that crept
     forward under the thumb: the readout would creep with it, and the value
     committed on lift would not be the value the hub last showed. So the stroke
     takes ONE snapshot when it begins and both the preview and the commit read
     that. The verbs themselves are stable callbacks; it is the NUMBERS beside
     them that had to stop moving. */
  const verbsRef = useRef(verbs);
  verbsRef.current = verbs;
  const strokeVerbs = useRef(verbs);

  const show = useCallback((label: string) => {
    setToast(label);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 1500);
  }, []);

  const { begin } = useRuneGesture({
    onPreview: (rune) => setLive({ rune, action: bindRune(rune, p.composition, strokeVerbs.current) }),
    onCommit: (rune) => {
      const action = bindRune(rune, p.composition, strokeVerbs.current);
      setLive(null);
      if (!action) return;
      const turns = rune.kind === 'dial' ? rune.turns : 0;
      action.run(turns);
      show(action.readout ? `${action.label} ${action.readout(turns)}` : action.label);
    },
    onAbort: () => setLive(null),
  });

  /** Anything that owns its own pointer. `closest` rather than a target test,
   *  because the press usually lands on a child of the control (an <svg> inside
   *  a <button>, the thumb inside the scrubber). */
  const OWN_POINTER = 'button, a, input, select, textarea, [role="slider"], .pb-scrubber, [data-owns-pointer]';

  const onPointerDown = useCallback((e: ReactPointerEvent) => {
    if (scrolls) return;
    if ((e.target as HTMLElement).closest?.(OWN_POINTER)) return;
    strokeVerbs.current = verbsRef.current;   // the stroke's frozen origin
    begin(e);
  }, [begin, scrolls]);

  const dial = live && live.rune.kind === 'dial' && live.action?.readout
    ? { label: live.action.label, value: live.action.readout(live.rune.turns) }
    : null;

  return (
    <div
      ref={hostRef}
      className={`kr-runes${scrolls ? ' is-standing-down' : ''}`}
      onPointerDown={onPointerDown}
    >
      {children}

      {/* What would fire. An unbound stroke still shows — the grammar is
          learnable only if a rune that means nothing says so, rather than
          looking identical to one that was not recognised. */}
      {live && live.rune.kind !== 'cancel' && !dial && (
        <div className="kr-rune-chip">{live.action ? live.action.label : 'NOT BOUND'}</div>
      )}

      {dial && (
        <div className="kr-rune-dial">
          <span className="kr-rune-dial-kind">{dial.label}</span>
          <span className="kr-rune-dial-value">{dial.value}</span>
        </div>
      )}

      {toast && <div className="kr-rune-toast">{toast}</div>}
    </div>
  );
}
