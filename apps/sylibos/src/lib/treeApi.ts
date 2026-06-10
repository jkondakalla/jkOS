// treeApi.ts - typed fetch wrappers for the ProcessedCourses endpoints
// (backend/processed.js), which serve the file-based output of
// `python -m CourseProcessor.library_cli build-dir|batch`.
//
// Field names mirror the JSON artifacts 1:1 (snake_case) so the files can be
// read directly (e.g. by the node-graph GUI) without a mapping layer; only
// the catalog row is camelCased to match LibraryCourse.

import { call } from './api'

// ---- Shared ----------------------------------------------------------------

export type NodeKind = 'trunk' | 'branch' | 'leaf' | 'checkpoint'
export type EdgeRel = 'follows' | 'branch_of' | 'leaf_of'
export type BoundaryQuality =
  | 'whole' | 'discourse' | 'gap' | 'proportional' | 'heading' | 'shared_video'
export type ExerciseSource = 'ocw_pset' | 'ocw_exam' | 'authored'

// ---- Catalog ---------------------------------------------------------------

export interface ProcessedCourseSummary {
  slug: string
  title: string
  courseNumber: string
  term: string
  level: string
  subject: string
  instructor: string
  calendarSource: string
  matchRate: number | null
  counts: {
    sessions: number
    teaching_sessions: number
    excluded_sessions: number
    trunk_nodes: number
    nodes: number
    concept_chunks: number
    lesson_chunks: number
    exercises: number
    backed_exercises: number
    videos: number
  }
  hasVideos: boolean
}

export async function listProcessedCourses(): Promise<ProcessedCourseSummary[]> {
  const data = await call<{ courses: ProcessedCourseSummary[] }>('/api/processed')
  return data.courses ?? []
}

// ---- Tree ------------------------------------------------------------------

export interface TreeNode {
  id: string
  kind: NodeKind
  parent_id: string | null
  trunk_position: number | null
  branch_position: number | null
  title: string
  session_number: string
  session_slug: string
  lecture_ord: number
  syllabus_topic_verbatim: string
  match_method: string
  est_duration_seconds: number
  boundary_quality: BoundaryQuality | null
  content_ref: string | null     // "concepts.json#<chunk id>"
  exercise_ref: string | null    // "exercises.json#<exercise id>"
}

export interface TreeEdge {
  from: string
  to: string
  rel: EdgeRel
}

export interface CourseTree {
  slug: string
  schema_version: number
  calendar_source: string
  match_rate: number | null
  nodes: TreeNode[]
  edges: TreeEdge[]
}

export async function getCourseTree(slug: string): Promise<CourseTree> {
  return call<CourseTree>(`/api/processed/${encodeURIComponent(slug)}/tree`)
}

// ---- Concepts --------------------------------------------------------------

export interface ConceptItem {
  kind: 'video' | 'text' | 'pdf_ref'
  // video
  provider?: 'youtube'
  youtube_id?: string
  start_seconds?: number
  end_seconds?: number | null
  // text
  text?: string
  char_start?: number
  char_end?: number
  // pdf_ref
  asset_rel_path?: string
  title?: string
}

export interface ConceptChunk {
  id: string
  node_id: string
  title: string
  lecture_ord: number
  session_slug: string
  part: number
  parts_total: number
  start_seconds: number
  end_seconds: number
  duration_estimated: boolean
  boundary_quality: BoundaryQuality
  items: ConceptItem[]
}

export async function getConcepts(slug: string): Promise<{ chunks: ConceptChunk[] }> {
  return call(`/api/processed/${encodeURIComponent(slug)}/concepts`)
}

// ---- Exercises -------------------------------------------------------------

export interface ExerciseChunk {
  id: string
  node_id: string
  kind: 'branch' | 'leaf'
  difficulty: 0 | 1 | 2 | 3
  source: ExerciseSource
  status: 'stub' | 'backed'
  source_label: string | null
  source_asset_rel_path?: string
  solution_asset_rel_paths?: string[]
  body: string
  answer: string
}

export async function getExercises(
  slug: string,
): Promise<{ chunks: ExerciseChunk[]; unattached: ExerciseChunk[] }> {
  return call(`/api/processed/${encodeURIComponent(slug)}/exercises`)
}

// ---- Lessons ---------------------------------------------------------------

export interface LessonChunk {
  id: string
  trunk_node_ids: string[]
  lecture_ord: number
  session_slug: string
  title: string
  part: number
  parts_total: number
  est_duration_seconds: number
  boundary_quality: BoundaryQuality
  text: string
  char_start: number
  char_end: number
}

export async function getLessons(slug: string): Promise<{ chunks: LessonChunk[] }> {
  return call(`/api/processed/${encodeURIComponent(slug)}/lessons`)
}

// ---- Videos ----------------------------------------------------------------

export interface VideoSegment {
  idx: number
  start_seconds: number
  end_seconds: number
  title: string
  text: string
}

export interface ProcessedVideo {
  youtube_id: string
  lecture_ord: number
  session_slugs: string[]
  title: string
  trunk_node_ids: string[]
  captioned: boolean
  segments: VideoSegment[]
}

export async function getVideos(slug: string): Promise<{ videos: ProcessedVideo[] }> {
  return call(`/api/processed/${encodeURIComponent(slug)}/videos`)
}

// ---- Assets ----------------------------------------------------------------

/** URL for an asset_rel_path value (e.g. "assets/lec-001/notes.pdf"). */
export function processedAssetUrl(slug: string, assetRelPath: string): string {
  return `/api/processed/${encodeURIComponent(slug)}/asset/${assetRelPath}`
}
