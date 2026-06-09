import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EmptyState, Icon, Spinner } from '../components/ui'
import { useNavigate } from 'react-router-dom'
import { useAppStore } from '../store/appStore'
import { useAuthStore } from '../store/authStore'
import {
  addLibraryCourse,
  getLibraryCourse,
  uploadCourseManifest,
  type LibraryCourse,
  type LibraryCoursePreview,
  listLibrary,
} from '../lib/libraryApi'

// ---------------------------------------------------------------------------
// Types & helpers
// ---------------------------------------------------------------------------

type SortKey = 'catalogue' | 'az' | 'lessons' | 'newest'

const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: 'catalogue', label: 'Catalogue order' },
  { value: 'az',        label: 'Title A → Z' },
  { value: 'lessons',   label: 'Most lessons' },
  { value: 'newest',    label: 'Newest term' },
]

const SUBJECT_COLORS: Record<string, string> = {
  'Mathematics':                'var(--color-u3)',
  'Physics':                    'var(--color-u6)',
  'Economics':                  'var(--color-u4)',
  'Brain & Cognitive Sciences': 'var(--color-u5)',
  'Computer Science':           'var(--color-u2)',
  'Chemistry':                  'var(--color-u1)',
  'Biology':                    'var(--color-u7)',
  'Engineering':                'var(--color-u8)',
}

function subjectColor(subject: string): string {
  if (SUBJECT_COLORS[subject]) return SUBJECT_COLORS[subject]
  let h = 0
  for (let i = 0; i < subject.length; i++) h = ((h << 5) - h + subject.charCodeAt(i)) | 0
  return `var(--color-u${(Math.abs(h) % 8) + 1})`
}

function yearOf(term: string): number {
  const m = /\d{4}/.exec(term || '')
  return m ? +m[0] : 0
}

function truncate(text: string, max: number) {
  if (text.length <= max) return text
  return text.slice(0, max).replace(/\s\S*$/, '') + '…'
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function Library() {
  const { user } = useAuthStore()
  const [courses, setCourses] = useState<LibraryCourse[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [subject, setSubject] = useState<string>('All')
  const [query, setQuery] = useState('')
  const [videoOnly, setVideoOnly] = useState(false)
  const [sort, setSort] = useState<SortKey>('catalogue')
  const [preview, setPreview] = useState<string | null>(null)
  const [showUpload, setShowUpload] = useState(false)

  const reload = () => {
    setLoading(true)
    listLibrary()
      .then(setCourses)
      .catch(e => setError(e.message ?? 'Failed to load library'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { reload() }, [])

  const subjects = useMemo(
    () => ['All', ...Array.from(new Set(courses.map(c => c.subject).filter(Boolean))).sort()],
    [courses],
  )

  const filtered = useMemo(() => {
    let list = courses.slice()
    if (subject !== 'All') list = list.filter(c => c.subject === subject)
    if (videoOnly) list = list.filter(c => c.hasVideo)
    const q = query.trim().toLowerCase()
    if (q) list = list.filter(c =>
      `${c.title} ${c.courseNumber} ${c.subject} ${c.description}`.toLowerCase().includes(q))
    if (sort === 'az')      list.sort((a, b) => a.title.localeCompare(b.title))
    else if (sort === 'lessons') list.sort((a, b) => b.lectureCount - a.lectureCount)
    else if (sort === 'newest')  list.sort((a, b) => yearOf(b.term) - yearOf(a.term))
    return list
  }, [courses, subject, query, videoOnly, sort])

  const markAdded = (slug: string) =>
    setCourses(prev => prev.map(c => c.slug === slug ? { ...c, added: true } : c))

  const isAdmin = user?.role === 'admin'

  if (loading) return (
    <div className="lib">
      <div className="flex min-h-64 items-center justify-center"><Spinner size={28} /></div>
    </div>
  )
  if (error) return (
    <div className="lib">
      <EmptyState icon="x" title="Could not load library" body={error} action={
        <button className="btn btn-ghost btn-sm" onClick={reload}>Try again</button>
      } />
    </div>
  )

  const countLabel = `${filtered.length} ${filtered.length === 1 ? 'course' : 'courses'}${subject !== 'All' ? ` in ${subject}` : ''}`

  return (
    <div className="lib">
      <header className="lib-head">
        <div className="lib-head-row">
          <div>
            <p className="lib-eyebrow">Course Library</p>
            <h1 className="lib-title">Explore the Catalog</h1>
            <p className="lib-sub">
              Add a course to your learning plan to begin studying with daily quizzes and reading slices.
            </p>
          </div>
          {isAdmin && (
            <button className="btn btn-ghost btn-sm" style={{ whiteSpace: 'nowrap', marginTop: '.25rem' }} onClick={() => setShowUpload(true)}>
              <Icon name="upload" size={14} /> Upload Course
            </button>
          )}
        </div>
      </header>

      <LibraryControls
        subjects={subjects}
        subject={subject} onSubject={setSubject}
        query={query} onQuery={setQuery}
        videoOnly={videoOnly} onVideoOnly={setVideoOnly}
        sort={sort} onSort={setSort}
      />

      <p className="lib-count">{countLabel}</p>

      {filtered.length === 0 ? (
        <EmptyState icon="search" title="No courses match"
          body={isAdmin ? 'Try clearing the filter, or upload a manifest above.' : 'Try clearing the subject filter or search.'} />
      ) : (
        <div className="lib-grid">
          {filtered.map(course => (
            <CourseCard
              key={course.slug}
              course={course}
              onPreview={() => setPreview(course.slug)}
              onAdded={markAdded}
            />
          ))}
        </div>
      )}

      {preview && (
        <PreviewModal
          slug={preview}
          isAdded={courses.find(c => c.slug === preview)?.added ?? false}
          onClose={() => setPreview(null)}
          onAdded={markAdded}
        />
      )}

      {showUpload && (
        <UploadModal
          onClose={() => setShowUpload(false)}
          onUploaded={() => { setShowUpload(false); reload() }}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Controls (search + video toggle + sort + subject filter)
// ---------------------------------------------------------------------------

function LibraryControls({
  subjects, subject, onSubject,
  query, onQuery,
  videoOnly, onVideoOnly,
  sort, onSort,
}: {
  subjects: string[]
  subject: string; onSubject: (s: string) => void
  query: string; onQuery: (q: string) => void
  videoOnly: boolean; onVideoOnly: (v: boolean) => void
  sort: SortKey; onSort: (s: SortKey) => void
}) {
  return (
    <div className="lib-controls">
      <div className="lib-controls-row">
        <div className="lib-search">
          <Icon name="search" size={16} />
          <input
            value={query}
            onChange={e => onQuery(e.target.value)}
            placeholder="Search by title, number…"
            aria-label="Search courses"
          />
        </div>
        <button
          className={`lib-toggle${videoOnly ? ' on' : ''}`}
          onClick={() => onVideoOnly(!videoOnly)}
          aria-pressed={videoOnly}
        >
          <Icon name="play" size={13} /> Video
        </button>
        <select
          className="lib-select"
          value={sort}
          onChange={e => onSort(e.target.value as SortKey)}
          aria-label="Sort courses"
        >
          {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      {subjects.length > 2 && (
        <div className="lib-filters" role="group" aria-label="Filter by subject">
          {subjects.map(s => (
            <button
              key={s}
              className={`lib-filter-btn${s === subject ? ' active' : ''}`}
              onClick={() => onSubject(s)}
              aria-pressed={s === subject}
            >
              {s !== 'All' && (
                <span className="lib-filter-dot" style={{ background: subjectColor(s) }} />
              )}
              {s === 'All' ? 'All subjects' : s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Course card (reading-room style)
// ---------------------------------------------------------------------------

function CourseCard({
  course, onPreview, onAdded,
}: { course: LibraryCourse; onPreview: () => void; onAdded: (slug: string) => void }) {
  const navigate = useNavigate()
  const hydrate = useAppStore(s => s.hydrate)
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const color = subjectColor(course.subject)

  const handleAdd = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (course.added || adding) return
    setAdding(true)
    setAddError(null)
    try {
      const result = await addLibraryCourse(course.slug)
      onAdded(course.slug)
      await hydrate()
      navigate(`/course/${result.courseId}`)
    } catch (err: any) {
      setAdding(false)
      setAddError(err?.message ?? 'Failed to add course')
    }
  }, [course.added, course.slug, adding, navigate, onAdded, hydrate])

  return (
    <article
      className="a-card papered"
      style={{ '--c': color } as React.CSSProperties}
      role="button"
      tabIndex={0}
      onClick={onPreview}
      onKeyDown={e => e.key === 'Enter' && onPreview()}
    >
      {/* Cover plate */}
      <div className="a-thumb">
        <span className="a-thumb-num">{course.courseNumber || course.subject.slice(0, 6)}</span>
      </div>

      {/* Body */}
      <div className="a-body">
        <div className="a-meta">
          <span className="a-dept">{course.subject}</span>
          {course.hasVideo && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.25rem', fontSize: 11, fontWeight: 700, color: 'var(--color-accent-ink)', background: 'var(--color-accent-soft)', padding: '.1rem .5rem', borderRadius: 999 }}>
              <Icon name="play" size={10} /> Video
            </span>
          )}
        </div>
        <h3 className="a-title">{course.title}</h3>
        <p className="a-num">{[course.courseNumber, course.term].filter(Boolean).join(' · ')}</p>
        {course.description && (
          <p className="a-blurb">{truncate(course.description, 130)}</p>
        )}
        <div className="a-foot">
          <span className="a-count">
            <Icon name="layers" size={14} />
            {course.lectureCount} {course.lectureCount === 1 ? 'lesson' : 'lessons'}
          </span>
          {course.added ? (
            <button className="btn btn-soft btn-sm" disabled>
              <Icon name="check" size={14} /> Added
            </button>
          ) : (
            <button
              className="btn btn-primary btn-sm"
              onClick={handleAdd}
              disabled={adding}
              aria-label={`Add ${course.title}`}
            >
              {adding ? <Spinner size={13} /> : <Icon name="plus" size={14} />}
              {adding ? 'Adding…' : 'Add'}
            </button>
          )}
        </div>
        {addError && (
          <p style={{ fontSize: 11, color: 'var(--color-danger)', marginTop: '.35rem', padding: '0 .25rem' }}>{addError}</p>
        )}
      </div>
    </article>
  )
}

// ---------------------------------------------------------------------------
// Preview modal (reading-room style)
// ---------------------------------------------------------------------------

function PreviewModal({
  slug, isAdded, onClose, onAdded,
}: { slug: string; isAdded: boolean; onClose: () => void; onAdded: (slug: string) => void }) {
  const navigate = useNavigate()
  const hydrate = useAppStore(s => s.hydrate)
  const [data, setData] = useState<LibraryCoursePreview | null>(null)
  const [loadingPreview, setLoadingPreview] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const backdropRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setLoadingPreview(true); setFetchError(null)
    getLibraryCourse(slug)
      .then(setData)
      .catch(e => { setData(null); setFetchError(e?.message ?? 'Failed to load preview') })
      .finally(() => setLoadingPreview(false))
  }, [slug])

  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])

  const handleAdd = useCallback(async () => {
    if (isAdded || adding || !data) return
    setAdding(true)
    setAddError(null)
    try {
      const result = await addLibraryCourse(slug)
      onAdded(slug)
      onClose()
      await hydrate()
      navigate(`/course/${result.courseId}`)
    } catch (err: any) {
      setAdding(false)
      setAddError(err?.message ?? 'Failed to add course')
    }
  }, [isAdded, adding, data, slug, navigate, onAdded, onClose, hydrate])

  const color = data ? subjectColor(data.subject) : 'var(--color-accent)'

  return (
    <div
      ref={backdropRef}
      className="modal-back"
      onClick={e => e.target === backdropRef.current && onClose()}
      role="dialog"
      aria-modal
      aria-label="Course preview"
    >
      <div className="modal papered" style={{ '--c': color } as React.CSSProperties}>
        <button className="modal-close" onClick={onClose} aria-label="Close">
          <Icon name="x" size={18} />
        </button>

        {loadingPreview && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem 0' }}>
            <Spinner size={26} />
          </div>
        )}

        {!loadingPreview && !data && (
          <p style={{ color: 'var(--color-muted)', textAlign: 'center', padding: '2rem 0' }}>
            {fetchError ?? 'Could not load course preview.'}
          </p>
        )}

        {!loadingPreview && data && (
          <>
            {/* Full-width cover plate at top */}
            <div className="modal-thumb-full">
              <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.8rem', fontWeight: 600, letterSpacing: '-.02em', color: `color-mix(in oklab, ${color} 70%, var(--color-ink))`, position: 'relative', zIndex: 1 }}>
                {data.courseNumber || data.subject.slice(0, 6)}
              </span>
            </div>

            <div className="modal-deck">
              <span className="modal-dept">{data.subject}</span>
              {data.lectureCount > 0 && (
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-accent-ink)', background: 'var(--color-accent-soft)', padding: '.1rem .5rem', borderRadius: 999 }}>
                  {data.lectureCount} lessons
                </span>
              )}
            </div>

            <h2 className="modal-title">{data.title}</h2>
            <p className="modal-sub">
              {[data.courseNumber, data.instructor].filter(Boolean).join(' · ')}
            </p>
            {data.description && (
              <p className="modal-desc">{data.description}</p>
            )}

            {/* Facts grid */}
            <div className="modal-facts">
              {[
                { k: 'Instructor', v: data.instructor },
                { k: 'Level',      v: data.level },
                { k: 'Term',       v: data.term },
                { k: 'Lessons',    v: String(data.lectureCount) },
              ].filter(f => f.v).map(f => (
                <div key={f.k}>
                  <p className="fact-k">{f.k}</p>
                  <p className="fact-v">{f.v}</p>
                </div>
              ))}
            </div>

            {/* TOC */}
            <p className="modal-toc-h">
              {data.units.length} {data.units.length === 1 ? 'unit' : 'units'} · {data.lectureCount} lessons
            </p>
            <div className="modal-toc">
              {data.units.map((unit, ui) => (
                <div key={ui}>
                  {unit.title && (
                    <p className="toc-unit-title">
                      <span className="toc-unit-dot" />
                      {unit.title}
                    </p>
                  )}
                  <ul className="toc-list">
                    {unit.lectures.map((lec, li) => (
                      <li key={li} className="toc-li">
                        {lec.hasVideo && <Icon name="play" size={11} />}
                        {lec.title}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>

            {addError && (
              <p style={{ fontSize: 12, color: 'var(--color-danger)', margin: '0 0 .75rem' }}>{addError}</p>
            )}
            <div className="modal-actions">
              <button className="btn btn-ghost btn-md" onClick={onClose}>Close</button>
              {isAdded ? (
                <button className="btn btn-soft btn-md" disabled>
                  <Icon name="check" size={15} /> In your plan
                </button>
              ) : (
                <button className="btn btn-primary btn-md" onClick={handleAdd} disabled={adding}>
                  {adding ? <Spinner size={14} /> : <Icon name="plus" size={15} />}
                  {adding ? 'Adding…' : `Add ${data.lectureCount} lessons`}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Upload modal (admin only — kept from previous implementation)
// ---------------------------------------------------------------------------

function UploadModal({ onClose, onUploaded }: { onClose: () => void; onUploaded: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const backdropRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<'idle' | 'uploading' | 'done' | 'error'>('idle')
  const [message, setMessage] = useState('')
  const [fileName, setFileName] = useState('')

  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])

  const handleFileChange = () => {
    const f = fileRef.current?.files?.[0]
    setFileName(f?.name ?? '')
    setStatus('idle'); setMessage('')
  }

  const handleUpload = async () => {
    const file = fileRef.current?.files?.[0]
    if (!file) return
    setStatus('uploading'); setMessage('')
    try {
      const manifest = JSON.parse(await file.text())
      const result = await uploadCourseManifest(manifest)
      setStatus('done')
      setMessage(`"${manifest.meta?.title ?? result.slug}" uploaded — ${result.lectureCount} lecture${result.lectureCount !== 1 ? 's' : ''} added to the catalog.`)
    } catch (e: any) {
      setStatus('error')
      setMessage(e.message ?? 'Upload failed')
    }
  }

  return (
    <div
      ref={backdropRef}
      className="modal-back"
      onClick={e => e.target === backdropRef.current && onClose()}
      role="dialog"
      aria-modal
      aria-label="Upload course manifest"
    >
      <div className="modal papered">
        <button className="modal-close" onClick={onClose} aria-label="Close">
          <Icon name="x" size={18} />
        </button>

        <div style={{ marginBottom: '1.25rem' }}>
          <h2 className="modal-title" style={{ paddingRight: 0 }}>Upload Course Manifest</h2>
          <p className="modal-sub">
            Select a <code style={{ fontFamily: 'monospace', fontSize: '.8125rem' }}>.json</code> file from <code style={{ fontFamily: 'monospace', fontSize: '.8125rem' }}>CourseProcessor/TEMPLATE.manifest.json</code>.
          </p>
        </div>

        <div className="library-upload-area">
          <label htmlFor="manifest-upload" className={`library-upload-label${fileName ? ' has-file' : ''}`}>
            <Icon name={fileName ? 'layers' : 'upload'} size={20} />
            <span>{fileName || 'Choose manifest .json'}</span>
          </label>
          <input
            ref={fileRef} id="manifest-upload" type="file"
            accept=".json,application/json"
            className="library-upload-input"
            onChange={handleFileChange}
          />
        </div>

        {status === 'done'  && <p className="library-upload-feedback library-upload-success">{message}</p>}
        {status === 'error' && <p className="library-upload-feedback library-upload-error">{message}</p>}

        <div className="modal-actions">
          {status === 'done' ? (
            <button className="btn btn-primary btn-md" onClick={onUploaded}>Done</button>
          ) : (
            <>
              <button className="btn btn-ghost btn-md" onClick={onClose}>Cancel</button>
              <button
                className="btn btn-primary btn-md"
                onClick={handleUpload}
                disabled={!fileName || status === 'uploading'}
              >
                {status === 'uploading' ? <Spinner size={14} /> : <Icon name="upload" size={14} />}
                {status === 'uploading' ? 'Uploading…' : 'Upload'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
