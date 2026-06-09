import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useAppStore } from '../store/appStore'
import { useAuthStore } from '../store/authStore'
import { getTodayProgress, getStreak, getTodayCompleted } from '../lib/scheduler'
import { sliceLecture } from '../lib/sliceLecture'
import { db } from '../lib/db'
import { Badge, Bar, Button, Card, EmptyState, Icon, Ring, unitColor } from '../components/ui'
import type { Course, Segment } from '../types'

function greeting(): string {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}
const DATE_FMT = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' })

function unitIndexOf(course: Course, unit: string): number {
  const units = [...new Set(course.lectures.map(l => l.unit || 'Lectures'))]
  return Math.max(0, units.indexOf(unit || 'Lectures'))
}

interface SliceInfo { total: number; read: number; done: boolean }
function sliceInfoFor(course: Course, seg: Segment): SliceInfo {
  const lec = course.lectures.find(l => l.id === seg.lectureId)
  const total = lec ? sliceLecture(lec.id, lec.title, lec.content).length : 1
  const read = Math.min(db.getSliceProgress(seg.id), total)
  return { total, read, done: !!seg.completedAt }
}

function SectionTitle({ icon, children, action }: { icon: Parameters<typeof Icon>[0]['name']; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <Icon name={icon} size={16} className="text-faint" />
      <h2 className="text-[12px] font-bold uppercase tracking-[0.1em] text-faint">{children}</h2>
      {action && <div className="ml-auto">{action}</div>}
    </div>
  )
}

function LessonCard({ course, seg, index }: { course: Course; seg: Segment; index: number }) {
  const color = unitColor(unitIndexOf(course, seg.unit))
  const info = sliceInfoFor(course, seg)
  const action = info.done ? 'Review' : info.read > 1 ? 'Resume' : 'Start'

  return (
    <Link to={`/lesson/${seg.id}`} className="block animate-fade-up" style={{ animationDelay: `${index * 60}ms` }}>
      <Card hover className="h-full p-5">
        <div className="mb-3 flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ background: color }} />
          <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color }}>
            {seg.unit || 'Lecture'}{seg.section ? ` · ${seg.section}` : ''}
          </span>
          {info.done && <Icon name="check" size={14} className="ml-auto text-ok" />}
        </div>

        <h3 className="font-display text-[17px] font-semibold leading-snug text-ink line-clamp-2">
          {seg.lectureTitle}
        </h3>

        <div className="mt-4">
          {info.done ? (
            <p className="text-[12px] text-muted">
              Completed{typeof seg.quizScore === 'number' ? ` · quiz ${seg.quizScore}/${seg.quiz.length}` : ''}
            </p>
          ) : (
            <>
              <div className="mb-1.5 flex items-center justify-between text-[11px] text-muted">
                <span>{info.read > 1 ? `Read ${info.read - 1} of ${info.total}` : `${info.total} slices`}</span>
                <span className="flex items-center gap-1"><Icon name="sparkles" size={12} />{seg.quiz.length} quiz</span>
              </div>
              <Bar value={info.total ? (info.read - 1) / info.total : 0} color={color} height={5} />
            </>
          )}
        </div>

        <div className="mt-4 flex items-center justify-between">
          <span className="text-[12px] font-medium text-faint truncate">{course.title}</span>
          <span className="inline-flex items-center gap-1 text-[13px] font-semibold" style={{ color }}>
            {action} <Icon name="arrow-right" size={15} />
          </span>
        </div>
      </Card>
    </Link>
  )
}

export default function Home() {
  const { courses, segments, dailyLogs, settings } = useAppStore()
  const name = useAuthStore(s => s.user?.name)?.split(/\s+/)[0]

  const { done, goal } = getTodayProgress(dailyLogs, settings.dailyGoal)
  const streak = getStreak(dailyLogs, settings.dailyGoal)
  const goalMet = done >= goal

  const incomplete = useMemo(() => {
    const todayDone = getTodayCompleted(dailyLogs)
    const out: Array<{ course: Course; seg: Segment }> = []
    for (const course of courses) {
      for (const lec of course.lectures) {
        if (!lec.segmentId) continue
        const seg = segments[lec.segmentId]
        if (!seg || seg.completedAt || todayDone.includes(seg.id)) continue
        out.push({ course, seg })
      }
    }
    return out
  }, [courses, segments, dailyLogs])

  const queue = incomplete.slice(0, 4)
  const studying = incomplete[0]?.course ?? courses[0] ?? null

  if (courses.length === 0) {
    return (
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        <EmptyState icon="cap" title="Your library is empty"
          body="Import a course from MIT OpenCourseWare and SylibOS will break each lecture into short, followable lessons."
          action={<Link to="/import"><Button icon={<Icon name="upload" size={17} />}>Import a course</Button></Link>} />
      </div>
    )
  }

  const totalSegs = Object.keys(segments).length

  return (
    <div className="mx-auto max-w-5xl px-4 sm:px-6 py-8 sm:py-10">
      <header className="mb-10 flex flex-wrap items-start justify-between gap-6 animate-fade-up">
        <div className="min-w-0">
          <p className="mb-1.5 text-[12px] font-bold uppercase tracking-[0.12em] text-accent-ink">
            Today · {DATE_FMT.format(new Date())}
          </p>
          <h1 className="font-display text-[34px] font-semibold leading-tight tracking-[-0.02em] text-ink">
            {greeting()}{name ? `, ${name}` : ''}
          </h1>
          <p className="mt-2 max-w-md text-[15px] text-muted">
            {goalMet
              ? 'You have hit your goal for today. Anything more is a bonus.'
              : incomplete.length === 0
                ? 'No lessons are waiting. Generate more from one of your courses.'
                : `You have ${incomplete.length} lesson${incomplete.length === 1 ? '' : 's'} ready. ${goal - done} to go for today.`}
          </p>
        </div>

        <div className="flex items-center gap-4">
          {streak > 0 && (
            <div className="flex flex-col items-center rounded-2xl border border-warn/30 bg-warn-soft px-4 py-3">
              <Icon name="flame" size={22} className="text-warn" strokeWidth={1.5} />
              <span className="mt-1 text-xl font-bold leading-none text-warn tabular-nums">{streak}</span>
              <span className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-warn/80">day streak</span>
            </div>
          )}
          <Ring value={goal ? done / goal : 0} size={92} stroke={8} color={goalMet ? 'var(--color-ok)' : 'var(--color-accent)'}>
            <div className="text-center">
              <div className="font-display text-2xl font-semibold leading-none text-ink tabular-nums">{done}</div>
              <div className="text-[11px] text-faint">of {goal}</div>
            </div>
          </Ring>
        </div>
      </header>

      <section className="mb-12">
        <SectionTitle icon="target"
          action={incomplete.length > queue.length && studying
            ? <Link to={`/course/${studying.id}`} className="text-[12px] font-semibold text-accent-ink hover:underline">See all</Link>
            : undefined}>
          {goalMet ? 'Keep going' : 'Up next'}
        </SectionTitle>

        {queue.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {queue.map(({ course, seg }, i) => <LessonCard key={seg.id} course={course} seg={seg} index={i} />)}
          </div>
        ) : (
          <Card className="p-8 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-ok-soft text-ok">
              <Icon name="check" size={24} />
            </div>
            <p className="font-display text-lg font-semibold text-ink">
              {totalSegs > 0 ? 'Every lesson is done' : 'No lessons yet'}
            </p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted">
              {totalSegs > 0
                ? 'You have worked through everything you generated. Open a course to generate more.'
                : 'Open a course and generate lessons to start studying.'}
            </p>
            {studying && (
              <Link to={`/course/${studying.id}`} className="mt-4 inline-block">
                <Button variant="soft" icon={<Icon name="sparkles" size={16} />}>Generate lessons</Button>
              </Link>
            )}
          </Card>
        )}
      </section>

      {studying && <CourseSummary course={studying} segments={segments} />}

      {courses.length > 1 && (
        <section className="mt-12">
          <SectionTitle icon="layers">Your library</SectionTitle>
          <div className="grid gap-3 sm:grid-cols-2">
            {courses.map(course => {
              const pct = course.lectures.length ? course.completedSegments / course.lectures.length : 0
              return (
                <Link key={course.id} to={`/course/${course.id}`}>
                  <Card hover className="flex items-center gap-4 p-4">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-ink">
                      <Icon name="book" size={20} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-ink">{course.title}</p>
                      <p className="mt-0.5 text-[12px] text-muted">{course.lectures.length} lectures · {Math.round(pct * 100)}% done</p>
                    </div>
                    <Icon name="chevron" size={18} className="text-faint" />
                  </Card>
                </Link>
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}

function CourseSummary({ course, segments }: { course: Course; segments: Record<string, Segment> }) {
  const units = useMemo(() => {
    const map = new Map<string, { total: number; done: number }>()
    for (const lec of course.lectures) {
      const u = lec.unit || 'Lectures'
      const cur = map.get(u) ?? { total: 0, done: 0 }
      cur.total++
      const seg = lec.segmentId ? segments[lec.segmentId] : null
      if (seg?.completedAt) cur.done++
      map.set(u, cur)
    }
    return [...map.entries()]
  }, [course, segments])

  const pct = course.lectures.length ? course.completedSegments / course.lectures.length : 0

  return (
    <section>
      <SectionTitle icon="book"
        action={<Link to={`/course/${course.id}`} className="text-[12px] font-semibold text-accent-ink hover:underline">Open course</Link>}>
        Currently studying
      </SectionTitle>
      <Card glow={unitColor(0)} className="p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-display text-2xl font-semibold tracking-[-0.01em] text-ink">{course.title}</h3>
            <p className="mt-1 text-[13px] text-muted">
              {[course.instructor, course.level].filter(Boolean).join(' · ') || `${course.lectures.length} lectures`}
            </p>
          </div>
          <Badge>{Math.round(pct * 100)}% complete</Badge>
        </div>

        <Bar value={pct} height={6} className="mt-4" />

        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          {units.slice(0, 6).map(([name, u], i) => (
            <div key={name} className="flex items-center gap-3 rounded-xl bg-card-2 px-3 py-2.5">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: unitColor(i) }} />
              <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{name}</span>
              <span className="text-[12px] tabular-nums text-faint">{u.done}/{u.total}</span>
            </div>
          ))}
        </div>
        {units.length > 6 && (
          <Link to={`/course/${course.id}`} className="mt-3 inline-flex items-center gap-1 text-[13px] font-semibold text-accent-ink hover:underline">
            +{units.length - 6} more units <Icon name="arrow-right" size={14} />
          </Link>
        )}
      </Card>
    </section>
  )
}
