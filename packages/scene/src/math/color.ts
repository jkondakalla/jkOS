// color.ts — colour as numbers, PURE: parsing what the browser resolves a token to.
// The DOM half (a probe element given the token as its `color`) is `tokenColor` in
// ../gl/context.ts; the parse lives here so a worker or a node gate can use it.

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
