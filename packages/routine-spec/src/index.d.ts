// Types for @jkos/routine-spec.
//
// ⚠️ LIFTED VERBATIM from the TypeScript mirror this package replaced (BB-8 / D9).
// Those interfaces were never the duplication — they were the only written-down
// description of the document's shape, and the 1,045 lines of re-implemented ENGINE
// underneath them were. So the shapes stay, exactly as they were, and the engine
// below them is now the one in index.js rather than a hand-kept second copy.
//
// The runtime is CommonJS (index.js) with an ESM twin (index.mjs); this types both.
// `check:routine` asserts the two faces expose the same names, and every function
// declared here is driven for real by that gate — a signature that drifts from the
// implementation fails at its call sites in `tsc -b`, not silently.

export interface Progression {
  type: string
  drives?: string
  increment?: number
  every?: number
  cap?: number | null
  floor?: number | null
  range?: [number, number]
  values?: number[]
  repeat?: string
  of?: string
  start?: number
}
export interface Contributes {
  measure: string; step: string | null; target: number; window: string; label: string | null
}
export interface Metric {
  measure: string; step: string | null; unit: string; label: string | null
  target: number; value: number; pct: number; window: string; from: string
}
export interface Cadence {
  type: string
  n?: number; day?: number | string
  rrule?: string; freq?: string; interval?: number
  byday?: number[]; bymonthday?: number[]; count?: number | null; until?: string | null
  rrule_error?: string
}
export interface SeriesPoint {
  cycle: number; date: string | null; completed: boolean; deload: boolean
  prescribed: number | null; performed: number | null; met: boolean | null
}
export interface Step {
  key: string
  ref: string | null
  collection: string | null
  title: string
  block: string
  group: string | null
  unit: string
  sets: number
  target: number | null
  load: number | null
  load_unit: string | null
  rest: number | null
  variants: string[]
  variant_index: number
  variant_every: number
  promote_on_cap: boolean
  progression: Progression[]
  notes: string | null
}
export interface Phase {
  name: string; cycles: number; intensity: number; sets_delta: number; notes: string | null
}
export interface Spec {
  v: number
  intent: string | null
  advance_on: string
  deload_every: number
  deload_factor: number
  round_load: number
  vars: Record<string, number>
  phases: Phase[]
  phase_repeat: string
  contributes: Contributes | null
  steps: Step[]
}
export interface RenderedStep {
  key: string; title: string; base_title: string; block: string; group: string | null
  variant: string | null; variant_index: number | null
  sets: number | null; target: number | null; unit: string
  load: number | null; load_unit: string | null; rest: number | null
  notes: string | null; line: string
}
export interface Prescription {
  v: number; cycle: number; phase: string | null; phase_cycle: number
  deload: boolean; deload_forced: boolean; sv: number | null
  steps: RenderedStep[]; line: string
}
export type Resolve = (slug: string, collection: string | null) => any


/* ── The vocabularies ─────────────────────────────────────────────────────── */
export const SPEC_VERSION: number;
export const UNITS: string[];
export const LOAD_UNITS: string[];
export const PROGRESSIONS: string[];
export const DRIVES: string[];
export const ADVANCE_ON: string[];
export const PHASE_REPEAT: string[];
export const BLOCKS: string[];
export const COLLECTIONS: string[];
export const CADENCES: string[];
export const MEASURES: string[];
export const WINDOWS: string[];
export const MAX_RULES: number;
export const LIMITS: Record<string, number>;

/** Human labels, next to the vocabularies they label. */
export const CADENCE_LABEL: Record<string, string>;
export const MEASURE_LABEL: Record<string, string>;
export const PROGRESSION_LABEL: Record<string, string>;

/* ── Normalise ────────────────────────────────────────────────────────────── */
export function emptySpec(): Spec;

/**
 * ⚠️ RETURNS `{ spec, warnings }`, NOT a bare `Spec`.
 *
 * This is where the two copies had genuinely DIVERGED (BB-8 / D9): the backend
 * returned the pair, the TypeScript mirror returned the spec alone. The conformance
 * gate never caught it because it compared OUTPUT — its own harness wrote
 * `be.normalizeSpec(doc).spec` next to `fe.normalizeSpec(doc)` and normalised the
 * difference away in the very line that was supposed to prove there wasn't one.
 * The backend's shape is authoritative and is what survived; the forge's call sites
 * destructure now. `warnings` is the lint tier — the answer to a valid-but-useless
 * routine, which nothing else in the system would ever give.
 */
export function normalizeSpec(
  raw: unknown,
  opts?: { resolve?: Resolve },
): { spec: Spec; warnings: any[] };

/** The server's answer, and deliberately the only one — a second opinion computed
 *  in the browser could disagree with the one that actually decides. */
export function validateSpec(
  raw: unknown,
  opts?: { resolve?: Resolve },
): { ok: boolean; errors: any[]; warnings: any[] };

/* ── Render ───────────────────────────────────────────────────────────────── */
export function phaseAt(
  spec: Spec,
  cycle: number,
): { name: string | null; index: number; cycle: number; intensity: number; sets_delta: number };
export function isDeload(spec: Spec, cycle: number): boolean;
export function progressionAt(step: Step, cycle: number, earned?: any): any;
export function applyProgressions(step: Step, cycle: number, earned?: any): any;
export function promoteAtCap(
  base: number, inc: number, cap: number | null | undefined, tier: number,
): { tier: number; shift: number };
export function renderStep(spec: Spec, step: Step, cycle: number, ctx?: any): RenderedStep;
export function renderCycle(spec: Spec, cycle: number, ctx?: any): Prescription;

/* ── Cadence ──────────────────────────────────────────────────────────────── */
export function parseCadence(rule: unknown): Cadence;
export function formatCadence(c: Cadence | null): string;
export function expandCadence(
  cadence: Cadence | null,
  opts: { from: string; to: string; anchor?: string; days?: number[]; floats?: number },
): Array<{ date: string | null; week: string; float?: boolean; index?: number }>;
export function describeCadence(cadence: Cadence | null, days?: number[]): string;

/* ── Metric + series ──────────────────────────────────────────────────────── */
export function metricOf(spec: Spec, occurrences: any[], today: string): Metric | null;
export function seriesFor(
  spec: Spec, occurrences: any[], stepKey: string, measure?: string,
): SeriesPoint[];
export function amountOf(rendered: any, logged: any, measure: string): number;
export function windowStart(windowName: string, date: string): string;

/* ── Prose ────────────────────────────────────────────────────────────────── */
export function stepLine(r: Partial<RenderedStep>): string;
export function sessionLine(p: Pick<Prescription, 'phase' | 'cycle' | 'deload' | 'steps'>): string;
export function summarize(spec: Spec | null): string | null;

/* ── Reading what the engine wrote, and logging what happened ─────────────── */
export function prescriptionOf(occurrence: any): Prescription | null;
export function performedOf(occurrence: any): any;
export function stepStatus(
  performed: any, key: string,
): { done?: boolean; met?: boolean; note?: string; at?: string; seq?: number; sets?: any[] };
/** ⚠️ `now` is an argument so this package keeps its no-clock purity — see index.js. */
export function logStep(
  performed: any,
  key: string,
  patch: { done?: boolean; met?: boolean; note?: string; sets?: any[] },
  now?: string,
): any;
export function normalizePerformed(raw: unknown): any;
export function stepWasMet(performed: any, stepKey: string): boolean;
export function metFromSets(rendered: any, sets: any[]): boolean | null;
export function blankSets(rendered: any): Array<{ value: number | null; load: number | null }>;

/* ── Small pure helpers ───────────────────────────────────────────────────── */
export function slugify(v: unknown, fallback?: string): string;
export function humanize(slug: unknown): string;
export function roundTo(n: number, to: number): number;
export function isoWeekStart(s: string): string;
export function shiftDays(s: string, n: number): string;
export function daysBetween(a: string, b: string): number;
