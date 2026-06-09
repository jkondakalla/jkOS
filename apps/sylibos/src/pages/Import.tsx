import { useState, useRef, useCallback } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { parseCourseZip, type ParseProgress } from '../lib/courseParser'
import { generateLessonContent } from '../lib/aiService'
import { useAppStore } from '../store/appStore'
import { Card, Icon, Bar, cx } from '../components/ui'
import type { Segment } from '../types'

const randomId = () => crypto.randomUUID()

export default function Import() {
  const navigate = useNavigate()
  const { settings, addCourse, addSegment } = useAppStore()
  const [dragging, setDragging] = useState(false)
  const [progress, setProgress] = useState<ParseProgress | null>(null)
  const [gen, setGen] = useState<{ current: number; total: number; title: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const busy = (progress !== null && progress.stage !== 'done') || gen !== null

  const handleFile = useCallback(async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.zip')) {
      setError('That is not a ZIP. Download the course as a .zip from MIT OpenCourseWare.')
      return
    }
    setError(null)
    try {
      const course = await parseCourseZip(file, settings, setProgress)
      if (course.lectures.length === 0) {
        setError('No lectures were found in that ZIP. Make sure it is a full MIT OCW course download.')
        setProgress(null)
        return
      }
      addCourse(course)

      setGen({ current: 0, total: course.lectures.length, title: '' })
      for (let i = 0; i < course.lectures.length; i++) {
        const lec = course.lectures[i]
        setGen({ current: i + 1, total: course.lectures.length, title: lec.title })
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
      setGen(null)
      navigate(`/course/${course.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to read that ZIP file.')
      setProgress(null)
      setGen(null)
    }
  }, [settings, addCourse, addSegment, navigate])

  return (
    <div className="mx-auto max-w-2xl px-4 sm:px-6 py-8 sm:py-10">
      <header className="mb-7 animate-fade-up">
        <h1 className="font-display text-[30px] font-semibold tracking-[-0.02em] text-ink">Import a course</h1>
        <p className="mt-2 text-[15px] text-muted">
          Drop in a course ZIP from{' '}
          <a href="https://ocw.mit.edu" target="_blank" rel="noopener noreferrer"
            className="font-semibold text-accent-ink hover:underline">MIT OpenCourseWare</a>
          . SylibOS pulls out the lectures and splits each one into short, followable parts.
        </p>
      </header>

      <div
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f && !busy) handleFile(f) }}
        onClick={() => !busy && inputRef.current?.click()}
        className={cx(
          'relative flex flex-col items-center justify-center rounded-card border-2 border-dashed px-6 py-14 text-center transition',
          busy ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
          dragging ? 'border-accent bg-accent-soft' : 'border-line-strong bg-card hover:border-faint hover:bg-paper-2',
        )}>
        <input ref={inputRef} type="file" accept=".zip" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
        <span className={cx(
          'mb-4 flex h-16 w-16 items-center justify-center rounded-2xl transition',
          dragging ? 'bg-accent text-accent-contrast' : 'bg-accent-soft text-accent-ink',
        )}>
          <Icon name="upload" size={28} />
        </span>
        <p className="font-display text-lg font-semibold text-ink">
          {dragging ? 'Drop to import' : 'Drop your MIT OCW ZIP here'}
        </p>
        <p className="mt-1 text-[13px] text-muted">or click to browse your files</p>
      </div>

      {error && (
        <div className="mt-5 flex items-start gap-2.5 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 animate-fade-in">
          <Icon name="x" size={16} className="mt-0.5 shrink-0 text-danger" strokeWidth={2.5} />
          <p className="text-[13px] text-ink">{error}</p>
        </div>
      )}

      {progress && progress.stage !== 'done' && (
        <Card className="mt-5 p-5 animate-fade-in">
          <div className="mb-3 flex items-center gap-2.5">
            <Icon name="layers" size={16} className="text-accent-ink" />
            <p className="text-[13px] font-semibold text-ink">Reading the course</p>
          </div>
          <p className="mb-3 text-[13px] text-muted">{progress.message}</p>
          <Bar value={progress.total > 0 ? progress.current / progress.total : 0.05} height={6} />
        </Card>
      )}

      {gen && (
        <Card className="mt-5 p-5 animate-fade-in">
          <div className="mb-3 flex items-center gap-2.5">
            <Icon name="sparkles" size={16} className="text-accent-ink" />
            <p className="text-[13px] font-semibold text-ink">Building lessons</p>
            <span className="ml-auto text-[12px] tabular-nums text-faint">{gen.current}/{gen.total}</span>
          </div>
          {gen.title && <p className="mb-3 truncate text-[12px] text-muted">{gen.title}</p>}
          <Bar value={gen.total ? gen.current / gen.total : 0} height={6} />
          {settings.aiProvider === 'none' && (
            <p className="mt-3 text-[11px] text-faint">
              No AI provider connected — placeholder quizzes are being used.{' '}
              <Link to="/settings" className="font-semibold text-accent-ink hover:underline">Connect one in Settings</Link>
              {' '}for real questions.
            </p>
          )}
        </Card>
      )}

      {!busy && (
        <Card className="mt-7 p-6">
          <h3 className="mb-4 text-[12px] font-bold uppercase tracking-[0.1em] text-faint">
            Getting a course ZIP
          </h3>
          <ol className="space-y-3">
            {[
              <>Open <a href="https://ocw.mit.edu" target="_blank" rel="noopener noreferrer" className="font-semibold text-accent-ink hover:underline">ocw.mit.edu</a> and pick any course.</>,
              <>On the course page, find <span className="font-medium text-ink">"Download course"</span> (often under the course menu or resources).</>,
              <>Download the <span className="font-medium text-ink">.zip</span> of all course materials.</>,
              <>Drop that ZIP above. Lecture notes, videos, and structure are detected automatically.</>,
            ].map((text, i) => (
              <li key={i} className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[12px] font-bold text-accent-ink">
                  {i + 1}
                </span>
                <span className="text-[14px] leading-relaxed text-muted">{text}</span>
              </li>
            ))}
          </ol>
        </Card>
      )}
    </div>
  )
}
