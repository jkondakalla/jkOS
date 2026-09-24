import { useCallback, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { usePointerDrag, HOLD_MS, HOLD_CANCEL_PX } from '@jkos/ui';
import { fanAngles, sectorAt } from '../gestures/radial';
import { DESTINATIONS, activeDestination } from './destinations';
import RadialNav from './RadialNav';
import PlayingOn from '../player/PlayingOn';
import { usePlayerSession } from '../player/PlayerProvider';
import type { View } from '../hooks/useHashRoute';
import './beacon.css';

/**
 * The beacon — the only permanent chrome on a phone, and the whole navigation.
 *
 * Press and hold it and the destinations are dragged in around your thumb;
 * slide to one and release to travel; release without leaving the dead zone and
 * nothing happens. It replaces the tab bar rather than sitting beside it: four
 * fixed targets along the bottom edge cost a permanent strip of screen to say
 * the same three words this says on demand.
 *
 * ⚠️ **THE GESTURE IS `usePointerDrag`'s, NOT THIS FILE'S.** @jkos/ui owns the
 * one recognizer for the suite (`pnpm check:drag`) and it already handles the
 * three things that make a summoned menu work on a real phone: pointer capture,
 * so the slide keeps tracking after the thumb leaves the 46px beacon; the
 * trailing click, which would otherwise fire on whatever the release landed
 * over; and hold-cancelled-by-movement, so a press that turns out to be a scroll
 * is abandoned instead of opening a menu over the list. The activation
 * thresholds are imported BY NAME — re-typing 500 and 5 here is exactly the
 * drift `check:drag` exists to stop.
 *
 * Geometry is `gestures/radial.ts`, hit-tested from the same `fanAngles` the
 * overlay draws from, so the menu and its hit boxes cannot disagree.
 */

export interface BeaconProps {
  /** The route showing now — the sector you are already on lights differently,
   *  and the resting beacon wears that destination's glyph, so repeat trips are
   *  muscle memory rather than aim. */
  view: View;
}

interface Press {
  x: number;
  y: number;
}

export default function Beacon({ view }: BeaconProps) {
  const { begin } = usePointerDrag();
  const { mode } = usePlayerSession();
  const [press, setPress] = useState<Press | null>(null);
  const [selected, setSelected] = useState(-1);
  // Read in `onEnd`, where a state value would be the one captured when the
  // gesture began — the classic stale-closure bug, and here it would navigate to
  // whichever sector was live a moment ago rather than the one released on.
  const selectedRef = useRef(-1);

  const current = activeDestination(view);
  const angles = fanAngles(DESTINATIONS.length);

  const pick = useCallback((n: number) => {
    selectedRef.current = n;
    setSelected(n);
  }, []);

  const onPointerDown = useCallback((e: ReactPointerEvent) => {
    begin(e, {
      activation: { kind: 'hold', delay: HOLD_MS, cancelDistance: HOLD_CANCEL_PX },
      onActivate: (ctx) => {
        // The menu blooms at the CONTACT POINT, not at the beacon's drawn centre:
        // a thumb resting slightly off the dot should not skew every sector.
        setPress({ x: ctx.startX, y: ctx.startY });
        pick(-1);
      },
      onMove: (ctx) => pick(sectorAt(ctx.dx, ctx.dy, angles)),
      onEnd: () => {
        const n = selectedRef.current;
        setPress(null);
        pick(-1);
        if (n >= 0) window.location.hash = DESTINATIONS[n].href;
      },
      onCancel: () => {
        setPress(null);
        pick(-1);
      },
    });
  }, [begin, angles, pick]);

  const open = press !== null;

  return (
    <>
      {open && <RadialNav x={press.x} y={press.y} selected={selected} current={current} />}

      <div className={`kr-beacon-dock${open ? ' is-open' : ''}`}>
        {/* While the music is coming out of ANOTHER device, the hint's slot says
            where — on a phone the beacon is the only chrome that is always there,
            so this is the one place that can (the mini bar is desktop-only). */}
        {!open && mode === 'remote'
          ? <PlayingOn className="kr-beacon-on" />
          : <span className="kr-beacon-hint">{open ? '' : 'HOLD TO NAVIGATE'}</span>}
        <button
          type="button"
          className="kr-beacon"
          aria-label="Navigate"
          onPointerDown={onPointerDown}
          /* ⚠️ Keyboard and assistive-tech path. The whole gesture is pointer-only,
             so without this the app's navigation is unreachable without a touch
             screen — and a radial menu has no keyboard equivalent worth
             inventing. A plain activation falls back to the primary destination
             and the rest are ordinary links from there. */
          onClick={() => { if (!open) window.location.hash = DESTINATIONS[0].href; }}
        >
          <span className="kr-beacon-pulse" aria-hidden="true" />
          <span className="kr-beacon-glyph">{DESTINATIONS[current].glyph}</span>
        </button>
      </div>
    </>
  );
}
