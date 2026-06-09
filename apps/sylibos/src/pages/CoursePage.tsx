import { useMemo, useState, useEffect } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { useAppStore } from '../store/appStore'
import { generateLessonContent } from '../lib/aiService'
import { sliceLecture } from '../lib/sliceLecture'
import { Bar, Button, Card, Icon, Spinner, unitColor, cx } from '../components/ui'
import type { Lecture, Segment } from '../types'

const randomId = () => crypto.randomUUID()

type SectionGroup = { name?: string; lectures: Lecture[] }
type UnitGroup = { unit: string; color: string; unitNum: number; sections: SectionGroup[]; total: number; done: number; ungen: number }

export default function CoursePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { courses, segments, settings, addSegment, removeCourse } = useAppStore()
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [collapsedSec, setCollapsedSec] = useState<Set<string>>(new Set())

  const course = courses.find(c => c.id === id)
  useEffect(() => { if (!course) navigate('/') }, [course, navigate])

  const units = useMemo<UnitGroup[]>(() => {
    if (!course) return []
    const groups: UnitGroup[] = []
    const idx: Record<string, number> = {}
    for (const lec of course.lectures) {
      const unit = lec.unit || 'Lectures'
      if (idx[unit] === undefined) {
        idx[unit] = groups.length
        groups.push({ unit, color: unitColor(groups.length), unitNum: groups.length + 1, sections: [], total: 0, done: 0, ungen: 0 })
      }
      const g = groups[idx[unit]]
      g.total++
      const seg = lec.segmentId ? segments[lec.segmentId] : null
      if (seg?.completedAt) g.done++
      if (!seg) g.ungen++
      const last = g.sections[g.sections.length - 1]
      if (!last || last.name !== lec.section) g.sections.push({ name: lec.section, lectures: [lec] })
      else last.lectures.push(lec)
    }
    return groups
  }, [course, segments])

  useEffect(() => { if (units.length) setExpanded(new Set([units[0].unit])) }, [units.length]) // eslint-disable-line

  const toggle = (set: Set<string>, key: string, fn: (s: Set<string>) => void) => {
    const next = new Set(set)
    if (next.has(key)) next.delete(key); else next.add(key)
    fn(next)
  }

  async function generate(lecIds: string[]) {
    if (!course) return
    setBusy(prev => new Set([...prev, ...lecIds]))
    try {
      for (const lecId of lecIds) {
        const lec = course.lectures.find(l => l.id === lecId)
        if (!lec || lec.segmentId) continue
        try {
          const content = await generateLessonContent(settings, lec.title, lec.content, lec.unit, course.title)
          addSegment({
            id: randomId(), lectureId: lec.id, courseId: course.id,
            lectureTitle: lec.title, courseTitle: course.title,
            unit: lec.unit, section: lec.section, generatedAt: Date.now(),
            quiz: content.quiz, tasks: content.tasks,
          } satisfies Segment)
        } catch { /* skip a failed lecture */ }
      }
    } finally {
      setBusy(prev => { const n = new Set(prev); lecIds.forEach(i => n.delete(i)); return n })
    }
  }

  function studyUnit(g: UnitGroup) {
    if (!course) return
    const lecs = g.sections.flatMap(s => s.lectures)
    const next = lecs.find(l => l.segmentId && !segments[l.segmentId!]?.completedAt)
      ?? lecs.find(l => l.segmentId)
    if (next?.segmentId) navigate(`/lesson/${next.segmentId}`)
  }

  if (!course) return null
  const total = course.lectures.length
  const pct = total ? course.completedSegments / total : 0

  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 py-8">
      <Link to="/" className="mb-6 inline-flex items-center gap-1.5 text-[13px] font-medium text-muted transition hover:text-ink">
        <Icon name="arrow-left" size={15} /> Today
      </Link>

      <header className="mb-8 animate-fade-up">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="font-display text-[30px] font-semibold leading-tight tracking-[-0.02em] text-ink">{course.title}</h1>
            <p className="mt-1.5 text-[13px] text-muted">{[course.instructor, course.level].filter(Boolean).join(' · ')}</p>
            {course.description && <p className="mt-3 max-w-xl text-[13px] leading-relaxed text-muted line-clamp-2">{course.description}</p>}
          </div>
          <Button variant="ghost" size="sm" icon={<Icon name="trash" size={15} />}
            onClick={() => { if (confirm(`Delete "${course.title}"? This cannot be undone.`)) { removeCourse(course.id); navigate('/') } }}>
            <span className="hidden sm:inline">Delete</span>
          </Button>
        </div>

        <div className="mt-5 flex items-center justify-between text-[12px] text-muted">
          <span>{total} lectures · {units.length} {units.length === 1 ? 'unit' : 'units'}</span>
          <span className="font-semibold text-ink">{Math.round(pct * 100)}% complete</span>
        </div>
        <Bar value={pct} height={6} className="mt-2" />
      </header>

      <div className="space-y-3">
        {units.map(g => {
          const open = expanded.has(g.unit)
          const hasSections = g.sections.some(s => s.name)
          const unitPct = g.total ? g.done / g.total : 0
          return (
            <Card key={g.unit} className="animate-fade-up">
              <button onClick={() => toggle(expanded, g.unit, setExpanded)}
                className="flex w-full items-center gap-4 p-4 text-left transition hover:bg-paper-2">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[15px] font-bold"
                  style={{ background: `color-mix(in oklab, ${g.color} 14%, transparent)`, color: g.color }}>
                  {g.unitNum}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-ink">{g.unit}</p>
                  <p className="mt-0.5 text-[12px] text-muted">{g.total} lessons · {g.done} done</p>
                </div>
                <div className="hidden w-24 sm:block"><Bar value={unitPct} color={g.color} height={5} /></div>
                <span className="text-faint transition" style={{ transform: open ? 'rotate(90deg)' : 'none' }}>
                  <Icon name="chevron" size={18} />
                </span>
              </button>

              {open && (
                <div className="border-t border-line">
                  <div className="flex items-center gap-2 px-4 py-2.5">
                    {g.sections.some(s => s.lectures.some(l => l.segmentId)) && (
                      <Button size="sm" variant="soft" icon={<Icon name="play" size={13} />} onClick={() => studyUnit(g)}>Study unit</Button>
                    )}
                    {g.ungen > 0 && (
                      <Button size="sm" variant="ghost" icon={<Icon name="sparkles" size={14} />}
                        disabled={g.sections.flatMap(s => s.lectures).some(l => busy.has(l.id))}
                        onClick={() => generate(g.sections.flatMap(s => s.lectures).filter(l => !l.segmentId).map(l => l.id))}>
                        Generate {g.ungen}
                      </Button>
                    )}
                  </div>

                  {g.sections.map((sec, si) => {
                    const secKey = `${g.unit}::${sec.name ?? si}`
                    const secOpen = !collapsedSec.has(secKey)
                    return (
                      <div key={secKey}>
                        {hasSections && sec.name && (
                          <button onClick={() => toggle(collapsedSec, secKey, setCollapsedSec)}
                            className="flex w-full items-center justify-between px-4 py-2 pl-[4.25rem] text-left">
                            <span className="text-[11px] font-bold uppercase tracking-wide text-faint">{sec.name}</span>
                            <span className="text-faint transition" style={{ transform: secOpen ? 'rotate(90deg)' : 'none' }}>
                              <Icon name="chevron" size={14} />
                            </span>
                          </button>
                        )}
                        {secOpen && sec.lectures.map(lec => (
                          <LectureRow key={lec.id} lec={lec} color={g.color}
                            seg={lec.segmentId ? segments[lec.segmentId] : null}
                            busy={busy.has(lec.id)} onGenerate={() => generate([lec.id])} />
                        ))}
                      </div>
                    )
                  })}
                </div>
              )}
            </Card>
          )
        })}
      </div>
    </div>
  )
}

function LectureRow({ lec, seg, color, busy, onGenerate }: {
  lec: Lecture; seg: Segment | null; color: string; busy: boolean; onGenerate: () => void
}) {
  const done = !!seg?.completedAt
  const slices = useMemo(() => sliceLecture(lec.id, lec.title, lec.content).length, [lec.id, lec.title, lec.content])
  const action = done ? 'Review' : 'Start'

  return (
    <div className="flex items-center gap-3 border-t border-line px-4 py-2.5 pl-[4.25rem] transition hover:bg-paper-2">
      <span className={cx('flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-md border')}
        style={done ? { background: color, borderColor: color } : { borderColor: 'var(--color-line-strong)' }}>
        {done && <Icon name="check" size={11} className="text-accent-contrast" strokeWidth={2.5} />}
      </span>

      <div className="min-w-0 flex-1">
        <p className={cx('truncate text-[13.5px]', done ? 'text-faint line-through' : 'text-ink')}>{lec.title}</p>
      </div>

      {seg ? (
        <>
          <span className="hidden items-center gap-1 text-[11px] text-faint sm:flex"><Icon name="layers" size={12} />{slices}</span>
          <Link to={`/lesson/${seg.id}`}>
            <Button size="sm" variant={done ? 'ghost' : 'soft'}>{action}</Button>
          </Link>
        </>
      ) : (
        <Button size="sm" variant="ghost" disabled={busy} onClick={onGenerate}
          icon={busy ? <Spinner size={13} /> : <Icon name="sparkles" size={13} />}>
          {busy ? 'Generating' : 'Generate'}
        </Button>
      )}
    </div>
  )
}
