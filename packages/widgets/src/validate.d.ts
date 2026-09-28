/** One problem with a widget def. `path` is a JSON Pointer into the def. */
export interface WidgetProblem {
  path: string;
  code: string;
  message: string;
  /** A suggestion: the likely intended key/value, or the legal set. */
  fix?: string;
}

/** Validate a widget def (structural + security). [] means valid. */
export function validateWidget(def: unknown): WidgetProblem[];
