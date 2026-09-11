import { DESTINATIONS } from './destinations';
import { fanAngles, fanOffset } from '../gestures/radial';

/**
 * The summoned menu — presentation only.
 *
 * It takes the press point and which sector is live, and draws. It listens to
 * nothing: the gesture belongs to <Beacon>, which owns the one `usePointerDrag`
 * and hit-tests with the same `fanAngles` this renders from. Splitting it this
 * way is what lets the geometry be a gated pure function (`gestures/radial.ts`)
 * instead of arithmetic buried in an event handler.
 */

/** How far the slabs sit from the thumb. Far enough to read, near enough that
 *  the outermost is still inside a thumb's reach from the beacon. */
const RADIUS_PX = 118;

export interface RadialNavProps {
  /** Press point, in client coordinates — the menu blooms where the thumb is,
   *  not where the beacon is drawn. */
  x: number;
  y: number;
  /** Live sector, or -1 for "released here and nothing happens". */
  selected: number;
  /** The route the user is already on, so the sector they came from reads as
   *  current rather than as another place to go. */
  current: number;
}

export default function RadialNav({ x, y, selected, current }: RadialNavProps) {
  const angles = fanAngles(DESTINATIONS.length);

  return (
    <div className="kr-radial" aria-hidden="true">
      <div className="kr-radial-veil" />
      <div className="kr-radial-ripple" style={{ left: x, top: y }} />

      {DESTINATIONS.map((d, i) => {
        const o = fanOffset(angles[i], RADIUS_PX);
        return (
          <div
            key={d.view}
            className={
              'kr-radial-slab' +
              (selected === i ? ' is-on' : '') +
              (current === i ? ' is-current' : '')
            }
            style={{
              left: x + o.x,
              top: y + o.y,
              // The flight-in vector, so each slab is dragged in from off its own
              // angle rather than all of them from the same place.
              ['--kr-fx' as string]: `${Math.round(o.x * 1.3)}px`,
              ['--kr-fy' as string]: `${Math.round(o.y * 1.3)}px`,
              ['--kr-delay' as string]: `${70 + i * 45}ms`,
            }}
          >
            <span className="kr-radial-glyph">{d.glyph}</span>
            <span className="kr-radial-label">{d.label}</span>
          </div>
        );
      })}

      <div className="kr-radial-hub" style={{ left: x, top: y }}>
        {selected >= 0 ? 'GO' : 'STAY'}
      </div>
    </div>
  );
}
