/**
 * color.ts — safe alpha application for suite CSS.
 *
 * The kit colours items with values that are EITHER bare hex (`#33aaff`, from a
 * source colour or a picker) OR CSS custom properties (`var(--color-accent)`).
 * The old pattern `` `${color}66` `` only works for the first: appending `66`
 * to a `var(...)` yields `var(--color-accent)66`, which the browser rejects and
 * silently drops — the glow/shadow just never renders. `withAlpha` branches on
 * the value so both paths produce valid CSS:
 *
 *   • bare hex          → hex-concat (identical bytes to the old code)
 *   • anything else      → `color-mix(in srgb, <color> N%, transparent)`
 *
 * `alpha` is a 0–1 fraction. Common legacy hex suffixes map cleanly:
 *   0.13→22  0.2→33  0.27→44  0.33→55  0.4→66  0.53→88  0.6→99  0.8→cc
 */

const BARE_HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function withAlpha(color: string, alpha: number): string {
  const a = Math.max(0, Math.min(1, alpha));
  const c = color.trim();

  if (BARE_HEX.test(c)) {
    // Expand #rgb → #rrggbb so the alpha byte always lands on a 6-digit base.
    const base =
      c.length === 4 ? '#' + c.slice(1).split('').map((ch) => ch + ch).join('') : c;
    const byte = Math.round(a * 255).toString(16).padStart(2, '0');
    return base + byte;
  }

  // CSS var / named / rgb() / color-mix() — hex concat would be invalid here.
  return `color-mix(in srgb, ${c} ${Math.round(a * 100)}%, transparent)`;
}
