import { create } from 'zustand'
import { db } from '../lib/db'
import { api } from '../lib/api'
import { todayKey } from '../lib/scheduler'
import type { Course, Segment, DailyLog, AppSettings } from '../types'

const DEFAULT_SETTINGS: AppSettings = {
  dailyGoal: 2,
  ollamaUrl: 'http://localhost:11434',
  ollamaModel: 'llama3',
  claudeApiKey: '',
  lazurosUrl: '',
  lazurosToken: '',
  aiProvider: 'none',
  theme: 'dark',
  scheme: 'nocturne',
}

interface AppState {
  courses: Course[]
  segments: Record<string, Segment>
  dailyLogs: DailyLog[]
  settings: AppSettings

  addCourse: (course: Course) => void
  removeCourse: (courseId: string) => void
  addSegment: (segment: Segment) => void
  completeSegment: (segmentId: string, quizScore: number) => void
  updateSettings: (patch: Partial<AppSettings>) => void
  hydrate: () => Promise<void>
}

function sortNewestFirst(courses: Course[]): Course[] {
  return [...courses].sort((a, b) => b.importedAt - a.importedAt)
}

export const useAppStore = create<AppState>((set, get) => ({
  courses: [],
  segments: {},
  dailyLogs: [],
  settings: db.getSettings(),

  hydrate: async () => {
    try {
      const [courses, segments, logs, remoteSettings] = await Promise.all([
        api.getCourses(),
        api.getSegments(),
        api.getDailyLogs(),
        api.getSettings(),
      ])
      const settings = { ...DEFAULT_SETTINGS, ...remoteSettings }
      db.saveSettings(settings)
      set({ courses: sortNewestFirst(courses), segments, dailyLogs: logs, settings })
    } catch (e) {
      console.warn('[store] Backend unreachable, falling back to localStorage:', e)
      set({
        courses: sortNewestFirst(db.getCourses()),
        segments: db.getSegments(),
        dailyLogs: db.getDailyLogs(),
        settings: db.getSettings(),
      })
    }
  },

  addCourse: (course) => {
    const courses = sortNewestFirst([...get().courses, course])
    db.saveCourses(courses)
    set({ courses })
    api.createCourse(course).catch(e => {
      console.warn('[store] createCourse failed — reverting:', e)
      const reverted = get().courses.filter(c => c.id !== course.id)
      db.saveCourses(reverted)
      set({ courses: reverted })
    })
  },

  removeCourse: (courseId) => {
    const prevCourses = get().courses
    const prevSegments = get().segments
    const prevLogs = get().dailyLogs

    const deletedSegmentIds = new Set(
      Object.keys(prevSegments).filter(id => prevSegments[id].courseId === courseId)
    )
    const courses = prevCourses.filter(c => c.id !== courseId)
    const segments = Object.fromEntries(
      Object.entries(prevSegments).filter(([id]) => !deletedSegmentIds.has(id))
    )
    // Remove deleted segment IDs from daily logs to prevent stale references
    const dailyLogs = prevLogs.map(log => ({
      ...log,
      segmentIds: log.segmentIds.filter((id: string) => !deletedSegmentIds.has(id)),
    }))

    db.saveCourses(courses)
    db.saveSegments(segments)
    db.saveDailyLogs(dailyLogs)
    set({ courses, segments, dailyLogs })
    api.deleteCourse(courseId).catch(e => {
      console.warn('[store] deleteCourse failed — reverting:', e)
      db.saveCourses(prevCourses)
      db.saveSegments(prevSegments)
      db.saveDailyLogs(prevLogs)
      set({ courses: prevCourses, segments: prevSegments, dailyLogs: prevLogs })
    })
  },

  addSegment: (segment) => {
    const segments = { ...get().segments, [segment.id]: segment }

    const courses = get().courses.map(course => {
      if (course.id !== segment.courseId) return course
      return {
        ...course,
        lectures: course.lectures.map(lec =>
          lec.id === segment.lectureId
            ? { ...lec, hasSegment: true, segmentId: segment.id }
            : lec
        ),
      }
    })

    db.saveSegments(segments)
    db.saveCourses(courses)
    set({ segments, courses })
    api.createSegment(segment).catch(e => {
      console.warn('[store] createSegment failed — reverting:', e)
      const revSegments = { ...get().segments }
      delete revSegments[segment.id]
      const revCourses = get().courses.map(course => {
        if (course.id !== segment.courseId) return course
        return {
          ...course,
          lectures: course.lectures.map(lec =>
            lec.id === segment.lectureId
              ? { ...lec, hasSegment: false, segmentId: undefined }
              : lec
          ),
        }
      })
      db.saveSegments(revSegments)
      db.saveCourses(revCourses)
      set({ segments: revSegments, courses: revCourses })
    })
  },

  completeSegment: (segmentId, quizScore) => {
    const existing = get().segments[segmentId]
    if (!existing || existing.completedAt) return
    const now = Date.now()
    const segments = {
      ...get().segments,
      [segmentId]: { ...existing, completedAt: now, quizScore },
    }

    const seg = segments[segmentId]
    const courses = get().courses.map(course => {
      if (course.id !== seg.courseId) return course
      return { ...course, completedSegments: course.completedSegments + 1 }
    })

    const today = todayKey()
    const logs = get().dailyLogs
    const existingIdx = logs.findIndex(l => l.date === today)
    let dailyLogs: DailyLog[]
    if (existingIdx >= 0) {
      dailyLogs = logs.map((l, i) =>
        i === existingIdx ? { ...l, segmentIds: [...l.segmentIds, segmentId] } : l
      )
    } else {
      dailyLogs = [...logs, { date: today, segmentIds: [segmentId] }]
    }

    db.saveSegments(segments)
    db.saveCourses(courses)
    db.saveDailyLogs(dailyLogs)
    set({ segments, courses, dailyLogs })

    const todayLog = dailyLogs.find(l => l.date === today)!
    api.patchSegment(segmentId, { completedAt: now, quizScore, courseId: seg.courseId })
      .catch(e => {
        console.warn('[store] patchSegment failed — reverting:', e)
        const prevSegs = { ...get().segments, [segmentId]: existing }
        const prevCourses = get().courses.map(c =>
          c.id === seg.courseId ? { ...c, completedSegments: c.completedSegments - 1 } : c
        )
        const prevLogs = get().dailyLogs.map(l =>
          l.date === today
            ? { ...l, segmentIds: l.segmentIds.filter((id: string) => id !== segmentId) }
            : l
        )
        db.saveSegments(prevSegs)
        db.saveCourses(prevCourses)
        db.saveDailyLogs(prevLogs)
        set({ segments: prevSegs, courses: prevCourses, dailyLogs: prevLogs })
      })
    api.upsertDailyLog(todayLog)
      .catch(e => console.warn('[store] upsertDailyLog failed:', e))
  },

  updateSettings: (patch) => {
    const prev = get().settings
    const settings = { ...prev, ...patch }
    db.saveSettings(settings)
    set({ settings })
    api.saveSettings(settings).catch(e => {
      console.warn('[store] saveSettings failed — reverting:', e)
      db.saveSettings(prev)
      set({ settings: prev })
    })
  },
}))
