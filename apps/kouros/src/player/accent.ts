// player/accent.ts — the app-side half of musicPlayer()'s `accentFromArt` seam
// (git history: PLAYER_PARITY.md, retired: "a DECLARATIVE flag only... the spec's optional
// deriveAccent(coverUrl) hook — supplied by the consuming app — does the actual pixel
// extraction"). @jkos/player never imports @jkos/design or touches the DOM canvas API;
// this file is that app-supplied hook. PlayerProvider calls it per track and, on
// success, sets the result as CSS custom properties on the player scope element only
// (never document.documentElement).
//
// ⚠️ THE MEAN COLOUR IS NOT THE DOMINANT COLOUR, AND AVERAGING GIVES YOU MUD.
// The first implementation here summed every pixel and divided. That is the
// obvious approach and it is wrong for exactly the images this app shows: a
// sleeve with a red figure on a blue field averages to grey-purple, and a
// colourful record averages to grey full stop. Shipped, it made the Now Playing
// orb — the largest, most saturated control on the screen — a dead slate button
// on every single track, which reads as "the theme is broken" rather than "this
// album is grey".
//
// The fix is to find the dominant HUE and average only within it:
//
//   1. discard pixels that carry no colour information — transparent, near-black,
//      near-white, and desaturated ones. On most sleeves that is the majority of
//      the image, and every one of them drags a mean toward grey.
//   2. bucket what remains into 24 hue bins, weighting each pixel by how much
//      colour it actually contributes (saturation, times a mid-lightness falloff
//      so a blown-out highlight does not outvote the subject).
//   3. take the heaviest bin, average within it, then CLAMP saturation and
//      lightness into a range that works as UI chrome — the accent has to stay
//      legible against both faces and behind white glyphs, whatever the sleeve does.
//
// The secondary is taken from the heaviest bin that is far enough away in hue to
// read as a different colour, falling back to a rotation of the primary. That
// gives the two-stop pair buildJkOSTheme's `accent` config expects.

export interface DerivedAccent {
  primary?: string;
  secondary?: string;
}

/** How many hue buckets. 24 = 15° each: fine enough to separate red from orange,
 *  coarse enough that one bin still holds a meaningful population. */
const HUE_BINS = 24;

/** The accent has to work as chrome, not just be "the album's colour": these are
 *  the bounds a derived colour is pulled into before it is handed to the theme. */
const MIN_SAT = 0.42;
const MAX_SAT = 0.92;
const MIN_LIGHT = 0.38;
const MAX_LIGHT = 0.58;

/** Below this saturation a pixel is treated as greyscale and carries no hue vote. */
const SAT_FLOOR = 0.16;

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
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

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (h % 1) * 6;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = l - c / 2;
  const to = (v: number) => Math.max(0, Math.min(255, Math.round((v + m) * 255)))
    .toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load ${url}`));
    img.src = url;
  });
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Dominant-hue extraction over a downsampled canvas draw. Degrades to `{}` (no
 *  override) on ANY failure — a cross-origin cover art host tainting the canvas
 *  (getImageData throws SecurityError), a 404, a missing canvas 2d context, or a
 *  browser without a usable Image — silently, so the app simply keeps its own
 *  configured accent. */
export async function deriveAccentFromArt(url: string): Promise<DerivedAccent> {
  try {
    const img = await loadImage(url);
    const SIZE = 32;
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return {};
    ctx.drawImage(img, 0, 0, SIZE, SIZE);
    const { data } = ctx.getImageData(0, 0, SIZE, SIZE);   // throws on a tainted canvas

    const weight = new Float64Array(HUE_BINS);
    const sumS = new Float64Array(HUE_BINS);
    const sumL = new Float64Array(HUE_BINS);
    // Hue is circular, so a bin's mean hue is accumulated as a VECTOR: averaging
    // 359° and 1° arithmetically gives 180° (cyan) for two nearly identical reds.
    const sumSin = new Float64Array(HUE_BINS);
    const sumCos = new Float64Array(HUE_BINS);

    let fallbackR = 0, fallbackG = 0, fallbackB = 0, fallbackN = 0;

    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3]!;
      if (a < 16) continue;                       // transparent padding / letterbox
      const r = data[i]!, g = data[i + 1]!, b = data[i + 2]!;
      fallbackR += r; fallbackG += g; fallbackB += b; fallbackN++;

      const [h, s, l] = rgbToHsl(r, g, b);
      if (s < SAT_FLOOR) continue;                // greyscale — no hue to vote with
      if (l < 0.08 || l > 0.94) continue;         // crushed black / blown white

      // A pixel's vote is how much colour it actually carries: saturation, damped
      // as lightness moves away from the middle.
      const w = s * (1 - Math.abs(l - 0.5) * 1.35);
      if (w <= 0) continue;

      const bin = Math.min(HUE_BINS - 1, Math.floor(h * HUE_BINS));
      const rad = h * Math.PI * 2;
      weight[bin] += w;
      sumS[bin] += s * w;
      sumL[bin] += l * w;
      sumSin[bin] += Math.sin(rad) * w;
      sumCos[bin] += Math.cos(rad) * w;
    }

    if (!fallbackN) return {};

    let best = -1, bestW = 0;
    for (let i = 0; i < HUE_BINS; i++) if (weight[i]! > bestW) { bestW = weight[i]!; best = i; }

    // Nothing colourful at all (a genuinely monochrome sleeve): fall back to the
    // mean, which for such an image IS representative — the failure mode above
    // only bites when there was real colour to find.
    if (best < 0) {
      const [h, s, l] = rgbToHsl(fallbackR / fallbackN, fallbackG / fallbackN, fallbackB / fallbackN);
      const primary = hslToHex(h, clamp(s, 0, MAX_SAT), clamp(l, MIN_LIGHT, MAX_LIGHT));
      return { primary, secondary: hslToHex(h, clamp(s, 0, MAX_SAT), clamp(l + 0.14, MIN_LIGHT, 0.72)) };
    }

    const meanOf = (bin: number) => {
      const w = weight[bin]!;
      const h = (Math.atan2(sumSin[bin]! / w, sumCos[bin]! / w) / (Math.PI * 2) + 1) % 1;
      return { h, s: sumS[bin]! / w, l: sumL[bin]! / w };
    };

    const p = meanOf(best);
    const primary = hslToHex(p.h, clamp(p.s, MIN_SAT, MAX_SAT), clamp(p.l, MIN_LIGHT, MAX_LIGHT));

    // The secondary wants to be a genuinely DIFFERENT colour, so only bins at
    // least a sixth of the wheel away qualify; otherwise rotate the primary.
    let second = -1, secondW = 0;
    for (let i = 0; i < HUE_BINS; i++) {
      if (i === best) continue;
      const dist = Math.min(Math.abs(i - best), HUE_BINS - Math.abs(i - best)) / HUE_BINS;
      if (dist < 1 / 6) continue;
      if (weight[i]! > secondW) { secondW = weight[i]!; second = i; }
    }

    let secondary: string;
    if (second >= 0 && secondW > bestW * 0.18) {
      const q = meanOf(second);
      secondary = hslToHex(q.h, clamp(q.s, MIN_SAT, MAX_SAT), clamp(q.l, MIN_LIGHT, 0.66));
    } else {
      secondary = hslToHex((p.h + 0.08) % 1, clamp(p.s * 0.92, MIN_SAT, MAX_SAT), clamp(p.l + 0.12, MIN_LIGHT, 0.7));
    }

    return { primary, secondary };
  } catch {
    return {};
  }
}
