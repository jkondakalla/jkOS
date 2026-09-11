// radial.ts — the PURE geometry under the beacon's summoned menu. No DOM, no
// React, no runtime imports, for the same reason rune.ts has none: the one thing
// worth getting right here is arithmetic, and arithmetic can be replayed from a
// fixture while a pointer handler cannot.
//
// ⚠️ **ANGULAR SELECTION FAILS AT THE WRAP, AND ONLY AT THE WRAP.** Every
// hand-rolled version of this works for the sectors in the middle of the fan and
// then picks the wrong one near 180°, because a naive `Math.abs(a - b)` treats
// 179° and -179° as 358° apart instead of 2°. The fan below is centred straight
// up, so today the wrap sits harmlessly behind the user's thumb — which means a
// regression here would be invisible until someone widens the fan or moves the
// beacon, and would then look like "the menu sometimes picks the wrong thing".

/** Travel from the beacon inside which the gesture selects NOTHING.
 *
 *  This is the escape hatch, and it is the reason the menu is safe to summon by
 *  accident: press, see the destinations, release without moving, and you are
 *  still where you were. A radial with no dead zone commits to whatever sector
 *  the thumb happened to rest nearest, so opening it is never free. */
export const DEAD_ZONE_PX = 34;

/** Where the fan is centred, in standard math degrees — 90° is straight up from
 *  the beacon. */
export const FAN_CENTRE_DEG = 90;

/** How wide the fan opens. Narrow enough that every destination stays inside a
 *  thumb's arc from where the beacon sits, rather than a full circle whose lower
 *  half is off the bottom of the screen. */
export const FAN_SPREAD_DEG = 124;

/** Lay `count` items out across the fan, in order. A single item sits at the
 *  centre; otherwise they are evenly spaced across the whole spread.
 *
 *  Returned HIGHEST angle first, so index 0 is the LEFTMOST destination on
 *  screen — the reading order the labels are written in. */
export function fanAngles(
  count: number,
  spread: number = FAN_SPREAD_DEG,
  centre: number = FAN_CENTRE_DEG,
): number[] {
  if (count <= 0) return [];
  if (count === 1) return [centre];
  const step = spread / (count - 1);
  return Array.from({ length: count }, (_, i) => centre + spread / 2 - i * step);
}

/** Smallest signed difference between two angles, in degrees, in (-180, 180].
 *  ⚠️ This is the wrap fix, isolated so it has one implementation and one test. */
export function angleDelta(a: number, b: number): number {
  return ((((a - b) % 360) + 540) % 360) - 180;
}

/**
 * Which item a pointer offset from the beacon selects, or **-1 for cancel**.
 *
 * `dx`/`dy` are in SCREEN coordinates (y down); the conversion to math angles
 * happens here so no caller has to remember to negate `dy` — forgetting that is
 * how a menu ends up mirrored top-to-bottom, which reads as "the sectors are in a
 * random order".
 *
 * Selection is by NEAREST ANGLE, not by dividing the fan into equal wedges. The
 * difference shows up outside the fan: a thumb that slides past the leftmost
 * item still selects the leftmost item rather than falling into a gap, so the
 * menu has no dead angles except the deliberate one at its centre.
 */
export function sectorAt(
  dx: number,
  dy: number,
  angles: readonly number[],
  deadZone: number = DEAD_ZONE_PX,
): number {
  if (angles.length === 0) return -1;
  if (Math.hypot(dx, dy) < deadZone) return -1;
  const a = (Math.atan2(-dy, dx) * 180) / Math.PI;
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < angles.length; i++) {
    const d = Math.abs(angleDelta(a, angles[i]));
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

/** An item's offset from the beacon, in SCREEN pixels, at radius `r`. The `-sin`
 *  is the same math→screen flip `sectorAt` undoes, kept next to it so the two can
 *  never disagree about which way is up. */
export function fanOffset(angleDeg: number, r: number): { x: number; y: number } {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: Math.cos(rad) * r, y: -Math.sin(rad) * r };
}
