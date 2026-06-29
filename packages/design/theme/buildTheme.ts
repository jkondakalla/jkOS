/**
 * Design/theme/buildTheme.ts — the jkOS theme factory.
 *
 * Apps no longer hand-write token CSS. They call buildJkOSTheme() with the few
 * things that legitimately vary per app — the default accent pair, the neutral
 * palettes (light + dark), radius, fonts — and get back the CSS that overrides
 * the INPUT tokens in hub.css. The universal DERIVATION (the accent chain, the
 * --hub-amber/--hub-cyan families, --color-* aliases, paper-deepen/dark-glow)
 * lives once in hub.css and recomputes from these inputs — never duplicated.
 *
 *   buildJkOSTheme({
 *     accent: { primary: '#ffb000', secondary: '#4ecdc4' },  // DEFAULT pair only;
 *     light:  { bg0: '#c8cdd4', bg2: '#e8edf4', creamBright: '#0a1820', line: '#c0c8d2' },
 *     dark:   { bg0: '#0c1018', bg2: '#1c2432', creamBright: '#d0e4f0', line: '#2a3848' },
 *     radius: { base: '1rem' },
 *     fonts:  { sans: "'Hanken Grotesk'", serif: "'Fraunces'" },
 *   })
 *
 * The user's saved pair still overrides --accent-raw / --accent-2-raw at runtime
 * via applyJkOSTheme(), so `accent` here is only the pre-login default.
 *
 * Framework-free: returns a CSS string. Inject it once with <JkOSTheme> (@jkos/ui)
 * or injectJkOSTheme() below.
 */

import { BREAKPOINT_MAX } from '../responsive/breakpoints';

/** Neutral palette — only the keys you set are emitted; the rest fall back to
 *  hub.css defaults. Keys map 1:1 onto the --hub-* neutral tokens. */
export interface JkOSNeutrals {
  bg0?: string;  bg1?: string;  bg2?: string;  bg3?: string;  bg4?: string;
  screen?: string;  screenLine?: string;
  metal0?: string;  metal1?: string;  metal2?: string;
  bevelLight?: string;  bevelDark?: string;
  line?: string;  lineStrong?: string;  lineBright?: string;
  /** Text ramp. `creamBright` is primary text; `cream` is muted body. */
  cream?: string;  creamBright?: string;  creamDim?: string;  creamFaint?: string;
}

/** Radius scale — a per-app input. Every key maps 1:1 onto a `--hub-radius*`
 *  token; set the ones an app uses, omit the rest to inherit the (sharp) hub
 *  default. `xs` is the tiny-control rung (checkboxes, swatches). */
export interface JkOSRadius {
  base?: string;  xs?: string;  sm?: string;  lg?: string;
  soft?: string;  widget?: string;  button?: string;
}

export interface JkOSFonts {
  mono?: string;  sans?: string;  seg?: string;  serif?: string;
}

/** Per-tier overrides for the responsive card scale (the viewport axis). Every
 *  key maps 1:1 onto a `--hub-*` scale token; set only what an app wants to tune.
 *  Apps need NOT set this — hub.css ships sensible tablet/mobile defaults. */
export interface JkOSResponsiveScale {
  tapMin?: string;  widgetPad?: string;
  fsBubble?: string;  fsBubbleLg?: string;  padBubble?: string;  padBubbleLg?: string;
  fsPill?: string;  padPill?: string;
  fsTbtn?: string;  padTbtn?: string;
  fsLab?: string;  fsLabSm?: string;  fsLabXs?: string;
}

export interface JkOSAccentDefault {
  /** Default primary accent (pre-login; user pref overrides at runtime). */
  primary?: string;
  /** Default secondary accent. */
  secondary?: string;
  /** Paper deepen target (warm near-black). Rarely changed. */
  deepenInk?: string;
}

export interface JkOSThemeConfig {
  accent?: JkOSAccentDefault;
  light?: JkOSNeutrals;
  dark?: JkOSNeutrals;
  /** Radius scale (applies to both modes). */
  radius?: JkOSRadius;
  /** Font stacks (applies to both modes). */
  fonts?: JkOSFonts;
  /** Tune the responsive card scale per tier. Emitted inside the same tablet/
   *  mobile `@media` bounds hub.css uses (the canonical breakpoints), scoped to
   *  `selector`. Optional — omit to inherit the shared responsive defaults. */
  responsive?: { tablet?: JkOSResponsiveScale; mobile?: JkOSResponsiveScale };
  /** Suite-wide film grain on the page background. Default ON: the factory paints
   *  the shared --hub-grain-image (~18%) onto `<scope> body`, blended INTO the
   *  body's own background colour (--grain-blend: multiply on paper, screen in
   *  dark). It textures the backdrop only — never content/cards/text — so apps
   *  just let the body show through (don't cover it with an opaque fill). Pass
   *  `grain: false` to opt a scope out. */
  grain?: boolean;
  /** Scope selector. Default ':root'. Use e.g. 'html.od-v2' to theme a subtree
   *  while the derivation layer (on :root) still reads these inputs. */
  selector?: string;
}

const NEUTRAL_VARS: Record<keyof JkOSNeutrals, string> = {
  bg0: '--hub-bg-0', bg1: '--hub-bg-1', bg2: '--hub-bg-2', bg3: '--hub-bg-3', bg4: '--hub-bg-4',
  screen: '--hub-screen', screenLine: '--hub-screen-line',
  metal0: '--hub-metal-0', metal1: '--hub-metal-1', metal2: '--hub-metal-2',
  bevelLight: '--hub-bevel-light', bevelDark: '--hub-bevel-dark',
  line: '--hub-line', lineStrong: '--hub-line-strong', lineBright: '--hub-line-bright',
  cream: '--hub-cream', creamBright: '--hub-cream-bright', creamDim: '--hub-cream-dim', creamFaint: '--hub-cream-faint',
};

const RADIUS_VARS: Record<keyof JkOSRadius, string> = {
  base: '--hub-radius', xs: '--hub-radius-xs', sm: '--hub-radius-sm', lg: '--hub-radius-lg',
  soft: '--hub-radius-soft', widget: '--hub-radius-widget', button: '--hub-radius-button',
};

const FONT_VARS: Record<keyof JkOSFonts, string> = {
  mono: '--hub-font-mono', sans: '--hub-font-sans', seg: '--hub-font-seg', serif: '--hub-font-serif',
};

const SCALE_VARS: Record<keyof JkOSResponsiveScale, string> = {
  tapMin: '--hub-tap-min', widgetPad: '--hub-widget-pad',
  fsBubble: '--hub-fs-bubble', fsBubbleLg: '--hub-fs-bubble-lg',
  padBubble: '--hub-pad-bubble', padBubbleLg: '--hub-pad-bubble-lg',
  fsPill: '--hub-fs-pill', padPill: '--hub-pad-pill',
  fsTbtn: '--hub-fs-tbtn', padTbtn: '--hub-pad-tbtn',
  fsLab: '--hub-fs-lab', fsLabSm: '--hub-fs-lab-sm', fsLabXs: '--hub-fs-lab-xs',
};

function decls<K extends string>(
  map: Record<K, string>,
  obj: Partial<Record<K, string>> | undefined,
): string[] {
  if (!obj) return [];
  const out: string[] = [];
  for (const key of Object.keys(map) as K[]) {
    const value = obj[key];
    if (value != null && value !== '') out.push(`${map[key]}: ${value};`);
  }
  return out;
}

/** Build the CSS that overrides hub.css INPUT tokens for one app. */
export function buildJkOSTheme(config: JkOSThemeConfig = {}): string {
  const sel = config.selector ?? ':root';

  const base: string[] = [];
  if (config.accent?.primary)   base.push(`--accent-raw: ${config.accent.primary};`);
  if (config.accent?.secondary) base.push(`--accent-2-raw: ${config.accent.secondary};`);
  if (config.accent?.deepenInk) base.push(`--accent-deepen-ink: ${config.accent.deepenInk};`);
  base.push(...decls(RADIUS_VARS, config.radius));
  base.push(...decls(FONT_VARS, config.fonts));
  base.push(...decls(NEUTRAL_VARS, config.light));

  const dark = decls(NEUTRAL_VARS, config.dark);

  let css = '';
  if (base.length) css += `${sel} {\n  ${base.join('\n  ')}\n}\n`;
  if (dark.length) css += `${sel}[data-mode="dark"] {\n  ${dark.join('\n  ')}\n}\n`;

  // Film grain — on by default. Blends the shared noise into the body's own
  // background paint, so it reads as a textured backdrop and never overlays
  // content. --hub-grain-image (alpha ≈ 18%) + --grain-blend live in hub.css.
  if (config.grain !== false) {
    css += `${sel} body {\n` +
           `  background-image: var(--hub-grain-image);\n` +
           `  background-size: 160px 160px;\n` +
           `  background-blend-mode: var(--grain-blend);\n` +
           `}\n`;
  }

  // Responsive-scale tuning — emitted inside the canonical tablet/mobile bounds,
  // overriding only the scale tokens hub.css already defaults. Skipped entirely
  // when an app doesn't set `responsive`.
  const tablet = decls(SCALE_VARS, config.responsive?.tablet);
  const mobile = decls(SCALE_VARS, config.responsive?.mobile);
  if (tablet.length) {
    css += `@media (max-width: ${BREAKPOINT_MAX.tablet}px) {\n  ${sel} {\n    ${tablet.join('\n    ')}\n  }\n}\n`;
  }
  if (mobile.length) {
    css += `@media (max-width: ${BREAKPOINT_MAX.mobile}px) {\n  ${sel} {\n    ${mobile.join('\n    ')}\n  }\n}\n`;
  }
  return css;
}

/**
 * Inject (or update) a per-app theme as a <style> in <head>. Call once at
 * startup, after the hub.css import, so it wins the cascade. No-op outside a DOM.
 */
export function injectJkOSTheme(config: JkOSThemeConfig, id = 'jkos-theme'): void {
  if (typeof document === 'undefined') return;
  let el = document.getElementById(id) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = id;
    document.head.appendChild(el);
  }
  el.textContent = buildJkOSTheme(config);
}
