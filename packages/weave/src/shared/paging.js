// paging.js — the suite's ONE pagination contract (RESET A2c.2 / Stage E item 6).
//
// ⭐ THE CURSOR, NOT AN OFFSET. `?since=<canonical ms ISO>` is the only pagination
// primitive. There is deliberately no `offset`, and that is a correctness decision
// rather than a stylistic one: an offset is unstable under concurrent writes — insert
// a row while a caller is paging and they skip one or see one twice, with no error —
// and this suite has a cursor precisely because that mattered once.
//
// ⚠️ ONE DEFAULT AND ONE MAXIMUM, replacing three hand-rolled clamps that disagreed:
// `clampLimit(limit, 120, 600)` and `clampLimit(limit, 300, 2000)` inside a single
// KourOS file, and jkAuth's `Math.min(limit || 50, 200)`. Three conventions is not a
// style problem — it is what makes a cross-app fan-out unmergeable, because "give me
// 100" means three different windows and a merged page is silently short.
//
// An app may still narrow the maximum where its rows are genuinely expensive; it may
// not widen it, and it may not invent a different default.

/** What a caller gets when they ask for no limit. */
export const PAGE_DEFAULT = 100

/** The most any single read will return, whatever a caller asks for. */
export const PAGE_MAX = 500

/** The one cursor parameter. Compared as a STRING against a canonical millisecond-ISO
 *  column (XC-1) — which is why that format is validated rather than merely parsed. */
export const CURSOR_PARAM = 'since'

/**
 * Clamp a caller-supplied limit into the contract.
 *
 * @param {*} v the raw query value — a string, absent, or nonsense
 * @param {{ fallback?: number, max?: number }} [opts] an app may NARROW `max` where
 *   its rows are genuinely expensive; it may not widen it.
 */
export function pageLimit(v, { fallback = PAGE_DEFAULT, max = PAGE_MAX } = {}) {
  const cap = Math.min(max, PAGE_MAX)
  const n = parseInt(v, 10)
  if (!Number.isFinite(n) || n <= 0) return Math.min(fallback, cap)
  return Math.min(n, cap)
}
