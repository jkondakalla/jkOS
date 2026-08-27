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

/* ⚠️ The implementation moved to ./shared/extref.js so the CJS BACKENDS can use it
 * too — the activity contract (D6) builds refs server-side, and a TypeScript module
 * is unreachable from a no-bundler Node app. Re-exported here so every existing
 * `from '@jkos/weave'` import is unchanged, and so there is still exactly one
 * definition rather than a frontend copy and a backend copy. */
export { extRef, parseExtRef, refScheme, EXT_REF_CLASSES, RESERVED_SCHEMES, checkExtRefDoc, extRefFieldDoc } from './shared/extref.js';
export type { ExtRefScheme, ExtRefDoc } from './shared/extref.js';
