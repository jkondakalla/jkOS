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
 *  refused; suite data is read through a DECLARED dataset. jkAuth passes them. */
export function validateWidget(def: unknown, ctx?: { suiteHosts?: string[] }): WidgetProblem[];
