// pick.ts — from the screen back into the scene, and labels laid over it, PURE.
// Projection itself is motion.ts (`toScreen`, `screenRay`); this is what a view does
// with projected points: find the one under a finger, cast a ray into a volume, and
// keep floating labels from piling on top of each other.

import type { Vec3 } from './motion';

/** The nearest point within `radius` CSS px of (x, y) whose weight is at least
 *  `minWeight`, or −1. `screen` is (x, y) per point, NaN for one behind the camera;
 *  `weights` is how pickable each point is right now (a glint, an opacity). */
export function pickNearest(screen: Float32Array, weights: Float32Array, x: number, y: number,
                            radius = 22, minWeight = 0.5): number {
  let best = -1, bd = radius * radius;
  for (let i = 0; i < weights.length; i++) {
    if (!(weights[i] >= minWeight)) continue;
    const dx = screen[i * 2] - x, dy = screen[i * 2 + 1] - y;
    const d = dx * dx + dy * dy;
    if (d <= bd) { bd = d; best = i; }
  }
  return best;
}

/** Entry and exit distances of a ray through the cube [−half, half]³, or null for a
 *  miss. A ray starting inside enters at 0. */
export function rayBox(origin: Vec3, dir: Vec3, half = 1): [number, number] | null {
  let t0 = -Infinity, t1 = Infinity;
  for (let k = 0; k < 3; k++) {
    if (Math.abs(dir[k]) < 1e-12) {
      if (origin[k] < -half || origin[k] > half) return null;
      continue;
    }
    let a = (-half - origin[k]) / dir[k], b = (half - origin[k]) / dir[k];
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
  }
  if (t1 < Math.max(0, t0)) return null;
  return [Math.max(0, t0), t1];
}

export interface LabelBox { id: number; x: number; y: number; width: number; height: number; alpha: number }

/** At most `max` labels, most visible first, none overlapping another; a label
 *  fainter than `minAlpha` is not a candidate at all. */
export function thinLabels(boxes: readonly LabelBox[], max = 8, minAlpha = 0.08): number[] {
  const kept: LabelBox[] = [];
  for (const b of [...boxes].filter((b) => b.alpha >= minAlpha).sort((a, c) => c.alpha - a.alpha)) {
    if (kept.length >= max) break;
    const clash = kept.some((k) => Math.abs(k.x - b.x) * 2 < k.width + b.width && Math.abs(k.y - b.y) * 2 < k.height + b.height);
    if (!clash) kept.push(b);
  }
  return kept.map((k) => k.id);
}
