import type { ComponentType, ReactNode } from 'react';
import { useState } from 'react';
import { Lab, cx } from './primitives';
import { SettingsDrawer } from './SettingsDrawer';
import type { SettingsDrawerProps } from './SettingsDrawer';

/* ─────────────────────────────────────────────────────────────────────────────
   @jkos/ui — <AppShell> (ToDo.md §3 Wave 20, item 20.1)

   The invariant frame every full-shell app hand-wrote four times: an auth guard,
   an identity + settings-trigger header row, the shared SettingsDrawer, and the
   useJkOSPreferences wiring that feeds it. PapyrOS shipped with no settings
   drawer because its copy was a hand-copy that dropped a step — a shell
   primitive makes that omission structurally impossible.

   SLOTTED, not prescriptive: an app keeps its own router/views/nav — those are
   just `children`, rendered between the header and the drawer, exactly where
   the app used to put its `<main>`. Same house idiom as <PlayerBar
   meta/transport/actions>: the shell owns the frame, callers own the content.

   Two pieces are INJECTED rather than imported, so @jkos/ui stays decoupled
   from @jkos/auth-client (the same structural-typing contract SettingsDrawer
   already uses for its `theme`/`effects`/`user` props):
     - `guard`          — the app's own AuthGuard component (ORDECK/PapyrOS-style:
                           renders a veil while loading, redirects/login when
                           signed out, `children` once authenticated).
     - `usePreferences` — the app's `useJkOSPreferences` import. AppShell calls it
                           INSIDE the guard's children, so (matching every
                           existing hand-copy) it only mounts once auth has
                           resolved a session — no /auth/profile round-trip
                           before the guard even knows there's a session.

   `useUser` is injected the same way, rather than accepted as a plain `user`
   prop, for a subtler reason: every hand-copy reads the auth guard's OWN
   resolved identity (not the preferences hook's `user`) for the drawer's
   Account row, because it paints on first render, ahead of the preferences
   hook's /auth/profile round-trip — and that identity lives in a context
   (e.g. papyros's `authContext`) that only exists BELOW `guard` in the tree.
   A plain `user` prop would have to be computed by the caller of <AppShell>,
   which sits ABOVE `guard` and so can't read that context; a selector hook
   called from inside AppShellBody (already a descendant of `guard`) can.
   ───────────────────────────────────────────────────────────────────────────── */

/** Structural mirror of @jkos/auth-client's UseJkOSPreferencesOptions — declared
 *  here (not imported) to keep this package decoupled from auth-client. */
export interface AppShellPreferencesOptions {
  onApply?: (ctx: {
    theme: SettingsDrawerProps['theme'];
    effects: SettingsDrawerProps['effects'];
    isDark: boolean;
  }) => void;
}

/** Structural mirror of @jkos/auth-client's useJkOSPreferences() return value —
 *  only the slice AppShell/SettingsDrawer actually consume. */
export interface AppShellPreferences {
  theme:        SettingsDrawerProps['theme'];
  effects:      SettingsDrawerProps['effects'];
  saving:       boolean;
  patchTheme:   SettingsDrawerProps['patchTheme'];
  patchEffects: SettingsDrawerProps['patchEffects'];
}

export interface AppShellProps {
  /** The app's own AuthGuard component (e.g. `./components/AuthGuard`). Wraps
   *  the whole shell; gates rendering on auth and supplies whatever auth
   *  context the app's own views read via their own `useAuth()`. */
  guard: ComponentType<{ children: ReactNode }>;
  /** The app's `useJkOSPreferences` import from `@jkos/auth-client`, injected so
   *  this package never imports auth-client directly. */
  usePreferences: (opts?: AppShellPreferencesOptions) => AppShellPreferences;
  /** Passed straight through to `usePreferences`. */
  preferencesOptions?: AppShellPreferencesOptions;
  /** Selector hook returning the resolved identity for the header + SettingsDrawer
   *  Account row — e.g. `() => { const { state } = useAuth(); return state.status
   *  === 'authenticated' ? state.user : null }`. Called from inside AppShellBody
   *  (a descendant of `guard`), so it can read whatever auth context `guard`
   *  provides. Return the guard's own user, not the preferences hook's — it
   *  paints on first render, ahead of the /auth/profile round-trip. */
  useUser: () => SettingsDrawerProps['user'];
  /** jkAuth origin, passed straight through to SettingsDrawer. */
  authUrl: string;
  /** App wordmark / brand content, e.g. "PapyrOS". */
  brand: ReactNode;
  /** href for the brand link. Defaults to '#/' (the hash-router home route). */
  brandHref?: string;
  /** Optional eyebrow next to the brand, e.g. "Audiobook library". Rendered in a
   *  <Lab size="sm">, the suite's identity-chip idiom. */
  tagline?: ReactNode;
  /** App-specific SettingsDrawer section (e.g. offline settings, weather),
   *  rendered just before Account — SettingsDrawer's `extra` slot. */
  settingsExtra?: ReactNode;
  /** SettingsDrawer width override (px). */
  drawerWidth?: number;
  /** Extra class(es) on the outer shell wrapper. */
  className?: string;
  /** The app's own routed content — rendered between the header and the drawer
   *  (where the app used to render its `<main>`, player bars, modals, ...). */
  children: ReactNode;
}

export function AppShell({ guard: Guard, ...rest }: AppShellProps) {
  return (
    <Guard>
      <AppShellBody {...rest} />
    </Guard>
  );
}

function AppShellBody({
  usePreferences,
  preferencesOptions,
  useUser,
  authUrl,
  brand,
  brandHref = '#/',
  tagline,
  settingsExtra,
  drawerWidth,
  className,
  children,
}: Omit<AppShellProps, 'guard'>) {
  const prefs = usePreferences(preferencesOptions);
  const user = useUser();
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <div className={cx('jk-shell', className)}>
      <header className="jk-shell-header">
        <div className="jk-shell-brand">
          <a href={brandHref} className={cx('jk-press-lg', 'jk-shell-wordmark')}>{brand}</a>
          {tagline != null && <Lab size="sm">{tagline}</Lab>}
        </div>
        <button
          type="button"
          className="jk-shell-settings-btn"
          aria-label="Settings"
          aria-expanded={settingsOpen}
          title="Settings"
          onClick={() => setSettingsOpen(true)}
        >
          <GearIcon />
        </button>
      </header>

      {children}

      <SettingsDrawer
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        theme={prefs.theme}
        effects={prefs.effects}
        saving={prefs.saving}
        patchTheme={prefs.patchTheme}
        patchEffects={prefs.patchEffects}
        user={user}
        authUrl={authUrl}
        extra={settingsExtra}
        width={drawerWidth}
      />
    </div>
  );
}

/** currentColor gear — the button's `color` drives it (same idiom as PlayerBar's
 *  glyphs). Lifted verbatim from PapyrOS's IconGear, the shell's proving consumer. */
function GearIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M12 2.8v2.1M12 19.1v2.1M4.5 4.5L6 6M18 18l1.5 1.5M2.8 12h2.1M19.1 12h2.1M4.5 19.5L6 18M18 6l1.5-1.5"
        fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"
      />
    </svg>
  );
}
