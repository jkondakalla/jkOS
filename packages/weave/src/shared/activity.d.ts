// Types for the activity contract (activity.js) — the ONE declared shape of "what
// the user did" (XC-2 / D6). Consumed by the TS frontend (fetchActivity) and,
// untyped, by the CJS backends (server/activity.js).
//
// ⚠️ These are the authoritative interfaces for this contract — unlike docShape,
// whose doc types live in ../capability.ts and ../dataset.ts. The shape is small
// enough that a second file to hold four interfaces would be the drift risk rather
// than the defence against it.

/** Where an app serves its activity, relative to its apiBase. */
export const ACTIVITY_PATH: '/activity';
export const ACTIVITY_MAX_LIMIT: number;
export const ACTIVITY_DEFAULT_LIMIT: number;

/** One verb in an app's own closed vocabulary. Per-app, never suite-wide:
 *  "listened" and "trained" are different acts. */
export interface ActivityKind {
  /** lowercase snake_case, unique within the app */
  id: string;
  label: string;
  /** optional past-tense phrasing for a sentence, e.g. "listened to" */
  verb?: string;
}

/** One thing the user did. See activity.js for why each field earned its place. */
export interface ActivityEvent {
  /** stable and unique within the app; `<table>:<rowid>` by convention */
  id: string;
  /** must be one of the doc's declared kind ids */
  kind: string;
  /** canonical millisecond ISO (XC-1) — the cross-app merge key */
  at: string;
  /** ext_ref of the subject ("<app>:<localId>"), or null */
  ref?: string | null;
  /** human label for `ref` */
  label?: string | null;
  /** time ACTUALLY spent, excluding pauses — not wall-clock duration */
  ms?: number | null;
  /** tri-state: null means this kind has no notion of finishing */
  completed?: boolean | null;
}

/** An app's answer about itself. Same envelope as CapabilityDoc / DatasetDoc. */
export interface ActivityDoc {
  app: string;
  version: number;
  kinds: ActivityKind[];
  activity: ActivityEvent[];
}

/** An event in the merged cross-app feed: the app it came from, and its kind
 *  resolved to that app's label, both added by mergeActivity. */
export interface MergedActivityEvent extends ActivityEvent {
  app: string;
  kindLabel: string;
}

export function checkActivityEvent(e: unknown, kindIds?: Set<string>): string | null;
export function checkActivityDoc(doc: unknown): string | null;
export function isValidActivityDoc(doc: unknown): boolean;
export function mergeActivity(
  docs: Array<ActivityDoc | null>,
  opts?: { limit?: number },
): MergedActivityEvent[];
