// coverPalette.ts — the pulsarmap's colours, every one of them, from the playing cover
// (ALGORITHMS.md §9). Pure: pixels in, colours out — no DOM, no GL, no imports — so
// test/pulsarmap.mjs drives it directly. The pixels come from player/accent.ts
// `coverPixels`, the same downsampled draw the app's accent is taken from.
//
// Jag, 2026-10-15: "use gradients made of colours pulled from the album cover for every
// aspect of this visualizer." So the cover gives:
//
//   ground   two DARK colours — the background, a vertical gradient. The curtains and
//            the fade are drawn in it too, so a curtain stays unseen and a line fades
//            into exactly what is behind it.
//   stops    two to four BRIGHT colours — the gradient a line takes across the spectrum.
//   crest    the cover's lightest colour — what a line turns toward as it peaks, and
//            what the live line leans to.
//
// ⚠️ **THE SAME LESSON AS accent.ts: THE MEAN COLOUR IS MUD.** A colour is found by
// HUE — pixels binned on the wheel, weighted by how much colour they carry — and then
// pulled into a lightness that can be SEEN where it is drawn: the ground dark, the
// stops and crest bright. That is the only liberty taken: hue is the cover's, and so is
// saturation up to a floor, but a navy sleeve's lines are a light navy-blue, because a
// navy line on a navy ground would not be a picture.

export type RGB = [number, number, number];

export interface CoverPalette {
  /** The background, bottom → top. */
  ground: [RGB, RGB];
  /** The line's gradient across the spectrum, low → high band; 2–4 stops. */
  stops: RGB[];
  /** The lightest colour — peaks and the live line lean to it. */
  crest: RGB;
}

const HUE_BINS = 24;
/** Below this a pixel is grey: it votes for no hue. (accent.ts's floor.) */
const SAT_FLOOR = 0.16;
/** Hues closer than this are one colour to the eye: a twelfth of the wheel, 30°. */
const MIN_HUE_GAP = 1 / 12;
/** A hue must carry at least this share of the leading one's weight to be a stop. */
const MIN_SHARE = 0.08;

/** Where each colour is pulled to, in HSL lightness — the one liberty (see above). */
export const GROUND_LIGHT: [number, number] = [0.05, 0.13];
export const STOP_LIGHT: [number, number] = [0.58, 0.76];
export const CREST_LIGHT = 0.86;

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h, s, l];
}

export function hslToRgb(h: number, s: number, l: number): RGB {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 1) + 1) % 1) * 6;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = l - c / 2;
  const ch = (v: number) => Math.min(1, Math.max(0, v + m));
  return [ch(r), ch(g), ch(b)];
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const hueGap = (a: number, b: number) => { const d = Math.abs(a - b) % 1; return Math.min(d, 1 - d); };

/** The palette of one cover, from its RGBA pixels (any size; 0–255). */
export function paletteFromPixels(data: ArrayLike<number>): CoverPalette {
  const weight = new Float64Array(HUE_BINS), sumS = new Float64Array(HUE_BINS);
  const sumSin = new Float64Array(HUE_BINS), sumCos = new Float64Array(HUE_BINS);
  const px: Array<[number, number, number]> = [];
  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i + 3] < 16) continue;                          // transparent letterbox
    const hsl = rgbToHsl(data[i] / 255, data[i + 1] / 255, data[i + 2] / 255);
    px.push(hsl);
    const [h, s, l] = hsl;
    if (s < SAT_FLOOR || l < 0.08 || l > 0.94) continue;     // no hue to vote with
    const w = s * (1 - Math.abs(l - 0.5) * 1.35);
    if (w <= 0) continue;
    const bin = Math.min(HUE_BINS - 1, Math.floor(h * HUE_BINS));
    weight[bin] += w; sumS[bin] += s * w;
    sumSin[bin] += Math.sin(h * 2 * Math.PI) * w; sumCos[bin] += Math.cos(h * 2 * Math.PI) * w;
  }
  if (!px.length) px.push([0, 0, 0.5]);

  // The cover's hues, heaviest first, no two within MIN_HUE_GAP of each other.
  const hues: Array<{ h: number; s: number; w: number }> = [];
  const order = Array.from({ length: HUE_BINS }, (_, i) => i).sort((a, b) => weight[b] - weight[a]);
  for (const bin of order) {
    const w = weight[bin];
    if (!(w > 0) || (hues.length && w < hues[0].w * MIN_SHARE) || hues.length === 4) break;
    const h = ((Math.atan2(sumSin[bin], sumCos[bin]) / (2 * Math.PI)) + 1) % 1;
    if (hues.some((q) => hueGap(q.h, h) < MIN_HUE_GAP)) continue;
    hues.push({ h, s: sumS[bin] / w, w });
  }

  // The darkest and lightest parts of the cover, as they are (their own hue).
  const byLight = px.slice().sort((a, b) => a[2] - b[2]);
  const meanOf = (part: Array<[number, number, number]>) => {
    let x = 0, y = 0, s = 0, l = 0;
    for (const [h, ss, ll] of part) { x += Math.cos(h * 2 * Math.PI) * ss; y += Math.sin(h * 2 * Math.PI) * ss; s += ss; l += ll; }
    const n = Math.max(1, part.length);
    return { h: ((Math.atan2(y, x) / (2 * Math.PI)) + 1) % 1, s: s / n, l: l / n };
  };
  const dark = meanOf(byLight.slice(0, Math.max(1, Math.floor(byLight.length * 0.4))));
  const light = meanOf(byLight.slice(Math.floor(byLight.length * 0.9)));

  // Stops: the cover's hues in wheel order from the heaviest, so the gradient walks the
  // wheel rather than jumping across it. A cover with fewer than two hues is filled from
  // its own light and dark ends — a monochrome sleeve stays monochrome.
  let stops: RGB[];
  if (hues.length >= 2) {
    const lead = hues[0].h;
    const walk = hues.slice().sort((a, b) => ((a.h - lead + 1) % 1) - ((b.h - lead + 1) % 1));
    stops = walk.map((q, i) => hslToRgb(q.h, clamp(q.s, 0.45, 0.95),
      STOP_LIGHT[0] + (STOP_LIGHT[1] - STOP_LIGHT[0]) * (walk.length > 1 ? i / (walk.length - 1) : 0)));
  } else if (hues.length === 1) {
    const q = hues[0];
    stops = [hslToRgb(q.h, clamp(q.s, 0.45, 0.95), STOP_LIGHT[0]),
             hslToRgb(light.s > SAT_FLOOR ? light.h : q.h, clamp(light.s, 0.15, 0.6), STOP_LIGHT[1])];
  } else {
    const h = dark.s > 0.05 ? dark.h : light.h;
    const s = clamp(Math.max(dark.s, light.s), 0, 0.35);
    stops = [hslToRgb(h, s, STOP_LIGHT[0]), hslToRgb(light.h, clamp(light.s, 0, 0.3), STOP_LIGHT[1])];
  }

  // The crest: the cover's light end, made light enough to read as the brightest thing.
  const crest = hslToRgb(light.h, clamp(light.s, 0, 0.5), Math.max(CREST_LIGHT, light.l));

  // The ground: the cover's dark end at the bottom; toward the top, the leading hue.
  const lead = hues[0] ?? { h: dark.h, s: dark.s };
  const ground: [RGB, RGB] = [
    hslToRgb(dark.h, clamp(dark.s, 0, 0.7), clamp(dark.l, GROUND_LIGHT[0], GROUND_LIGHT[0] + 0.03)),
    hslToRgb(lead.h, clamp(lead.s, 0, 0.6), GROUND_LIGHT[1]),
  ];
  return { ground, stops, crest };
}
