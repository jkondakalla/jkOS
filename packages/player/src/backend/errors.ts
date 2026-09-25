// packages/player/src/backend/errors.ts — how a media failure becomes a BackendError, for
// every MediaBackend. htmlMedia.ts and gaplessDual.ts each carried their own copy until
// 2026-09-25 (gaplessDual's so it could stay import-free for its transpile-one-file test;
// the tests now emit this module beside theirs), which left two places for the recovery
// vocabulary to drift apart.
import type { BackendError, BackendErrorKind } from './types';

/** MediaError.code (1 aborted · 2 network · 3 decode · 4 src-not-supported) — the mapping
 *  usePlayerEngine.ts's onError used inline, centralized so it feeds BOTH error channels
 *  (see classifyPlayRejection below). */
export function classifyMediaErrorCode(code: number): BackendErrorKind {
  switch (code) {
    case 1: return 'aborted';
    case 2: return 'network';
    case 3: return 'decode';
    case 4: return 'src-unsupported';
    default: return 'unknown';
  }
}

/** A rejected play() promise's DOMException.name — the three names usePlayerEngine.ts's
 *  playFailed() branched on (AbortError / NotAllowedError / NotSupportedError), mapped onto
 *  the SAME BackendErrorKind vocabulary the DOM 'error' event uses so the engine's recovery
 *  policy has one vocabulary, not two. */
export function classifyPlayRejection(err: unknown): BackendErrorKind {
  const name = err && typeof err === 'object' && 'name' in err
    ? (err as { name?: unknown }).name
    : undefined;
  if (name === 'AbortError') return 'aborted';
  if (name === 'NotAllowedError') return 'autoplay-blocked';
  if (name === 'NotSupportedError') return 'src-unsupported';
  return 'unknown';
}

function messageOf(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err && typeof (err as { message?: unknown }).message === 'string') {
    return (err as { message: string }).message;
  }
  return String(err);
}

export function toBackendError(kind: BackendErrorKind, err: unknown): BackendError {
  return { kind, code: null, message: messageOf(err) };
}
