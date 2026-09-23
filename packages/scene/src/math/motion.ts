// motion.ts — the PURE math every @jkos/scene view shares: column-major 4×4
// matrices, a few vec3 helpers, an orbit camera, and a critically damped spring.
// No DOM, no clock, no runtime imports — test/scene.test.mjs transpiles it and drives
// the real functions (and KourOS's check:pulsarmap / check:vibespace import it too).
//
// ⚠️ **NO LIBRARY, ON PURPOSE.** gl-matrix or three.js would be the usual answer, and
// both are dependencies against a frontend that has none for this — three.js alone
// is ~600 KB for a view that needs a perspective, a lookAt and a multiply. The
// house rule is to add nothing, and the math below is the whole of what is used.
//
// ⚠️ **THE SPRING IS SOLVED, NOT STEPPED.** An Euler-integrated spring's damping
// depends on the frame rate: at 30 fps on a throttled phone it overshoots, at
// 120 fps it crawls, and a scrub that snaps to a stop lands somewhere different
// on every device. `springStep` evaluates the closed-form critically damped
// solution for exactly `dt`, so the camera takes the same path at any frame rate
// and never rings.

export type Vec3 = [number, number, number];
export type Mat4 = Float32Array;

export const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const DEG = Math.PI / 180;

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0 || 1e-9), 0, 1);
  return t * t * (3 - 2 * t);
}

/* ── vec3 ─────────────────────────────────────────────────────────────────── */
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0],
];
export function normalize(a: Vec3): Vec3 {
  const n = Math.hypot(a[0], a[1], a[2]);
  return n > 1e-12 ? [a[0] / n, a[1] / n, a[2] / n] : [0, 0, 0];
}

/* ── mat4, column-major (GL's convention: m[12..14] is the translation) ────── */
export function identity(out: Mat4 = new Float32Array(16)): Mat4 {
  out.fill(0);
  out[0] = out[5] = out[10] = out[15] = 1;
  return out;
}

export function perspective(fovy: number, aspect: number, near: number, far: number,
                            out: Mat4 = new Float32Array(16)): Mat4 {
  const f = 1 / Math.tan(fovy / 2);
  out.fill(0);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) / (near - far);
  out[11] = -1;
  out[14] = (2 * far * near) / (near - far);
  return out;
}

export function lookAt(eye: Vec3, target: Vec3, up: Vec3, out: Mat4 = new Float32Array(16)): Mat4 {
  const zAxis = normalize(sub(eye, target));
  let xAxis = normalize(cross(up, zAxis));
  if (xAxis[0] === 0 && xAxis[1] === 0 && xAxis[2] === 0) xAxis = [1, 0, 0];   // looking along `up`
  const yAxis = cross(zAxis, xAxis);
  out[0] = xAxis[0]; out[1] = yAxis[0]; out[2] = zAxis[0]; out[3] = 0;
  out[4] = xAxis[1]; out[5] = yAxis[1]; out[6] = zAxis[1]; out[7] = 0;
  out[8] = xAxis[2]; out[9] = yAxis[2]; out[10] = zAxis[2]; out[11] = 0;
  out[12] = -dot(xAxis, eye); out[13] = -dot(yAxis, eye); out[14] = -dot(zAxis, eye); out[15] = 1;
  return out;
}

/** out = a · b */
export function multiply(a: Mat4, b: Mat4, out: Mat4 = new Float32Array(16)): Mat4 {
  const r = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let row = 0; row < 4; row++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + row] * b[c * 4 + k];
      r[c * 4 + row] = s;
    }
  }
  out.set(r);
  return out;
}

/** The general 4×4 inverse. Returns null for a singular matrix rather than NaNs. */
export function invert(m: Mat4, out: Mat4 = new Float32Array(16)): Mat4 | null {
  const a = Array.from(m);
  const inv = new Array<number>(16);
  inv[0] = a[5] * a[10] * a[15] - a[5] * a[11] * a[14] - a[9] * a[6] * a[15] + a[9] * a[7] * a[14] + a[13] * a[6] * a[11] - a[13] * a[7] * a[10];
  inv[4] = -a[4] * a[10] * a[15] + a[4] * a[11] * a[14] + a[8] * a[6] * a[15] - a[8] * a[7] * a[14] - a[12] * a[6] * a[11] + a[12] * a[7] * a[10];
  inv[8] = a[4] * a[9] * a[15] - a[4] * a[11] * a[13] - a[8] * a[5] * a[15] + a[8] * a[7] * a[13] + a[12] * a[5] * a[11] - a[12] * a[7] * a[9];
  inv[12] = -a[4] * a[9] * a[14] + a[4] * a[10] * a[13] + a[8] * a[5] * a[14] - a[8] * a[6] * a[13] - a[12] * a[5] * a[10] + a[12] * a[6] * a[9];
  inv[1] = -a[1] * a[10] * a[15] + a[1] * a[11] * a[14] + a[9] * a[2] * a[15] - a[9] * a[3] * a[14] - a[13] * a[2] * a[11] + a[13] * a[3] * a[10];
  inv[5] = a[0] * a[10] * a[15] - a[0] * a[11] * a[14] - a[8] * a[2] * a[15] + a[8] * a[3] * a[14] + a[12] * a[2] * a[11] - a[12] * a[3] * a[10];
  inv[9] = -a[0] * a[9] * a[15] + a[0] * a[11] * a[13] + a[8] * a[1] * a[15] - a[8] * a[3] * a[13] - a[12] * a[1] * a[11] + a[12] * a[3] * a[9];
  inv[13] = a[0] * a[9] * a[14] - a[0] * a[10] * a[13] - a[8] * a[1] * a[14] + a[8] * a[2] * a[13] + a[12] * a[1] * a[10] - a[12] * a[2] * a[9];
  inv[2] = a[1] * a[6] * a[15] - a[1] * a[7] * a[14] - a[5] * a[2] * a[15] + a[5] * a[3] * a[14] + a[13] * a[2] * a[7] - a[13] * a[3] * a[6];
  inv[6] = -a[0] * a[6] * a[15] + a[0] * a[7] * a[14] + a[4] * a[2] * a[15] - a[4] * a[3] * a[14] - a[12] * a[2] * a[7] + a[12] * a[3] * a[6];
  inv[10] = a[0] * a[5] * a[15] - a[0] * a[7] * a[13] - a[4] * a[1] * a[15] + a[4] * a[3] * a[13] + a[12] * a[1] * a[7] - a[12] * a[3] * a[5];
  inv[14] = -a[0] * a[5] * a[14] + a[0] * a[6] * a[13] + a[4] * a[1] * a[14] - a[4] * a[2] * a[13] - a[12] * a[1] * a[6] + a[12] * a[2] * a[5];
  inv[3] = -a[1] * a[6] * a[11] + a[1] * a[7] * a[10] + a[5] * a[2] * a[11] - a[5] * a[3] * a[10] - a[9] * a[2] * a[7] + a[9] * a[3] * a[6];
  inv[7] = a[0] * a[6] * a[11] - a[0] * a[7] * a[10] - a[4] * a[2] * a[11] + a[4] * a[3] * a[10] + a[8] * a[2] * a[7] - a[8] * a[3] * a[6];
  inv[11] = -a[0] * a[5] * a[11] + a[0] * a[7] * a[9] + a[4] * a[1] * a[11] - a[4] * a[3] * a[9] - a[8] * a[1] * a[7] + a[8] * a[3] * a[5];
  inv[15] = a[0] * a[5] * a[10] - a[0] * a[6] * a[9] - a[4] * a[1] * a[10] + a[4] * a[2] * a[9] + a[8] * a[1] * a[6] - a[8] * a[2] * a[5];
  const det = a[0] * inv[0] + a[1] * inv[4] + a[2] * inv[8] + a[3] * inv[12];
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  for (let i = 0; i < 16; i++) out[i] = inv[i] / det;
  return out;
}

/** m · (x, y, z, 1), un-divided — [x, y, z, w] in clip space for a view-projection. */
export function transform(m: Mat4, p: Vec3): [number, number, number, number] {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
    m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15],
  ];
}

/** A world point → CSS pixels in a viewport of `width` × `height`, or null when it is
 *  behind the camera. y grows DOWN, as the DOM's does. */
export function toScreen(viewProj: Mat4, p: Vec3, width: number, height: number):
  { x: number; y: number; depth: number } | null {
  const c = transform(viewProj, p);
  if (!(c[3] > 1e-6)) return null;
  return { x: (c[0] / c[3] * 0.5 + 0.5) * width, y: (0.5 - c[1] / c[3] * 0.5) * height, depth: c[2] / c[3] };
}

/** The ray under a CSS pixel, in world space: origin and unit direction. */
export function screenRay(invViewProj: Mat4, x: number, y: number, width: number, height: number):
  { origin: Vec3; dir: Vec3 } {
  const nx = (x / width) * 2 - 1;
  const ny = 1 - (y / height) * 2;
  const unproject = (z: number): Vec3 => {
    const c = transform(invViewProj, [nx, ny, z]);
    return [c[0] / c[3], c[1] / c[3], c[2] / c[3]];
  };
  const near = unproject(-1);
  const far = unproject(1);
  return { origin: near, dir: normalize(sub(far, near)) };
}

/* ── the orbit camera ─────────────────────────────────────────────────────── */

/** Where the eye sits for an orbit about `target`: `yaw` turns about +y (0 looks
 *  along −z, from +z), `pitch` lifts the eye above the horizon. Radians. */
export function orbitEye(target: Vec3, yaw: number, pitch: number, distance: number): Vec3 {
  const cp = Math.cos(pitch);
  return [
    target[0] + distance * cp * Math.sin(yaw),
    target[1] + distance * Math.sin(pitch),
    target[2] + distance * cp * Math.cos(yaw),
  ];
}

/* ── the critically damped spring ─────────────────────────────────────────── */
export interface Spring {
  x: number;
  v: number;
}

/**
 * Advance a critically damped spring toward `target` by exactly `dt` seconds.
 *
 *   x(t) = target + (c₁ + c₂t)·e^(−ωt),   c₁ = x₀ − target,   c₂ = v₀ + ω·c₁
 *
 * `omega` is the natural frequency in rad/s: ~4.6/ω seconds to settle within 1%.
 * From rest it never overshoots; a flick's velocity can carry it past once and
 * back, never ringing.
 */
export function springStep(s: Spring, target: number, omega: number, dt: number): Spring {
  if (!(dt > 0)) return { x: s.x, v: s.v };
  const c1 = s.x - target;
  const c2 = s.v + omega * c1;
  const e = Math.exp(-omega * dt);
  return { x: target + (c1 + c2 * dt) * e, v: (c2 - omega * (c1 + c2 * dt)) * e };
}

export function springSettled(s: Spring, target: number, eps = 1e-4): boolean {
  return Math.abs(s.x - target) < eps && Math.abs(s.v) < eps * 10;
}

/** The shortest signed angle from `a` to `b`, in (−π, π]. A yaw spring aimed at
 *  2π from 0.1 would otherwise unwind a whole turn to arrive where it started. */
export function angleDelta(a: number, b: number): number {
  let d = (b - a) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d <= -Math.PI) d += 2 * Math.PI;
  return d;
}
