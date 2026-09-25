// http.ts — the one fetch helper behind KourOS's typed API modules (api.ts, books/api.ts,
// player/api.ts). Each carried its own identical copy until 2026-09-25.
import { authFetch } from '@jkos/auth-client';

/** The backend's origin: empty (same-origin) except in a dev build pointed elsewhere. */
export const API: string = (import.meta as any).env?.VITE_API_URL ?? '';

export const JSON_HEADERS = { 'Content-Type': 'application/json' };

/** authFetch `path` and parse its JSON (undefined for a 204). A non-2xx throws an Error whose
 *  `.status` rides along, message unchanged, so the offline write queue can tell a server
 *  VERDICT (4xx → drop the queued write) from a transport failure (fetch throws TypeError →
 *  keep it queued). See books/offline/writes.ts. */
export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await authFetch(`${API}${path}`, init);
  if (!r.ok) {
    const err = new Error(`${init?.method ?? 'GET'} ${path} failed: ${r.status}`) as Error & { status: number };
    err.status = r.status;
    throw err;
  }
  if (r.status === 204) return undefined as T;
  return r.json() as Promise<T>;
}
