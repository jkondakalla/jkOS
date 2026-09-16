// Types for @jkos/suite-manifest/scopes — mirrors scopes.js. jkAuth-side only.
import type { AppId } from './apps';
/** The scopes each app's capability doc declares — GENERATED (scripts/gen-scopes.mjs). */
export declare const DECLARED_SCOPES: Readonly<Partial<Record<AppId, readonly string[]>>>;
/** The verbs a declared `<app>:write` makes grantable on their own. */
export declare const WRITE_LADDER: readonly ['create', 'update', 'delete'];
/** Suite-level scopes that belong to no one app. */
export declare const SUITE_SCOPES: readonly ['suite:admin'];
/** What jkAuth may grant for one app: `<id>:read`, its declared scopes, and the write
 *  ladder beneath a declared `<id>:write`. Nothing else. */
export declare function grantableScopes(id: string): string[];
/** True iff some token could legitimately carry this scope. */
export declare function isGrantableScope(scope: string): boolean;
