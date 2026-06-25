/**
 * weave/extref.ts — the cross-app addressing convention.
 *
 * An ext_ref is "<app>:<localId>" — one opaque string, owned by the writing app,
 * that says "this thing lives in app X with id Y." The SAME shape useHudShelf's
 * key() already uses for HUD pins/focus. One convention serves three needs:
 *   • HUD pins/focus references (a HudRef's identity)
 *   • cross-app item ownership (e.g. a BeigeBoard item's `ext_ref` column marking
 *     it as created by a SylibOS lesson)
 *   • capability targets
 *
 * No central join table, no referential integrity — deliberately. The writing
 * app owns the string; readers split it to know which app to deeplink/query.
 */

/** Build "<app>:<id>". */
export const extRef = (app: string, id: string | number): string => `${app}:${id}`;

/** Split on the FIRST ':' so ids may themselves contain colons. */
export function parseExtRef(ref: string): { app: string; id: string } {
  const i = ref.indexOf(':');
  return i < 0 ? { app: '', id: ref } : { app: ref.slice(0, i), id: ref.slice(i + 1) };
}
