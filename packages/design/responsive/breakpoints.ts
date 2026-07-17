/**
 * responsive/breakpoints.ts — the ONE breakpoint definition for the whole suite.
 *
 * Before this, three numbers disagreed: BeigeBoard's matchMedia (768), ORDECK's
 * grid engine (880), and a stray ORDECK CSS @media (1100). They are all retired
 * in favour of this source. Both the CSS (the `@media` blocks in tokens/hub.css)
 * and the JS (`useBreakpoint` in @jkos/ui, ORDECK's grid engine) read these same
 * numbers, and `test/responsive.mjs` asserts the CSS hasn't drifted from them.
 *
 * Three tiers — mobile / tablet / desktop. The mobile upper bound stays at 767
 * so BeigeBoard's effective phone crossover is unchanged from its old 768px.
 */

export type BreakpointName = 'mobile' | 'tablet' | 'desktop';

export interface BreakpointDef {
  name: BreakpointName;
  /** Active when viewport width ≥ minWidth; the largest matching tier wins. */
  minWidth: number;
}

/** Sorted high→low so the first match in `activeBreakpoint` is the widest tier. */
export const BREAKPOINTS: readonly BreakpointDef[] = [
  { name: 'desktop', minWidth: 1024 },
  { name: 'tablet', minWidth: 768 },
  { name: 'mobile', minWidth: 0 },
] as const;

/** Upper bounds (px) the CSS `@media (max-width: …)` blocks key off — each is one
 *  below the next tier's minWidth. The conformance test pins hub.css to these. */
export const BREAKPOINT_MAX = {
  mobile: 767, // < tablet.minWidth (768)
  tablet: 1023, // < desktop.minWidth (1024)
} as const;

/** matchMedia-ready query strings — the single source for the JS hook. Every
 *  bound derives from BREAKPOINT_MAX (each tier's min is one past the tier below)
 *  so these can never drift from the CSS `@media` blocks. `test/responsive.mjs`
 *  enforces that no raw breakpoint literal sneaks back in here. */
export const MEDIA = {
  mobile: `(max-width: ${BREAKPOINT_MAX.mobile}px)`,
  tablet: `(min-width: ${BREAKPOINT_MAX.mobile + 1}px) and (max-width: ${BREAKPOINT_MAX.tablet}px)`,
  desktop: `(min-width: ${BREAKPOINT_MAX.tablet + 1}px)`,
} as const;

/** Resolve a viewport width (px) to its tier. */
export function activeBreakpoint(width: number): BreakpointName {
  for (const bp of BREAKPOINTS) {
    if (width >= bp.minWidth) return bp.name;
  }
  return 'mobile';
}
