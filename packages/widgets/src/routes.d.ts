// Types for routes.js — a page widget's route, matched and built one way.

/** Why `route` is not a route pattern ("/books/:id"), or null when it is. */
export function routeProblem(route: unknown): string | null;
/** The `:params` a route pattern names, in order. */
export function routeParams(route: unknown): string[];
/** A location path's params under a route pattern (decoded), or null when it does not match. */
export function matchRoute(route: string, path: string): Record<string, string> | null;
/** A path from a route pattern and its params (encoded), or null when one is missing. */
export function fillRoute(route: string, params?: Record<string, unknown>): string | null;
/** One app's pages: route → page id, and every conflict between them. */
export function routeTable(defs: { id: string; route?: string }[]): { routes: Map<string, string>; problems: string[] };
/** The page a location shows (the most literal matching route), or null. */
export function pageFor(routes: Map<string, string>, path: string): { route: string; id: string; params: Record<string, string> } | null;
