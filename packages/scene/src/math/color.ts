// color.ts — colour as numbers, PURE: parsing what the browser resolves a token to,
// and OKLCH both ways. The DOM half (a probe element given the token as its `color`)
// is `tokenColor` in ../gl/context.ts; everything here runs in a worker or a node gate.

import { clamp } from './motion';

export type RGB = [number, number, number];

/** Parse what `getComputedStyle(el).color` reports into 0–1 channels. */
export function parseColor(text: string): RGB | null {
  const t = text.trim();
  let m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(t);
  if (m) return [Number(m[1]) / 255, Number(m[2]) / 255, Number(m[3]) / 255];
  m = /^color\(\s*srgb\s+([\d.e+-]+)\s+([\d.e+-]+)\s+([\d.e+-]+)/i.exec(t);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])].map((v) => Math.min(1, Math.max(0, v))) as RGB;
  m = /^#([0-9a-f]{6})$/i.exec(t);
  if (m) return [0, 2, 4].map((i) => parseInt(m![1].slice(i, i + 2), 16) / 255) as RGB;
  return null;
}

/* ── OKLCH — the perceptual space a sequential ramp is built in ───────────────── */
// Lightness steps in OKLCH read as equal steps; in sRGB they do not. A ramp for an
// ORDERED quantity is one hue walked through L (dataviz: sequential), and a colour
// taken from a token is decomposed here to find its hue.

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/** sRGB (0–1) → [L, C, h], h in radians. */
export function srgbToOklch([r, g, b]: RGB): [number, number, number] {
  const R = toLinear(r), G = toLinear(g), B = toLinear(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(a, bb), Math.atan2(bb, a)];
}

function oklchToLinear(L: number, C: number, h: number): RGB {
  const a = C * Math.cos(h), b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** OKLCH → sRGB (0–1), pulling chroma in (hue and lightness held) until it is in
 *  gamut — never clipping a channel, which would shift the hue. */
export function oklchToSrgb(L: number, C: number, h: number): RGB {
  const inGamut = (c: RGB) => c.every((v) => v >= -1e-6 && v <= 1 + 1e-6);
  let lo = 0, hi = C, rgb = oklchToLinear(L, C, h);
  if (!inGamut(rgb)) {
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklchToLinear(L, mid, h))) lo = mid; else hi = mid;
    }
    rgb = oklchToLinear(L, lo, h);
  }
  return rgb.map((v) => toGamma(clamp(v, 0, 1))) as RGB;
}
