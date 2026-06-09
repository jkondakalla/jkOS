import type { Course, Segment, DailyLog, AppSettings } from '../types'

const KEYS = {
  courses: 'sylibos:courses',
  segments: 'sylibos:segments',
  dailyLogs: 'sylibos:dailyLogs',
  settings: 'sylibos:settings',
  sliceProgress: 'sylibos:sliceProgress',
} as const

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function save<T>(key: string, value: T): void {
  localStorage.setItem(key, JSON.stringify(value))
}

// segmentId -> furthest slice index reached (1-based). Local-only; resume aid.
type SliceProgress = Record<string, number>

export const db = {
  getCourses: (): Course[] => load(KEYS.courses, []),
  saveCourses: (courses: Course[]) => save(KEYS.courses, courses),

  getSegments: (): Record<string, Segment> => load(KEYS.segments, {}),
  saveSegments: (segments: Record<string, Segment>) => save(KEYS.segments, segments),

  getDailyLogs: (): DailyLog[] => load(KEYS.dailyLogs, []),
  saveDailyLogs: (logs: DailyLog[]) => save(KEYS.dailyLogs, logs),

  getSettings: (): AppSettings => load(KEYS.settings, {
    dailyGoal: 2,
    ollamaUrl: 'http://localhost:11434',
    ollamaModel: 'llama3',
    claudeApiKey: '',
    lazurosUrl: '',
    lazurosToken: '',
    aiProvider: 'none',
    theme: 'dark',
    scheme: 'nocturne',
  }),
  saveSettings: (settings: AppSettings) => save(KEYS.settings, settings),

  getSliceProgress: (segmentId: string): number =>
    load<SliceProgress>(KEYS.sliceProgress, {})[segmentId] ?? 1,
  setSliceProgress: (segmentId: string, slice: number) => {
    const all = load<SliceProgress>(KEYS.sliceProgress, {})
    all[segmentId] = Math.max(all[segmentId] ?? 1, slice)
    save(KEYS.sliceProgress, all)
  },

  clear: () => Object.values(KEYS).forEach(k => localStorage.removeItem(k)),
}
