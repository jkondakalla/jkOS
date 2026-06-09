// libraryApi.ts - typed fetch wrappers for the Library endpoints
//
// Uses the same `call` helper the rest of SylibOS uses (api.ts), which handles
// the jkOS auth cookie, base URL, JSON parsing, and 401 redirect.
// All three functions throw on non-2xx; callers should wrap in try/catch.

import { call } from './api'

// ---- Catalog ---------------------------------------------------------------

export interface LibraryCourse {
  slug: string
  title: string
  description: string
  subject: string
  level: string
  courseNumber: string
  term: string
  lectureCount: number
  hasVideo: boolean
  usedAiSplit: boolean
  added: boolean
}

export async function listLibrary(): Promise<LibraryCourse[]> {
  const data = await call<{ courses: LibraryCourse[] }>('/api/library')
  return data.courses ?? []
}

// ---- Preview ---------------------------------------------------------------

export interface LibraryLecturePreview {
  title: string
  ord: number
  hasVideo: boolean
}

export interface LibraryUnitPreview {
  title: string
  ord: number
  lectures: LibraryLecturePreview[]
}

export interface LibraryCoursePreview {
  slug: string
  title: string
  description: string
  instructor: string
  subject: string
  level: string
  courseNumber: string
  term: string
  lectureCount: number
  units: LibraryUnitPreview[]
}

export async function getLibraryCourse(slug: string): Promise<LibraryCoursePreview> {
  return call<LibraryCoursePreview>(`/api/library/${encodeURIComponent(slug)}`)
}

// ---- Add to dash -----------------------------------------------------------

export interface AddCourseResult {
  courseId: string
  alreadyAdded: boolean
}

export async function addLibraryCourse(slug: string): Promise<AddCourseResult> {
  return call<AddCourseResult>(`/api/library/${encodeURIComponent(slug)}/add`, {
    method: 'POST',
  })
}

// ---- Upload (admin only) ---------------------------------------------------

export interface UploadManifestResult {
  slug: string
  lectureCount: number
}

export async function uploadCourseManifest(manifest: unknown): Promise<UploadManifestResult> {
  return call<UploadManifestResult>('/api/library/upload', {
    method: 'POST',
    body: JSON.stringify(manifest),
  })
}
