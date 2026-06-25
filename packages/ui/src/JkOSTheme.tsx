import { buildJkOSTheme, type JkOSThemeConfig } from '@jkos/design';

/* ─────────────────────────────────────────────────────────────────────────────
   @jkos/ui — <JkOSTheme>

   Injects a per-app theme (default accent pair + neutrals + radius + fonts) built
   by @jkos/design's buildJkOSTheme(). Render once near the app root, after the
   token CSS is imported, so its <style> wins the cascade over the hub.css defaults:

     import '@jkos/ui/tokens.css';
     <JkOSTheme config={{ light: {...}, dark: {...}, radius: {...}, fonts: {...} }} />

   Only the INPUT tokens are emitted; the universal accent chain + derivations live
   in hub.css and recompute from them. The user's saved pair still overrides the
   default accent at runtime via applyJkOSTheme().
   ───────────────────────────────────────────────────────────────────────────── */

export function JkOSTheme({ config }: { config: JkOSThemeConfig }) {
  return <style data-jkos-theme>{buildJkOSTheme(config)}</style>;
}
