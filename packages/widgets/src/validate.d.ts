/** One problem with a widget def. `path` is a JSON Pointer into the def. */
export interface WidgetProblem {
  path: string;
  code: string;
  message: string;
  /** A suggestion: the likely intended key/value, or the legal set. */
  fix?: string;
}

/** Validate a widget def (structural + security). [] means valid.
 *  `ctx.suiteHosts`: the suite's hostnames — a `fetch` source to one (or a subdomain) is
 *  refused; suite data is read through a DECLARED dataset. jkAuth passes them.
 *  `ctx.published`: the def is published through jkAuth — it binds only its own sources
 *  (declared server contracts), never a host's slice, and it must carry `sizing`. */
export function validateWidget(def: unknown, ctx?: { suiteHosts?: string[]; published?: boolean }): WidgetProblem[];

/** The names the renderer puts in every widget's scope ($, $now, $sources, $form…). */
export const RUNTIME_NAMES: readonly string[];
