// packages/player/src/engine/recovery.ts — the PURE compat-recovery ladder decisions
// (ToDo.md §3 Wave 15, item 15.3). The stateful loop (prepare/poll, reqSeq + reentrancy
// guards, seek-restore) stays in usePlayerEngine.ts; the arithmetic of "which rung, is
// this error recoverable, have we exhausted the ladder" is factored out here so it can
// be unit-tested in isolation (test/engine.test.mjs), the house pattern.
//
// No DOM, no React, no imports beyond a structural error-kind string.

/** The backend error kinds that, by default, arm the compat ladder — a decode failure
 *  or an unsupported source is exactly what a server-side remux/re-encode can fix.
 *  (usePlayerEngine.ts's onError triggered recovery on MediaError code 3/4.) */
export const DEFAULT_RECOVERABLE_KINDS = ['decode', 'src-unsupported'] as const;

/** Session cache key for a (item, source)'s active compat rung — matches the
 *  `${bookId}:${fileIndex}` shape usePlayerEngine.ts used (client-side only). */
export function compatKey(itemId: string | number, sourceIndex: number): string {
  return `${itemId}:${sourceIndex}`;
}

/** Does this error kind arm the ladder? */
export function isRecoverableKind(kind: string, recoverable: readonly string[]): boolean {
  return recoverable.includes(kind);
}

/** Is there a rung left to escalate to? (original: `level >= 2` → give up.) */
export function canEscalate(level: number, maxLevel: number): boolean {
  return level < maxLevel;
}

/** The next rung up. */
export function nextCompatLevel(level: number): number {
  return level + 1;
}

/** The rung a load should actually open at: the higher of the session-bumped rung (a
 *  failure THIS session) and the source's initial rung (a pre-generated variant). The
 *  session bump must win, exactly as usePlayerEngine.ts's
 *  `Math.max(compatLevelRef.get(key) ?? 0, readyLevel)`. */
export function effectiveStartLevel(sessionLevel: number, initialLevel: number): number {
  return Math.max(sessionLevel, initialLevel);
}
