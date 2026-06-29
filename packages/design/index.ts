// @jkos/design — suite-wide design system barrel (framework-free).
// Tokens:   import '@jkos/design/tokens.css'
// Appliers: import { applyJkOSMode, applyJkOSTheme } from '@jkos/design'
// Factory:  import { buildJkOSTheme, injectJkOSTheme } from '@jkos/design'
// React components (<JkOSTheme>, <Bubble>, <Press>, <Sheet>) live in @jkos/ui.
// Accent palette: import { ACCENT_SCHEMES, matchAccentScheme } from '@jkos/design'
// Breakpoints: import { BREAKPOINTS, activeBreakpoint } from '@jkos/design'
export * from './utils/applyJkOSTheme';
export * from './theme/buildTheme';
export * from './theme/accentSchemes';
export * from './responsive/breakpoints';
