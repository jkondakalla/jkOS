import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useAppStore } from '../store/appStore'
import { db } from '../lib/db'
import { sliceLecture, estimateReadMinutes, type Slice } from '../lib/sliceLecture'
import { Button, Card, Icon, Bar, unitColor, cx } from '../components/ui'
import type { QuizQuestion, Task, Course } from '../types'

/* — helpers ——————————————————————————————————————————————————————————————— */

function getYouTubeId(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([\w-]+)/)
  return m ? m[1] : null
}

function unitIndexOf(course: Course, unit: string): number {
  const units = [...new Set(course.lectures.map(l => l.unit || 'Lectures'))]
  return Math.max(0, units.indexOf(unit || 'Lectures'))
}

function Prose({ text }: { text: string }) {
  const paras = text.split(/\n{2,}/).map(p => p.trim()).filter(Boolean)
  return (
    <div className="read">
      {paras.map((p, i) => <p key={i}>{p}</p>)}
    </div>
  )
}

/* — Step model ————————————————————————————————————————————————————————————— */

type StepKind = 'read' | 'quiz' | 'practice' | 'done'
interface Step { kind: StepKind; sliceIndex?: number }

/* — Quiz ————————————————————————————————————————————————————————————————— */

function QuizBlock({ questions, color, onComplete }: {
  questions: QuizQuestion[]; color: string; onComplete: (score: number) => void
}) {
  const [current, setCurrent] = useState(0)
  const [selected, setSelected] = useState<number | null>(null)
  const [revealed, setRevealed] = useState(false)
  const [answers, setAnswers] = useState<boolean[]>([])
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])

  const q = questions[current]
  const isLast = current === questions.length - 1

  function check() {
    if (selected === null) return
    setRevealed(true)
    const next = [...answers, selected === q.correctIndex]
    setAnswers(next)
    if (isLast) {
      timerRef.current = setTimeout(() => onComplete(next.filter(Boolean).length), 900)
    }
  }
  function advance() {
    setCurrent(c => c + 1); setSelected(null); setRevealed(false)
  }

  return (
    <div className="animate-fade-in">
      <div className="mb-5 flex gap-1.5">
        {questions.map((_, i) => (
          <div key={i} className="h-1 flex-1 rounded-full transition-colors"
            style={{
              background: i < answers.length
                ? (answers[i] ? 'var(--color-ok)' : 'var(--color-danger)')
                : i === current ? color : 'var(--color-line)',
            }} />
        ))}
      </div>

      <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-faint">
        Question {current + 1} of {questions.length}
      </p>
      <h3 className="mb-5 font-display text-xl font-semibold leading-snug text-ink">{q.question}</h3>

      <div className="mb-5 flex flex-col gap-2.5">
        {q.options.map((opt, idx) => {
          const isPicked = selected === idx
          const isCorrect = idx === q.correctIndex
          let cls = 'border-line bg-card hover:border-faint'
          let style: React.CSSProperties = {}
          if (isPicked && !revealed) { cls = 'text-ink'; style = { borderColor: color, background: `color-mix(in oklab, ${color} 10%, transparent)` } }
          if (revealed && isCorrect) cls = 'border-ok bg-ok-soft text-ink'
          if (revealed && isPicked && !isCorrect) cls = 'border-danger bg-danger-soft text-ink'
          return (
            <button key={idx} disabled={revealed} onClick={() => setSelected(idx)} style={style}
              className={cx(
                'flex items-center gap-3 rounded-xl border px-4 py-3 text-left text-[15px] transition',
                'disabled:cursor-default', cls,
              )}>
              <span className={cx(
                'flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[12px] font-bold',
                revealed && isCorrect ? 'bg-ok text-white'
                  : revealed && isPicked ? 'bg-danger text-white'
                  : 'bg-paper-2 text-muted',
              )}>
                {revealed && isCorrect ? <Icon name="check" size={13} strokeWidth={3} />
                  : revealed && isPicked ? <Icon name="x" size={13} strokeWidth={3} />
                  : ['A', 'B', 'C', 'D'][idx]}
              </span>
              {opt}
            </button>
          )
        })}
      </div>

      {revealed && q.explanation && (
        <div className="mb-5 rounded-xl border border-line bg-card-2 p-4 animate-fade-in">
          <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-faint">Why</p>
          <p className="text-[14px] leading-relaxed text-muted">{q.explanation}</p>
        </div>
      )}

      {!revealed ? (
        <Button full size="lg" disabled={selected === null} onClick={check}>Check answer</Button>
      ) : !isLast ? (
        <Button full size="lg" variant="outline" icon={<Icon name="arrow-right" size={16} />} onClick={advance}>
          Next question
        </Button>
      ) : (
        <p className="text-center text-[13px] text-muted">Scoring…</p>
      )}
    </div>
  )
}

/* — Practice timer ——————————————————————————————————————————————————————— */

function TaskBlock({ tasks, onComplete }: { tasks: Task[]; onComplete: () => void }) {
  const [idx, setIdx] = useState(0)
  const [left, setLeft] = useState(tasks[0].durationMinutes * 60)
  const [running, setRunning] = useState(false)
  const [done, setDone] = useState(0)

  const task = tasks[idx]
  const total = task.durationMinutes * 60
  const pct = total > 0 ? (total - left) / total : 0

  useEffect(() => {
    if (!running) return
    const t = setInterval(() => {
      setLeft(s => {
        if (s <= 1) { setRunning(false); return 0 }
        return s - 1
      })
    }, 1000)
    return () => clearInterval(t)
  }, [running])

  const mm = String(Math.floor(left / 60)).padStart(2, '0')
  const ss = String(left % 60).padStart(2, '0')
  const finished = left === 0

  function next() {
    const n = done + 1
    setDone(n)
    if (idx < tasks.length - 1) {
      setIdx(idx + 1); setLeft(tasks[idx + 1].durationMinutes * 60); setRunning(false)
    } else onComplete()
  }

  const r = 52, circ = 2 * Math.PI * r

  return (
    <div className="animate-fade-in">
      <div className="mb-5 flex gap-1.5">
        {tasks.map((_, i) => (
          <div key={i} className="h-1 flex-1 rounded-full"
            style={{ background: i < done ? 'var(--color-ok)' : i === idx ? 'var(--color-warn)' : 'var(--color-line)' }} />
        ))}
      </div>

      <p className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-faint">
        Task {idx + 1} of {tasks.length}
      </p>

      <div className="mb-6 rounded-xl border border-line bg-card-2 p-5">
        <p className="text-[15px] leading-relaxed text-ink">{task.description}</p>
      </div>

      <div className="mb-6 flex flex-col items-center">
        <div className="relative" style={{ width: 128, height: 128 }}>
          <svg width="128" height="128" className="-rotate-90">
            <circle cx="64" cy="64" r={r} fill="none" stroke="var(--color-line)" strokeWidth="9" />
            <circle cx="64" cy="64" r={r} fill="none"
              stroke={finished ? 'var(--color-ok)' : 'var(--color-warn)'} strokeWidth="9"
              strokeDasharray={circ} strokeDashoffset={circ * (1 - pct)} strokeLinecap="round"
              style={{ transition: running ? 'stroke-dashoffset 1s linear' : 'stroke-dashoffset 0.3s' }} />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="font-display text-2xl font-semibold tabular-nums text-ink">{mm}:{ss}</span>
          </div>
        </div>

        <div className="mt-5 flex gap-2.5">
          {!finished && (
            <Button variant="outline" onClick={() => setRunning(r => !r)}
              icon={<Icon name={running ? 'pause' : 'play'} size={15} />}>
              {running ? 'Pause' : left === total ? 'Start timer' : 'Resume'}
            </Button>
          )}
          <Button onClick={next} icon={<Icon name="check" size={15} strokeWidth={2.5} />}>
            {idx < tasks.length - 1 ? 'Done — next task' : 'Finish practice'}
          </Button>
        </div>
      </div>
    </div>
  )
}

/* — Lesson page ————————————————————————————————————————————————————————— */

export default function Lesson() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { segments, courses, completeSegment } = useAppStore()

  const seg = id ? segments[id] : null
  const course = seg ? courses.find(c => c.id === seg.courseId) : null
  const lecture = course?.lectures.find(l => l.id === seg?.lectureId) ?? null

  const color = useMemo(
    () => (course && seg ? unitColor(unitIndexOf(course, seg.unit)) : 'var(--color-accent)'),
    [course, seg],
  )

  const slices: Slice[] = useMemo(
    () => (lecture ? sliceLecture(lecture.id, lecture.title, lecture.content) : []),
    [lecture],
  )
  const hasNotes = slices.length > 0 && !slices[0].empty

  const steps: Step[] = useMemo(() => {
    const s: Step[] = []
    if (hasNotes) slices.forEach((_, i) => s.push({ kind: 'read', sliceIndex: i }))
    else s.push({ kind: 'read', sliceIndex: 0 })
    if (seg?.quiz.length) s.push({ kind: 'quiz' })
    if (seg?.tasks.length) s.push({ kind: 'practice' })
    s.push({ kind: 'done' })
    return s
  }, [slices, hasNotes, seg])

  const [stepIdx, setStepIdx] = useState<number>(() => {
    if (!seg || seg.completedAt) return 0
    const reached = db.getSliceProgress(seg.id)
    const maxRead = hasNotes ? slices.length - 1 : 0
    return Math.max(0, Math.min(reached - 1, maxRead))
  })

  const [quizScore, setQuizScore] = useState(0)
  const completing = useRef(false)

  useEffect(() => { if (!seg) navigate('/') }, [seg, navigate])

  const orderedSegIds = useMemo(
    () => (course?.lectures ?? []).filter(l => l.segmentId).map(l => l.segmentId!),
    [course?.lectures],
  )
  const segPos = orderedSegIds.indexOf(id ?? '')
  const nextSegId = segPos >= 0 && segPos < orderedSegIds.length - 1 ? orderedSegIds[segPos + 1] : null

  const step = steps[stepIdx]

  const goToStep = useCallback((next: number) => {
    setStepIdx(next)
    const ns = steps[next]
    if (seg && ns?.kind === 'read' && ns.sliceIndex !== undefined) {
      db.setSliceProgress(seg.id, ns.sliceIndex + 1)
    }
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [steps, seg])

  const handleQuizDone = useCallback((score: number) => {
    setQuizScore(score)
    const nextI = steps.findIndex((s, i) => i > stepIdx && (s.kind === 'practice' || s.kind === 'done'))
    goToStep(nextI === -1 ? steps.length - 1 : nextI)
  }, [steps, stepIdx, goToStep])

  const handlePracticeDone = useCallback(() => {
    const doneI = steps.findIndex(s => s.kind === 'done')
    goToStep(doneI === -1 ? steps.length - 1 : doneI)
  }, [steps, goToStep])

  const finish = useCallback((then: 'course' | 'next') => {
    if (!seg) return
    if (!seg.completedAt && !completing.current) {
      completing.current = true
      completeSegment(seg.id, quizScore)
    }
    if (then === 'next' && nextSegId) navigate(`/lesson/${nextSegId}`)
    else navigate(`/course/${seg.courseId}`)
  }, [seg, quizScore, completeSegment, navigate, nextSegId])

  if (!seg) return null

  const readCount = hasNotes ? slices.length : 1
  const ytId = lecture?.videoUrl ? getYouTubeId(lecture.videoUrl) : null
  const progressPct = steps.length > 1 ? stepIdx / (steps.length - 1) : 0

  const stepLabel = (s: Step): string =>
    s.kind === 'read' ? (hasNotes ? `Read ${(s.sliceIndex ?? 0) + 1}` : 'Read')
    : s.kind === 'quiz' ? 'Quiz'
    : s.kind === 'practice' ? 'Practice'
    : 'Done'

  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 py-6 sm:py-8">
      <div className="mb-5 flex items-center gap-1.5 text-[12px] text-faint">
        <Link to="/" className="font-medium text-muted transition hover:text-ink">Today</Link>
        <Icon name="chevron" size={13} />
        <Link to={`/course/${seg.courseId}`} className="font-medium transition hover:text-ink truncate max-w-[40vw]"
          style={{ color }}>{seg.courseTitle}</Link>
      </div>

      <header className="mb-6 animate-fade-up">
        <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.1em]" style={{ color }}>
          {seg.unit || 'Lecture'}{seg.section ? ` · ${seg.section}` : ''}
        </p>
        <h1 className="font-display text-[28px] font-semibold leading-tight tracking-[-0.02em] text-ink">
          {seg.lectureTitle}
        </h1>
      </header>

      <div className="mb-6">
        <div className="mb-2 flex items-center gap-1.5 overflow-x-auto pb-1">
          {steps.map((s, i) => {
            const isCur = i === stepIdx
            const isPast = i < stepIdx
            return (
              <button key={i} onClick={() => i <= stepIdx && goToStep(i)} disabled={i > stepIdx}
                className={cx(
                  'shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition',
                  i > stepIdx && 'cursor-default',
                )}
                style={
                  isCur ? { background: color, borderColor: color, color: 'var(--color-accent-contrast)' }
                  : isPast ? { background: 'var(--color-ok-soft)', borderColor: 'transparent', color: 'var(--color-ok)' }
                  : { background: 'transparent', borderColor: 'var(--color-line)', color: 'var(--color-faint)' }
                }>
                {isPast && <Icon name="check" size={11} strokeWidth={3} className="mr-0.5 inline align-[-1px]" />}
                {stepLabel(s)}
              </button>
            )
          })}
        </div>
        <Bar value={progressPct} color={color} height={4} />
      </div>

      {step.kind === 'read' && (
        <div key={stepIdx} className="animate-slide-right">
          {step.sliceIndex === 0 && lecture?.videoUrl && (
            <Card className="mb-5 overflow-hidden">
              {ytId ? (
                <div className="relative" style={{ paddingBottom: '56.25%' }}>
                  <iframe className="absolute inset-0 h-full w-full" src={`https://www.youtube.com/embed/${ytId}`}
                    title={seg.lectureTitle} allowFullScreen style={{ border: 0 }} />
                </div>
              ) : (
                <a href={lecture.videoUrl} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-3 p-4 transition hover:bg-paper-2">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl text-accent-contrast"
                    style={{ background: color }}><Icon name="play" size={18} /></span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-semibold text-ink">Watch the lecture video</p>
                    <p className="truncate text-[12px] text-faint">{lecture.videoUrl}</p>
                  </div>
                  <Icon name="arrow-right" size={16} className="text-faint" />
                </a>
              )}
            </Card>
          )}

          <Card className="p-6 sm:p-8">
            {hasNotes ? (
              <>
                <div className="mb-4 flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-faint">
                    <Icon name="book" size={13} /> Part {(step.sliceIndex ?? 0) + 1} of {readCount}
                  </span>
                  <span className="inline-flex items-center gap-1 text-[11px] text-faint">
                    <Icon name="clock" size={12} /> {estimateReadMinutes(slices[step.sliceIndex ?? 0].text)} min read
                  </span>
                </div>
                <Prose text={slices[step.sliceIndex ?? 0].text} />
              </>
            ) : (
              <div className="py-6 text-center">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-soft text-accent-ink">
                  <Icon name="book" size={26} />
                </div>
                <p className="font-display text-lg font-semibold text-ink">No notes were included</p>
                <p className="mx-auto mt-1.5 max-w-sm text-[14px] leading-relaxed text-muted">
                  This lecture came without readable notes. Review the video above or your own materials,
                  then test yourself with the quiz.
                </p>
              </div>
            )}
          </Card>

          <div className="mt-5 flex items-center gap-3">
            {stepIdx > 0 && steps[stepIdx - 1].kind === 'read' && (
              <Button variant="outline" icon={<Icon name="arrow-left" size={16} />} onClick={() => goToStep(stepIdx - 1)}>
                Back
              </Button>
            )}
            <Button full size="lg" icon={<Icon name="arrow-right" size={17} />} onClick={() => goToStep(stepIdx + 1)}>
              {hasNotes && (step.sliceIndex ?? 0) < readCount - 1
                ? 'Continue reading'
                : steps[stepIdx + 1]?.kind === 'quiz' ? 'Start the quiz'
                : steps[stepIdx + 1]?.kind === 'practice' ? 'Go to practice'
                : 'Finish lesson'}
            </Button>
          </div>
        </div>
      )}

      {step.kind === 'quiz' && (
        <Card key={stepIdx} className="p-6 sm:p-8">
          <QuizBlock questions={seg.quiz} color={color} onComplete={handleQuizDone} />
        </Card>
      )}

      {step.kind === 'practice' && (
        <div key={stepIdx}>
          {seg.quiz.length > 0 && (
            <div className="mb-5 flex items-center gap-2.5 rounded-xl border border-ok/25 bg-ok-soft px-4 py-3">
              <Icon name="check" size={16} className="text-ok" strokeWidth={2.5} />
              <p className="text-[13px] font-medium text-ink">
                Quiz complete — {quizScore} of {seg.quiz.length} correct. Now lock it in with practice.
              </p>
            </div>
          )}
          <Card className="p-6 sm:p-8">
            <TaskBlock tasks={seg.tasks} onComplete={handlePracticeDone} />
          </Card>
        </div>
      )}

      {step.kind === 'done' && (
        <Card glow={color} className="p-8 text-center sm:p-10 animate-scale-in">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl animate-pop"
            style={{ background: `color-mix(in oklab, ${color} 16%, transparent)`, color }}>
            <Icon name="check" size={32} strokeWidth={2.5} />
          </div>
          <h2 className="font-display text-2xl font-semibold text-ink">Lesson complete</h2>
          <p className="mx-auto mt-2 max-w-sm text-[14px] text-muted">
            {seg.quiz.length > 0
              ? <>You scored <span className="font-semibold text-ink">{quizScore}/{seg.quiz.length}</span> on the quiz{seg.tasks.length ? ' and finished every practice task.' : '.'}</>
              : 'Nice work getting through this one.'}
          </p>

          <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button variant="outline" size="lg" onClick={() => finish('course')}>Back to course</Button>
            {nextSegId
              ? <Button size="lg" icon={<Icon name="arrow-right" size={17} />} onClick={() => finish('next')}>Next lesson</Button>
              : <Button size="lg" icon={<Icon name="check" size={17} strokeWidth={2.5} />} onClick={() => finish('course')}>Save &amp; finish</Button>}
          </div>
        </Card>
      )}
    </div>
  )
}
