// packages/player/src/engine/volume.ts — pure volume/mute helpers (git history, Wave 16,
// item 16.2). Mirrors rate.ts's shape exactly: the read/persist halves are
// self-contained (StorageLike-injected, no DOM/React — same "extract what's pure, test
// it in isolation" house pattern as test/core.test.mjs), and the "apply" halves factor
// out the one-line backend-forwarding that cycleRate does INLINE in
// usePlayerEngine.ts — pulled out here (unlike cycleRate) so test/engine.test.mjs can
// drive them against a scripted fake backend, the same house pattern
// test/backend.test.mjs uses for htmlMedia.ts.
//
// Persistence is OPTIONAL (rate's storageKey is required; volume's is not — see
// PlayerEngineConfig.volumeStorageKey). A missing key means "session-only": the engine
// still tracks volume/muted in memory and applies them to the backend, it just never
// touches localStorage. Volume and muted persist under TWO plain string keys derived
// from the one configured key (the key itself for volume, `${key}.muted` for muted)
// rather than one JSON blob, so a corrupt/missing value for one never invalidates the
// other — the same "plain string per key" simplicity as rate.ts.
import type { MediaBackend } from '../backend/types';
import type { StorageLike } from './rate';

/** The minimal backend surface volume/mute control needs. Any MediaBackend (htmlMedia
 *  ts's real one, or a scripted test double) satisfies this. */
type VolumeBackend = Pick<MediaBackend, 'setVolume' | 'setMuted'>;

export const DEFAULT_VOLUME = 1;
export const DEFAULT_MUTED = false;

/** Clamp to the valid HTMLMediaElement.volume range; a non-finite input (NaN from a
 *  corrupt localStorage value, or a bad caller input) falls back to full volume. */
export function clampVolume(level: number): number {
  if (!Number.isFinite(level)) return DEFAULT_VOLUME;
  return Math.min(1, Math.max(0, level));
}

function mutedKeyOf(key: string): string {
  return `${key}.muted`;
}

/** Read the persisted volume, defaulting to 1 for a missing/invalid value or a
 *  throwing store (private mode) — same guard shape as readPersistedRate. */
export function readPersistedVolume(key: string, store?: StorageLike): number {
  try {
    const raw = (store ?? localStorage).getItem(key);
    if (raw == null) return DEFAULT_VOLUME;
    const v = Number(raw);
    return Number.isFinite(v) ? clampVolume(v) : DEFAULT_VOLUME;
  } catch {
    return DEFAULT_VOLUME;
  }
}

/** Persist the (clamped) volume; a throwing store is swallowed, exactly as
 *  persistRate's try/catch around localStorage.setItem. */
export function persistVolume(key: string, level: number, store?: StorageLike): void {
  try {
    (store ?? localStorage).setItem(key, String(clampVolume(level)));
  } catch {
    /* private mode — non-fatal */
  }
}

/** Read the persisted mute flag, defaulting to false (unmuted) for a missing value or
 *  a throwing store. */
export function readPersistedMuted(key: string, store?: StorageLike): boolean {
  try {
    return (store ?? localStorage).getItem(mutedKeyOf(key)) === '1';
  } catch {
    return DEFAULT_MUTED;
  }
}

/** Persist the mute flag; a throwing store is swallowed. */
export function persistMuted(key: string, muted: boolean, store?: StorageLike): void {
  try {
    (store ?? localStorage).setItem(mutedKeyOf(key), muted ? '1' : '0');
  } catch {
    /* private mode — non-fatal */
  }
}

/** The initial volume for a fresh mount: session-only (no configured key) always
 *  starts at DEFAULT_VOLUME; a configured key restores whatever was persisted. */
export function readInitialVolume(key: string | undefined, store?: StorageLike): number {
  return key == null ? DEFAULT_VOLUME : readPersistedVolume(key, store);
}

/** The initial muted flag for a fresh mount — same session-only-vs-restored split. */
export function readInitialMuted(key: string | undefined, store?: StorageLike): boolean {
  return key == null ? DEFAULT_MUTED : readPersistedMuted(key, store);
}

/** setVolume's whole mechanism: clamp, push to the backend (if one is mounted — mirrors
 *  `backendRef.current?.setRate(...)`'s optional-call shape), and persist ONLY when a
 *  key is configured. Returns the clamped value so the caller's setState mirror stays
 *  in sync with what the backend actually received. */
export function applyVolume(
  backend: VolumeBackend | null | undefined,
  level: number,
  key: string | undefined,
  store?: StorageLike,
): number {
  const clamped = clampVolume(level);
  backend?.setVolume(clamped);
  if (key != null) persistVolume(key, clamped, store);
  return clamped;
}

/** setMuted's whole mechanism — same optional-backend/optional-persist shape as
 *  applyVolume. toggleMute is the caller negating its own mutedRef and calling this. */
export function applyMuted(
  backend: VolumeBackend | null | undefined,
  muted: boolean,
  key: string | undefined,
  store?: StorageLike,
): void {
  backend?.setMuted(muted);
  if (key != null) persistMuted(key, muted, store);
}
