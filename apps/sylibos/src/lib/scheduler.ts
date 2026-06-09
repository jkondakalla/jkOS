import type { Course, Segment, DailyLog } from '../types'

export function todayKey(): string {
  return new Date().toISOString().slice(0, 10)
}

export function getStreak(logs: DailyLog[], dailyGoal: number): number {
  if (logs.length === 0) return 0

  const today = todayKey()
  let streak = 0
  const d = new Date()

  for (let i = 0; i < 365; i++) {
    const key = d.toISOString().slice(0, 10)
    const log = logs.find(l => l.date === key)
    if (log && log.segmentIds.length >= dailyGoal) {
      streak++
      d.setDate(d.getDate() - 1)
    } else if (key === today) {
      // Today's goal not yet met — skip without breaking the streak
      d.setDate(d.getDate() - 1)
    } else {
      break
    }
  }

  return streak
}

export function getTodayCompleted(logs: DailyLog[]): string[] {
  return logs.find(l => l.date === todayKey())?.segmentIds ?? []
}

export function getNextSegments(
  courses: Course[],
  segments: Record<string, Segment>,
  dailyGoal: number,
  logs: DailyLog[]
): Segment[] {
  const todayDone = getTodayCompleted(logs)
  const remaining = dailyGoal - todayDone.length
  if (remaining <= 0) return []

  const generated: Segment[] = []

  for (const course of courses) {
    for (const lecture of course.lectures) {
      if (!lecture.segmentId) continue
      const seg = segments[lecture.segmentId]
      if (!seg) continue
      if (seg.completedAt) continue
      if (todayDone.includes(seg.id)) continue
      generated.push(seg)
      if (generated.length >= remaining) break
    }
    if (generated.length >= remaining) break
  }

  return generated
}

export function getTodayProgress(logs: DailyLog[], dailyGoal: number): { done: number; goal: number } {
  const done = getTodayCompleted(logs).length
  return { done, goal: dailyGoal }
}
