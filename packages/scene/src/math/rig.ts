// rig.ts — the orbit camera every @jkos/scene view is seen through, PURE: plain state
// and the functions that advance it. No clock (the caller hands in `dt`), no DOM.
//
// A rig is a target, a yaw about it, a pitch above the horizon and a distance from it
// — each a critically damped spring (motion.ts `springStep`, SOLVED, so the path is
// the same at any frame rate) chasing a goal. A view moves a goal and the rig glides;
// a view that must not glide (a seek, a reduced-motion preference) cuts.
//
// ⚠️ **A SETTLED SPRING IS SNAPPED ONTO ITS GOAL, not left 1e-4 short of it.** The
// residue is sub-pixel but it moves antialiased edges: the 3-D pulsarmap, come to
// rest after an orbit, differed from the same view drawn directly by ~460 px. A
// resting picture that depends on how it got there cannot be verified — so `settle`
// is the only way a rig's springs advance.
//
// ⚠️ **REDUCED MOTION CUTS; IT DOES NOT SLOW DOWN.** Under `prefers-reduced-motion`
// (or the suite's `data-motion="static"`) every spring lands on its goal in one step
// and a flick does not coast. A slower glide is still motion.
//
// ⚠️ **YAW IS AN ANGLE.** A goal is approached the SHORT way round (`angleDelta`):
// aimed at 2π from 0.1, a naive spring unwinds a whole turn to arrive where it began.
// With no goal, yaw is free — it coasts on its velocity under friction and rests.

import { angleDelta, clamp, invert, lookAt, multiply, orbitEye, perspective, springSettled, springStep } from './motion';
import type { Mat4, Spring, Vec3 } from './motion';

/** Below this |yaw velocity| (rad/s) a coast is over. */
export const COAST_REST = 1e-3;

/** Spin's coast: friction, no snap. `v · e^(−friction·dt)`. */
export const coast = (v: number, friction: number, dt: number): number => v * Math.exp(-friction * dt);

export interface SettleOptions {
  /** Cut straight to the goal — the reduced-motion preference. */
  reduced?: boolean;
  /** How close counts as arrived; the spring is then snapped onto the goal. */
  eps?: number;
}

/** One frame of a spring toward `to`: solved for exactly `dt`, snapped once settled,
 *  cut under reduced motion. */
export function settle(s: Spring, to: number, omega: number, dt: number, opts: SettleOptions = {}): Spring {
  if (opts.reduced) return { x: to, v: 0 };
  const next = springStep(s, to, omega, dt);
  return springSettled(next, to, opts.eps) ? { x: to, v: 0 } : next;
}

export interface Lens {
  /** Vertical field of view, radians. */
  fov: number;
  near: number;
  far: number;
}

export interface View {
  viewProj: Mat4;
  /** null only for a degenerate view — never in practice, but never NaNs either. */
  inverse: Mat4 | null;
  eye: Vec3;
}

/** The view-projection for an eye orbiting `target`. Every rig view is this. */
export function orbitView(target: Vec3, yaw: number, pitch: number, distance: number, aspect: number,
                          lens: Lens): View {
  const eye = orbitEye(target, yaw, pitch, distance);
  const viewProj = multiply(perspective(lens.fov, aspect, lens.near, lens.far), lookAt(eye, target, [0, 1, 0]));
  return { viewProj, inverse: invert(viewProj), eye };
}

/** The distance at which a sphere of `radius` just fits the narrower of the two
 *  fields of view — so a portrait phone never crops it at any yaw. */
export function fitDistance(aspect: number, radius: number, fov: number): number {
  const vHalf = fov / 2;
  const hHalf = Math.atan(Math.tan(vHalf) * aspect);
  return radius / Math.sin(Math.min(vHalf, hHalf));
}

export interface RigPose {
  target: Vec3;
  yaw: number;
  pitch: number;
  distance: number;
}

export interface RigOmega {
  target: number;
  yaw: number;
  pitch: number;
  distance: number;
}

export interface OrbitRig {
  target: [Spring, Spring, Spring];
  targetGoal: Vec3;
  /** `yaw.v` is the angular velocity a free yaw coasts on. */
  yaw: Spring;
  /** null → free: coast on `yaw.v`, then rest wherever it stopped. */
  yawGoal: number | null;
  pitch: Spring;
  pitchGoal: number;
  distance: Spring;
  distanceGoal: number;
  /** Natural frequencies, rad/s — ~4.6/ω seconds to settle within 1%. */
  omega: RigOmega;
  /** Spin friction, 1/s. */
  friction: number;
  /** Arrival tolerance handed to `settle`. */
  eps: number;
  /** A hand owns yaw and pitch (a drag in progress, or a keyboard orbit held until
   *  Escape): the rig leaves both exactly where the hand put them. */
  held: boolean;
}

export interface RigOptions {
  omega?: Partial<RigOmega>;
  friction?: number;
  eps?: number;
  /** Start with a free yaw (a view that spins) rather than one aimed at `pose.yaw`. */
  freeYaw?: boolean;
}

/** A rig at rest ON `pose` — every spring at its goal. */
export function createRig(pose: RigPose, opts: RigOptions = {}): OrbitRig {
  const w = opts.omega ?? {};
  return {
    target: [{ x: pose.target[0], v: 0 }, { x: pose.target[1], v: 0 }, { x: pose.target[2], v: 0 }],
    targetGoal: [pose.target[0], pose.target[1], pose.target[2]],
    yaw: { x: pose.yaw, v: 0 },
    yawGoal: opts.freeYaw ? null : pose.yaw,
    pitch: { x: pose.pitch, v: 0 },
    pitchGoal: pose.pitch,
    distance: { x: pose.distance, v: 0 },
    distanceGoal: pose.distance,
    omega: { target: w.target ?? 6, yaw: w.yaw ?? 6, pitch: w.pitch ?? 6, distance: w.distance ?? 6 },
    friction: opts.friction ?? 3,
    eps: opts.eps ?? 1e-4,
    held: false,
  };
}

export type RigPart = 'target' | 'yaw' | 'pitch' | 'distance';

/** Snap parts of the rig straight onto their goals — a seek, a new track, a first
 *  frame. With no parts named, everything. */
export function cutRig(r: OrbitRig, ...parts: RigPart[]): void {
  const all = parts.length === 0;
  if (all || parts.includes('target')) {
    for (let k = 0; k < 3; k++) r.target[k] = { x: r.targetGoal[k], v: 0 };
  }
  if ((all || parts.includes('yaw')) && r.yawGoal != null) r.yaw = { x: r.yawGoal, v: 0 };
  if (all || parts.includes('pitch')) r.pitch = { x: r.pitchGoal, v: 0 };
  if (all || parts.includes('distance')) r.distance = { x: r.distanceGoal, v: 0 };
}

/**
 * Advance the rig by exactly `dt` seconds. Returns whether anything is still moving
 * — the caller's cue to ask for another frame. A held rig's yaw and pitch count as
 * still: the hand moves them, and a frame is drawn because the hand moved.
 */
export function stepRig(r: OrbitRig, dt: number, reduced: boolean): boolean {
  const o: SettleOptions = { reduced, eps: r.eps };
  for (let k = 0; k < 3; k++) r.target[k] = settle(r.target[k], r.targetGoal[k], r.omega.target, dt, o);
  r.distance = settle(r.distance, r.distanceGoal, r.omega.distance, dt, o);

  let turning = false;
  if (!r.held) {
    r.pitch = settle(r.pitch, r.pitchGoal, r.omega.pitch, dt, o);
    if (r.yawGoal != null) {
      // Spring the OFFSET from the goal toward 0, so the short way round is the way.
      const offset = settle({ x: -angleDelta(r.yaw.x, r.yawGoal), v: r.yaw.v }, 0, r.omega.yaw, dt, o);
      if (offset.x === 0 && offset.v === 0) r.yaw = { x: r.yawGoal, v: 0 };
      else { r.yaw = { x: r.yawGoal + offset.x, v: offset.v }; turning = true; }
    } else if (!reduced && Math.abs(r.yaw.v) > COAST_REST) {
      r.yaw = { x: r.yaw.x + r.yaw.v * dt, v: coast(r.yaw.v, r.friction, dt) };
      turning = true;
    } else if (r.yaw.v !== 0) {
      r.yaw = { x: r.yaw.x, v: 0 };
    }
  }

  return turning
    || r.target[0].x !== r.targetGoal[0] || r.target[1].x !== r.targetGoal[1] || r.target[2].x !== r.targetGoal[2]
    || r.distance.x !== r.distanceGoal
    || (!r.held && r.pitch.x !== r.pitchGoal);
}

/** The rig's view, as it stands. */
export function rigView(r: OrbitRig, aspect: number, lens: Lens): View {
  return orbitView([r.target[0].x, r.target[1].x, r.target[2].x], r.yaw.x, r.pitch.x, r.distance.x, aspect, lens);
}

export interface OrbitDragLimits {
  /** Radians of yaw per CSS px dragged sideways (a drag RIGHT turns the scene right). */
  yawPerPx: number;
  /** Radians of pitch per CSS px dragged down (a drag DOWN lifts the eye). */
  pitchPerPx: number;
  minPitch: number;
  maxPitch: number;
  /** |yaw| bound; omit for a view that may turn all the way round. */
  maxYaw?: number;
}

/** A drag's orbit, from the angles the drag started at, clamped: pitch so the eye
 *  never goes under the floor or over the top, yaw (when bounded) so a scene with a
 *  front never turns edge-on. */
export function orbitDrag(start: { yaw: number; pitch: number }, dx: number, dy: number,
                          limits: OrbitDragLimits): { yaw: number; pitch: number } {
  const yaw = start.yaw - dx * limits.yawPerPx;
  return {
    yaw: limits.maxYaw != null ? clamp(yaw, -limits.maxYaw, limits.maxYaw) : yaw,
    pitch: clamp(start.pitch + dy * limits.pitchPerPx, limits.minPitch, limits.maxPitch),
  };
}
