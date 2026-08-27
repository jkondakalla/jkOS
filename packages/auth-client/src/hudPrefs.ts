/**
 * hudPrefs.ts — the lazy per-user migration of ORDECK's preference keys (XC-5).
 *
 * ⚠️ Extracted into its own module for one reason: it is a DATA MIGRATION over live
 * user data, and every way it goes wrong is silent. Read the wrong key and someone's
 * dashboard layout is gone with no error. Write the wrong shape and it is gone on the
 * next save. So it is pure — no React, no fetch, no imports but a type — and
 * `pnpm test:cards` drives it directly.
 */
import type { UserPreferences } from './types';

/* ── XC-5: the lazy per-user migration of ORDECK's prefs ──────────────────────
 *
 * `hud`, `hudPins` and `hudFocus` sat at the TOP LEVEL of the shared preferences
 * blob, where an app-owned key does not belong — the convention (see types.ts) is
 * app-owned settings under a key equal to the app id, which `lazuros` already did.
 *
 * ⚠️ THEY ARE LIVE USER DATA, so this is a read-fallback plus a lazy re-write, NOT a
 * rename. A rename is silent data loss for every user who does not happen to save
 * their dashboard afterwards, and there is no server-side migration that could run
 * instead: jkAuth stores the blob opaquely and does not know what a `hud` is.
 *
 * READ prefers the namespaced key and falls back to the legacy one. WRITE sets the
 * namespaced key AND nulls the legacy one in the same patch — so a blob converts
 * itself the first time the user touches their dashboard, and converts exactly once.
 *
 * The server deep-merges (jkAuth's PATCH /auth/profile), so nulling a top-level key
 * while writing a nested one is a single atomic patch, not two round trips. */
export function readHudPref<K extends 'hud' | 'hudPins' | 'hudFocus'>(
  prefs: UserPreferences | undefined,
  key: K,
): UserPreferences[K] | undefined {
  const owned = prefs?.ordeck?.[key];
  if (owned !== undefined && owned !== null) return owned as UserPreferences[K];
  /* ⚠️ `null` on the namespaced key is NOT "absent" — for `hudFocus` it is a real
     value meaning "nothing is focused". Only `undefined` falls through, or an
     already-migrated blob would keep resurrecting the legacy focus. */
  if (owned === null && key === 'hudFocus') return null as UserPreferences[K];
  return prefs?.[key] as UserPreferences[K] | undefined;
}

/** The patch that writes the namespaced key and retires the legacy one together. */
export function writeHudPref(key: 'hud' | 'hudPins' | 'hudFocus', value: unknown): Partial<UserPreferences> {
  return { ordeck: { [key]: value } as UserPreferences['ordeck'], [key]: null } as Partial<UserPreferences>;
}
