// Types for the suite's one pagination contract (paging.js). The `since` cursor is
// the only primitive — there is no `offset`, because an offset is unstable under
// concurrent writes and this suite has a cursor precisely because that mattered once.

/** What a caller gets when they ask for no limit. */
export const PAGE_DEFAULT: number;
/** The most any single read will return, whatever a caller asks for. */
export const PAGE_MAX: number;
/** The one cursor parameter name. */
export const CURSOR_PARAM: 'since';

export function pageLimit(
  v: unknown,
  opts?: { fallback?: number; max?: number },
): number;
