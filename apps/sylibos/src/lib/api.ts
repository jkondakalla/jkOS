import type { Course, Segment, DailyLog, AppSettings } from '../types'
import { redirectToLogin } from '../api/auth'

const AUTH_URL = (import.meta.env.VITE_JKOS_AUTH_URL as string | undefined) ?? 'https://auth.jkos.net'
// Strip trailing slash from Vite base so we can prepend it to /api/... paths.
// In prod (base = '/') this becomes '' so paths are unchanged.
// In staging (base = '/sylib/') this becomes '/sylib' so /api/x → /sylib/api/x,
// which nginx routes to the staging-sylibos-api container.
const API_BASE = (import.meta.env.BASE_URL as string).replace(/\/$/, '')

let _refreshing: Promise<boolean> | null = null

async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const url = API_BASE + path
  const hasBody = init.body != null
  const opts: RequestInit = {
    credentials: 'include',
    // Only set Content-Type for requests that actually have a body
    ...(hasBody ? { headers: { 'Content-Type': 'application/json' } } : {}),
    ...init,
  }
  const r = await fetch(url, opts)
  if (r.status !== 401) return r

  let data: any
  try { data = await r.clone().json() } catch { return r }
  if (data?.code !== 'TOKEN_EXPIRED') return r

  if (!_refreshing) {
    _refreshing = fetch(`${AUTH_URL}/auth/refresh`, { method: 'POST', credentials: 'include' })
      .then(res => res.ok).finally(() => { _refreshing = null })
  }
  const ok = await _refreshing
  if (!ok) return r
  return fetch(url, opts)
}

export async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await apiFetch(path, init)
  if (r.status === 401) { redirectToLogin(); throw new Error('Unauthorized') }
  if (!r.ok) throw new Error(`${init?.method ?? 'GET'} ${path} → ${r.status}`)
  return r.json() as Promise<T>
}

export const api = {
  getCourses: (): Promise<Course[]> =>
    call('/api/courses'),

  createCourse: (course: Course): Promise<void> =>
    call('/api/courses', { method: 'POST', body: JSON.stringify(course) }),

  deleteCourse: (id: string): Promise<void> =>
    call(`/api/courses/${id}`, { method: 'DELETE' }),

  getSegments: (): Promise<Record<string, Segment>> =>
    call('/api/segments'),

  createSegment: (segment: Segment): Promise<void> =>
    call('/api/segments', { method: 'POST', body: JSON.stringify(segment) }),

  patchSegment: (id: string, patch: Partial<Segment> & { courseId?: string }): Promise<void> =>
    call(`/api/segments/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  getDailyLogs: (): Promise<DailyLog[]> =>
    call('/api/daily-logs'),

  upsertDailyLog: (log: DailyLog): Promise<void> =>
    call('/api/daily-logs', { method: 'POST', body: JSON.stringify(log) }),

  getSettings: (): Promise<Partial<AppSettings>> =>
    call('/api/settings'),

  saveSettings: (settings: AppSettings): Promise<void> =>
    call('/api/settings', { method: 'PUT', body: JSON.stringify(settings) }),

  triggerNightlyJob: (): Promise<void> =>
    call('/api/admin/run-nightly', { method: 'POST' }),
}
