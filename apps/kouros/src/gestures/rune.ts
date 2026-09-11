// rune.ts — the PURE stroke recognizer under the rune layer. No DOM, no React,
// no runtime imports — so test/runes.mjs can transpile this one file in isolation
// and drive the real functions, the same house pattern `pulsarmap.ts`, `scrub.ts`
// and `hudPrefs.ts` follow.
//
// THE GRAMMAR, in three shapes:
//
//   flick    a straight throw in one of four directions          → one command
//   dial     that same throw continued into a circle             → a live value
//   corner   that same throw broken by a hard 90°                → a destination
//
// ⚠️ **NOTHING COMMITS UNTIL THE POINTER LIFTS, AND THAT IS THE WHOLE SAFETY
// PROPERTY.** A straight flick right is NEXT TRACK — but if the same stroke curls,
// it stops being NEXT TRACK and becomes the volume dial. One gesture is allowed to
// change its mind mid-draw, so a wrong start costs nothing. That is only true if
// classification is a function of the WHOLE stroke rather than a latch thrown at
// the first threshold crossing, which is why this is a fold over the points and
// not a state machine fed by an event handler.
//
// ⚠️ **`classify` IS ALSO THE LIVE PREVIEW.** The caller runs it on the points so
// far to show what would fire, then again on lift to commit. Those must be the
// same function or the preview can lie — the failure mode being a chip that reads
// NEXT TRACK while the lift fires VOLUME. Nothing would throw.

/** A sampled pointer position, in any consistent coordinate space. The recognizer
 *  is scale-free apart from the px thresholds below, so client, page or
 *  element-relative coordinates all work — the caller just has to pick one. */
export interface Pt {
  x: number;
  y: number;
}

/** The four axes a stroke can set out along. Screen convention: `d` is DOWN. */
export type Dir = 'u' | 'd' | 'l' | 'r';

export type Rune =
  /** The pointer never travelled far enough to mean anything — a tap, or a
   *  stroke abandoned inside the dead zone. Binds to nothing, deliberately:
   *  it is how a draw is called off. */
  | { kind: 'cancel' }
  /** A straight throw. */
  | { kind: 'flick'; dir: Dir }
  /** A throw continued into a circle. `turns` is signed and measured FROM the
   *  moment the curl was recognised, so the arc spent proving it was a curl does
   *  not also count as a value change — otherwise every dial would jump by a
   *  quarter turn the instant it engaged. Positive is clockwise on screen. */
  | { kind: 'dial'; dir: Dir; turns: number }
  /** A throw broken by a hard right angle. `dir` is the first leg, `dir2` the
   *  second; they are always perpendicular. */
  | { kind: 'corner'; dir: Dir; dir2: Dir };

/* ── Thresholds ───────────────────────────────────────────────────────────────
   Every one of these is a felt quantity rather than a derived one, so they are
   named and exported: a gate can read them, and a tuning pass changes one line
   instead of hunting literals through a component. */

/** Travel from the pointer-down point before a stroke has a DIRECTION at all.
 *  Below this the stroke is still a tap, and its direction is just jitter. */
export const DIRECTION_PX = 32;

/** Minimum travel between two samples before the pair contributes an angle.
 *  ⚠️ Load-bearing: consecutive points a pixel apart have an angle dominated by
 *  quantisation noise, and summing that noise over a long stroke walks the
 *  accumulator into a curl that the hand never drew. */
export const SAMPLE_PX = 9;

/** Total turning, in degrees, before a stroke is read as a circle. */
export const CURL_DEG = 95;

/** A single sample pair that turns more than this is discarded rather than
 *  accumulated. ⚠️ This is NOT the same idea as CURL_DEG even though the two
 *  are equal today: this one rejects a cusp or a dropped frame (the pointer
 *  appearing to reverse in one step), CURL_DEG decides what a circle is. Tune
 *  them independently. */
export const MAX_STEP_DEG = 95;

/** Perpendicular travel away from the first leg before the stroke is read as a
 *  corner. */
export const CORNER_PX = 46;

/** Turning a corner must ALSO have accumulated, on top of `CORNER_PX` of
 *  sideways travel.
 *
 *  ⚠️ Without this, a throw aimed 20° off-axis is a corner: it drifts past
 *  `CORNER_PX` perpendicular to its own dominant axis without the hand ever
 *  having turned, and a sloppy NEXT TRACK silently opens the library instead.
 *  Sideways travel says *where the stroke ended up*; this says *that it turned
 *  to get there*, and a corner needs both. */
export const CORNER_TURN_DEG = 45;

/** Dominant axis of a displacement. Ties go to the vertical, which only matters
 *  for an exact 45° throw — a direction the grammar has no meaning for anyway. */
function axis(dx: number, dy: number): Dir {
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'r' : 'l';
  return dy > 0 ? 'd' : 'u';
}

/** Whether a direction runs along the horizontal. */
function horizontal(dir: Dir): boolean {
  return dir === 'l' || dir === 'r';
}

/**
 * Read a stroke.
 *
 * The walk, once, in order:
 *
 *   1. Find the first sample more than `DIRECTION_PX` from the start. That fixes
 *      `dir` and becomes the PIVOT — every later measurement is relative to it,
 *      not to the pointer-down point, so the distance spent establishing the
 *      direction is not also counted as a corner's perpendicular travel.
 *   2. From the pivot, accumulate signed turning between successive samples and
 *      track how far the stroke has strayed perpendicular to its first leg.
 *   3. Decide, from what the WHOLE stroke did:
 *        • turning ever passed `CURL_DEG`                        → dial
 *        • else it turned past `CORNER_TURN_DEG` *and* strayed
 *          past `CORNER_PX`                                      → corner
 *        • else                                                  → flick
 *
 * ⚠️ **THE DIAL IS TESTED FIRST, AND THE TESTS ARE OVER THE WHOLE STROKE RATHER
 * THAN FIRST-PAST-THE-POST.** This is not a stylistic preference — it is the only
 * ordering that can tell a corner from a circle at all. The first quarter of a
 * tight circle IS a rounded corner: it turns ~90° and it travels sideways, and
 * any rule that commits the moment those two thresholds are crossed reads every
 * dial as a corner. What separates them is whether the turning *stops* there, and
 * that is not knowable until the stroke has gone further. So nothing latches;
 * each call simply reports what the points so far amount to, which is also
 * exactly what makes the live preview and the committed command the same thing.
 *
 * There is still a genuinely ambiguous band — a corner drawn with a lazy,
 * over-rotated elbow can sum past `CURL_DEG` and be read as a dial. It is
 * accepted rather than papered over: lift-to-commit means the cost of the misread
 * is that the user keeps curling, or straightens out, and neither has fired
 * anything yet.
 */
export function classify(points: readonly Pt[]): Rune {
  const n = points.length;
  if (n < 2) return { kind: 'cancel' };

  const start = points[0];

  // ── 1. Direction, and the pivot ────────────────────────────────────────────
  let i = 1;
  let dir: Dir | null = null;
  for (; i < n; i++) {
    const dx = points[i].x - start.x;
    const dy = points[i].y - start.y;
    if (Math.hypot(dx, dy) > DIRECTION_PX) {
      dir = axis(dx, dy);
      break;
    }
  }
  if (dir === null) return { kind: 'cancel' };

  const pivot = points[i];
  const acrossFirstLeg = horizontal(dir);

  // ── 2. Turning, and straying ───────────────────────────────────────────────
  /** Running signed total. Can unwind: a curl forward then back is a dial whose
   *  value went up and came down again. */
  let cum = 0;
  /** The most it ever reached, either way round. The DECISION reads this; the
   *  dial's VALUE reads `cum`. Keeping them apart is what lets a dial that has
   *  been wound back to zero still be a dial. */
  let peakTurn = 0;
  /** `cum` at the moment the curl was first recognised — the dial's zero. */
  let cumAtLatch: number | null = null;
  let peakStray = 0;
  let dir2: Dir | null = null;

  let lastVec: { x: number; y: number } | null = null;
  let lastSample = pivot;

  for (let j = i + 1; j < n; j++) {
    const p = points[j];
    const sx = p.x - lastSample.x;
    const sy = p.y - lastSample.y;
    const len = Math.hypot(sx, sy);

    if (len > SAMPLE_PX) {
      const v = { x: sx / len, y: sy / len };
      if (lastVec) {
        // Signed angle between successive heading vectors. The cross product's
        // sign gives the direction of turn; on screen (y down) positive is
        // clockwise.
        const cross = lastVec.x * v.y - lastVec.y * v.x;
        const dot = Math.max(-1, Math.min(1, lastVec.x * v.x + lastVec.y * v.y));
        const step = ((Math.acos(dot) * 180) / Math.PI) * (cross >= 0 ? 1 : -1);
        if (Math.abs(step) < MAX_STEP_DEG) cum += step;
      }
      lastVec = v;
      lastSample = p;
      peakTurn = Math.max(peakTurn, Math.abs(cum));
      if (cumAtLatch === null && Math.abs(cum) > CURL_DEG) cumAtLatch = cum;
    }

    const dx = p.x - pivot.x;
    const dy = p.y - pivot.y;
    const stray = acrossFirstLeg ? Math.abs(dy) : Math.abs(dx);
    if (stray > peakStray) {
      peakStray = stray;
      // The side it broke towards, recorded as it happens — by the end of a
      // corner's second leg the sign is still the same, but reading it from the
      // last point would be wrong for a stroke that came back.
      dir2 = acrossFirstLeg ? (dy > 0 ? 'd' : 'u') : dx > 0 ? 'r' : 'l';
    }
  }

  // ── 3. Decide ──────────────────────────────────────────────────────────────
  if (peakTurn > CURL_DEG) {
    return { kind: 'dial', dir, turns: (cum - (cumAtLatch ?? 0)) / 360 };
  }
  if (peakTurn > CORNER_TURN_DEG && peakStray > CORNER_PX && dir2) {
    return { kind: 'corner', dir, dir2 };
  }
  return { kind: 'flick', dir };
}

/** A stable key for a rune's IDENTITY, ignoring how far a dial has turned — so a
 *  caller can ask "is this still the same command?" across frames without
 *  re-deriving the comparison. `cancel` is its own key rather than null: a
 *  released-on-nothing is a real outcome the UI shows. */
export function runeKey(rune: Rune): string {
  switch (rune.kind) {
    case 'flick':
      return `flick:${rune.dir}`;
    case 'dial':
      return `dial:${rune.dir}`;
    case 'corner':
      return `corner:${rune.dir}${rune.dir2}`;
    default:
      return 'cancel';
  }
}
