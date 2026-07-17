// player/accent.ts — the app-side half of musicPlayer()'s `accentFromArt` seam
// (PLAYER_PARITY.md §3: "a DECLARATIVE flag only... the spec's optional
// deriveAccent(coverUrl) hook — supplied by the consuming app — does the actual pixel
// extraction"). @jkos/player never imports @jkos/design or touches the DOM canvas API;
// this file is that app-supplied hook. PlayerBar.tsx calls it per track and, on
// success, sets the result as CSS custom properties on the bar's own root element only
// (never document.documentElement) — see PlayerBar.tsx's useAccent effect.

export interface DerivedAccent {
  primary?: string;
  secondary?: string;
}

function toHex(n: number): string {
  return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/** A slightly brighter/more-saturated sibling of the average colour — cheap stand-in
 *  for a real second dominant cluster, good enough for a two-stop accent pair (the
 *  primary chrome tint + the "secondary" hover/active tint buildJkOSTheme's `accent`
 *  config already expects — see createPlayer.ts's DerivedAccent doc). */
function lighten(r: number, g: number, b: number, amount: number): [number, number, number] {
  return [r + (255 - r) * amount, g + (255 - g) * amount, b + (255 - b) * amount];
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

/** Average-colour extraction over a downsampled canvas draw. Degrades to `{}` (no
 *  override) on ANY failure — a cross-origin cover art host tainting the canvas
 *  (getImageData throws SecurityError), a 404, a missing canvas 2d context, or a
 *  browser without OffscreenCanvas/Image — silently, per the wave's design note. */
export async function deriveAccentFromArt(url: string): Promise<DerivedAccent> {
  try {
    const img = await loadImage(url);
    const SIZE = 24;   // small enough to sample fast; large enough to average sanely
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return {};
    ctx.drawImage(img, 0, 0, SIZE, SIZE);
    const { data } = ctx.getImageData(0, 0, SIZE, SIZE);   // throws on a tainted canvas

    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 16) continue;   // skip near-transparent pixels (padding/letterbox)
      r += data[i]; g += data[i + 1]; b += data[i + 2];
      n++;
    }
    if (n === 0) return {};
    r /= n; g /= n; b /= n;

    const primary = rgbToHex(r, g, b);
    const [sr, sg, sb] = lighten(r, g, b, 0.28);
    const secondary = rgbToHex(sr, sg, sb);
    return { primary, secondary };
  } catch {
    return {};
  }
}
