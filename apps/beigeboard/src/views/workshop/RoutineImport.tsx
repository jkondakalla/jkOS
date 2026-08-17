/**
 * RoutineImport — paste a routine in, get a routine out.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A PASTE PANE AT ALL
 *
 * The forge builds a document a field at a time, which is right for editing one and
 * slow for creating five. The import contract has existed since the primitive
 * shipped — one flat JSON document, idempotent by slug, shaped end to end around an
 * author who is a language model — and until now it had no door in the UI. It was a
 * `curl` feature in an app whose whole point is that you do not have to.
 *
 * So: paste the document, see what it will do, then let it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE THREE THINGS THAT MAKE PASTED JSON ACTUALLY WORK
 *
 *   1. IT ACCEPTS WHAT WAS ACTUALLY COPIED. An assistant returns a fenced ```json
 *      block, often with a sentence before it. A pane that rejects that is a pane
 *      that makes the user edit JSON by hand before it will look at it — which is
 *      the exact work it exists to remove. So the text is UNWRAPPED first: fences
 *      off, prose either side trimmed to the outermost braces, and — announced, not
 *      silent — trailing commas repaired, because that is the one malformation
 *      models produce often enough to be worth forgiving.
 *
 *   2. IT SHOWS YOU THE FUTURE BEFORE IT WRITES. `?dryRun=1` renders the first four
 *      sessions of every routine as NUMBERS. A progression rule is a claim about the
 *      future that is very easy to get wrong in a way no validator can catch:
 *      `+10 lb a session` is legal, plausible, and has you squatting 400 lb by
 *      November. Nothing in the document shows you that; four rendered sessions do,
 *      at a glance. This is the single most useful thing on the screen.
 *
 *   3. IT DISTINGUISHES ERRORS FROM LINT. Errors are refusals with a path you can
 *      go and fix. Warnings mean it was ACCEPTED and is probably thin — no step in
 *      this routine ever gets harder, this count has no cap — which is the failure
 *      an AI author actually has. Collapsing the two into "problems" would bury the
 *      common case under the rare one.
 *
 * A FULL PANE, NOT AN OVERLAY — the same call the forge makes, for the same reason
 * (see its header, and the .jk-panel note in hub.css).
 */
import React, { useMemo, useRef, useState } from 'react'
import { FONT_HEAD } from '../../lib/theme'
import { Bubble, Rule, TButton, Well, Chip } from '@jkos/ui'
import { MONO, TextArea } from './parts'

/* ── Getting an object out of whatever was on the clipboard ───────────────── */

type Extracted = { value: any; repaired: string[] } | { error: string }

/** Unwrap, then parse. Every step is reported (`repaired`) rather than done
 *  quietly: the user is about to write rows off the back of this, and "we silently
 *  changed your text" is not a thing an import should ever do without saying. */
export function extractJson(raw: string): Extracted {
  const repaired: string[] = []
  let text = String(raw || '').trim()
  if (!text) return { error: 'nothing pasted yet' }

  // 1. A fenced block, with or without a language tag — what an assistant returns.
  const fence = text.match(/```(?:json|jsonc|js)?\s*([\s\S]*?)```/i)
  if (fence) {
    text = fence[1].trim()
    repaired.push('unwrapped a fenced code block')
  }

  // 2. Prose either side of the object. Trim to the outermost braces/brackets.
  const first = text.search(/[[{]/)
  const lastCurly = text.lastIndexOf('}')
  const lastSquare = text.lastIndexOf(']')
  const last = Math.max(lastCurly, lastSquare)
  if (first > 0 || (last >= 0 && last < text.length - 1)) {
    if (first >= 0 && last > first) {
      text = text.slice(first, last + 1)
      repaired.push('trimmed the text either side of the document')
    }
  }

  const attempt = (s: string) => { try { return { ok: true, value: JSON.parse(s) } } catch (e: any) { return { ok: false, error: e } } }

  let got = attempt(text)
  if (!got.ok) {
    // 3. Trailing commas — the one malformation a model produces often enough to
    //    be worth repairing. Strictly `,` followed by only whitespace and a closer;
    //    it cannot change the meaning of valid JSON.
    const fixed = text.replace(/,(\s*[}\]])/g, '$1')
    if (fixed !== text) {
      const second = attempt(fixed)
      if (second.ok) { repaired.push('removed trailing commas'); got = second; text = fixed }
    }
  }
  if (!got.ok) {
    const msg = String(got.error?.message || 'could not parse')
    /* Where it broke. Three engines say this three ways and only one of them is
       useful as written, so all three are unpicked into a line and a column:
         · older V8   "…in JSON at position 42"
         · modern V8  "Unexpected token '}', ...\"{ \"slug\": }\"... is not valid
                       JSON" — no position, but the snippet is a literal substring
                       of the input, so it can be FOUND
         · Firefox    already says line and column; left alone. */
    if (/line \d+ column \d+/i.test(msg)) return { error: msg }

    const byPosition = msg.match(/position (\d+)/)
    const bySnippet = msg.match(/(?:\.\.\.)?"([\s\S]*?)"(?:\.\.\.)? is not valid JSON/)
    const pos = byPosition ? Number(byPosition[1])
      : bySnippet ? text.indexOf(bySnippet[1])
      : -1

    const clean = msg
      .replace(/,?\s*(?:\.\.\.)?"[\s\S]*" is not valid JSON$/, '')
      .replace(/ in JSON at position \d+$/, '')
      .trim() || 'could not parse'

    if (pos < 0) return { error: clean }
    const before = text.slice(0, pos)
    const line = before.split('\n').length
    const col = pos - before.lastIndexOf('\n')
    return { error: `${clean} — line ${line}, column ${col}` }
  }
  if (!got.value || typeof got.value !== 'object') return { error: 'that parsed, but it is not an object or an array' }
  return { value: got.value, repaired }
}

/** What the pasted object claims to be, before the server sees it. Local, so the
 *  pane can say "2 entries, 1 routine" the instant you paste rather than after a
 *  round trip. Mirrors readBundle() on the server. */
function describe(doc: any): { entries: number; routines: number; titles: string[] } {
  if (!doc) return { entries: 0, routines: 0, titles: [] }
  const isRoutine = (x: any) => x && typeof x === 'object' && (x.spec || x.steps || x.days || x.cadence || x.slug)
  if (Array.isArray(doc)) {
    const routines = doc.filter((x) => x && typeof x === 'object' && (x.spec || x.steps || x.days || x.cadence))
    return { entries: doc.length - routines.length, routines: routines.length, titles: routines.map((r) => r.title || r.slug) }
  }
  const entries = Array.isArray(doc.library) ? doc.library : Array.isArray(doc.entries) ? doc.entries : []
  let routines = Array.isArray(doc.routines) ? doc.routines : []
  if (!routines.length && isRoutine(doc)) routines = [doc]
  if (doc.routine) routines = [doc.routine, ...routines]
  return { entries: entries.length, routines: routines.length, titles: routines.map((r: any) => r?.title || r?.slug || 'untitled') }
}

const EXAMPLE = `{
  "kind": "jkos.beigeboard.bundle",
  "library": [
    {
      "collection": "exercise",
      "slug": "nordic-curl",
      "title": "Nordic Curl",
      "unit": "reps",
      "load_unit": "bw",
      "variants": ["Band-Assisted Nordic", "Eccentric-Only Nordic", "Nordic Curl"],
      "defaults": { "sets": 3, "target": 5, "rest": 120, "variant_index": 1 }
    }
  ],
  "routines": [
    {
      "slug": "posterior-chain",
      "title": "Posterior Chain",
      "days": ["tue", "fri"],
      "time": "07:00",
      "spec": {
        "intent": "hamstrings that survive a sprint",
        "deload_every": 5,
        "steps": [
          { "ref": "mobility-flow", "block": "warmup", "target": 6 },
          { "ref": "deadlift", "sets": 3, "load": 155,
            "progression": { "type": "double", "range": [3, 5], "increment": 10, "cap": 315 } },
          { "ref": "nordic-curl",
            "progression": { "type": "linear", "drives": "target", "increment": 1, "cap": 8 } },
          { "ref": "plank", "block": "cooldown", "sets": 2, "target": 40,
            "progression": { "type": "linear", "drives": "target", "increment": 5, "cap": 120 } }
        ],
        "contributes": { "measure": "sessions", "target": 8, "window": "month" }
      }
    }
  ]
}`

export function RoutineImport({ api, readonly, onClose, onImported }: any) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState<null | 'check' | 'import' | 'prompt'>(null)
  const [result, setResult] = useState<any>(null)
  const [failure, setFailure] = useState<any>(null)
  const [prompt, setPrompt] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [dragging, setDragging] = useState(false)
  const areaRef = useRef<HTMLTextAreaElement>(null)

  /* Parsed on every keystroke. Cheap (a paste is a few KB), and it means the pane
     tells you it is looking at two library entries and one routine before you have
     asked it anything. */
  const parsed = useMemo(() => (text.trim() ? extractJson(text) : null), [text])
  const doc = parsed && 'value' in parsed ? parsed.value : null
  const shape = useMemo(() => describe(doc), [doc])

  const send = async (dryRun: boolean) => {
    if (!doc || readonly) return
    setBusy(dryRun ? 'check' : 'import')
    setFailure(null)
    try {
      const res = await api.post(`/api/routines/bundle${dryRun ? '?dryRun=1' : ''}`, doc)
      if (!res || res.ok !== true) { setFailure(res || { error: 'no response' }); setResult(null); return }
      setResult(res)
      if (!dryRun) onImported?.(res)
    } catch (e: any) {
      setFailure({ error: e?.message || 'the import failed' })
    } finally { setBusy(null) }
  }

  const getPrompt = async () => {
    setBusy('prompt')
    try {
      const r = await api.get(`/api/routines/prompt?origin=${encodeURIComponent(window.location.origin)}`)
      const t = r?.text || ''
      setPrompt(t)
      try {
        await navigator.clipboard.writeText(t)
        setCopied(true)
        setTimeout(() => setCopied(false), 2600)
      } catch { /* no clipboard permission — the text is on screen to copy by hand */ }
    } catch { setPrompt('could not fetch the prompt') } finally { setBusy(null) }
  }

  const downloadPrompt = () => {
    if (!prompt) return
    const blob = new Blob([prompt], { type: 'text/markdown' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'beigeboard-routine-prompt.md'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragging(false)
    const file = e.dataTransfer?.files?.[0]
    if (!file) return
    file.text().then((t) => { setText(t); setResult(null); setFailure(null) })
  }

  const errors: any[] = Array.isArray(failure?.errors) ? failure.errors : []
  const warnings: any[] = Array.isArray(result?.warnings) ? result.warnings : []

  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* ── Head ── */}
      <div className="mo-item" style={{ flex: 'none', padding: '16px 28px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
          <span className="jk-lab jk-lab-xs" style={{ color: 'var(--color-accent)' }}>PASTE</span>
          <span className="mono-eyebrow">A DOCUMENT IN · A ROUTINE OUT · CHECKED BEFORE ANYTHING IS WRITTEN</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, marginTop: 12, flexWrap: 'wrap' }}>
          <span style={{ fontFamily: FONT_HEAD, fontWeight: 700, fontSize: '1.85rem', lineHeight: 1, letterSpacing: '-0.02em' }}>
            Import a routine
          </span>
          <span className="mono-eyebrow" style={{ marginBottom: 5 }}>
            {doc
              ? `${String(shape.routines).padStart(2, '0')} ROUTINE${shape.routines === 1 ? '' : 'S'} · ${String(shape.entries).padStart(2, '0')} LIBRARY ENTRIES`
              : 'JSON — FENCED OR BARE'}
          </span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
            <TButton quiet onClick={getPrompt} disabled={busy === 'prompt'}
              title="The instructions to hand an AI so it writes a document this pane accepts"
              style={{ cursor: 'pointer' }}>
              {busy === 'prompt' ? 'Fetching…' : copied ? '✓ Copied' : '⎘ Prompt for an AI'}
            </TButton>
            {onClose && <TButton quiet onClick={onClose} style={{ cursor: 'pointer' }}>← Board</TButton>}
          </div>
        </div>
      </div>
      <Rule style={{ margin: '4px 28px 0' }} />

      <div className="jk-scroll" style={{ flex: 1, minHeight: 0, padding: '14px 28px 20px', overflowY: 'auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(340px, 0.85fr)', gap: 22, alignItems: 'start' }}>

          {/* ══ Left: the document ═══════════════════════════════════════════ */}
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
              <span className="mono-eyebrow">THE DOCUMENT</span>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                <TButton quiet onClick={() => { setText(EXAMPLE); setResult(null); setFailure(null) }}
                  style={{ padding: '2px 8px', cursor: 'pointer' }}>example</TButton>
                <TButton quiet onClick={() => { setText(''); setResult(null); setFailure(null); areaRef.current?.focus() }}
                  style={{ padding: '2px 8px', cursor: 'pointer' }}>clear</TButton>
              </div>
            </div>

            <TextArea
              ref={areaRef}
              value={text}
              disabled={readonly}
              onChange={(e) => { setText(e.target.value); setResult(null); setFailure(null) }}
              onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              spellCheck={false}
              placeholder={'Paste here — a bundle, a single routine, or a library export.\nA fenced ```json block from an assistant works as-is.\nOr drop a .json file.'}
              style={{
                width: '100%', minHeight: 340,
                padding: '10px 12px',
                // The drop target says so by going dashed — the one border this
                // field owns rather than inherits.
                ...(dragging ? { borderStyle: 'dashed', borderColor: 'var(--color-accent)' } : null),
                whiteSpace: 'pre', overflowWrap: 'normal', overflowX: 'auto',
              }}
            />

            {/* What the local parse made of it — before any round trip. */}
            <div style={{ marginTop: 7, minHeight: 18 }}>
              {parsed && 'error' in parsed && (
                <span className="mono-eyebrow" style={{ color: 'var(--color-accent)' }}>
                  NOT VALID JSON — {parsed.error.toUpperCase()}
                </span>
              )}
              {parsed && 'value' in parsed && (
                <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <span className="mono-eyebrow" style={{ color: 'var(--color-accent)' }}>
                    READS AS {shape.routines} ROUTINE{shape.routines === 1 ? '' : 'S'}
                    {shape.entries ? ` + ${shape.entries} LIBRARY ENTR${shape.entries === 1 ? 'Y' : 'IES'}` : ''}
                  </span>
                  {shape.titles.length > 0 && (
                    <span className="mono-eyebrow" style={{ color: 'var(--color-faint)' }}>
                      {shape.titles.slice(0, 4).join(' · ').toUpperCase()}
                    </span>
                  )}
                  {parsed.repaired.length > 0 && (
                    <span className="mono-eyebrow" style={{ color: 'var(--color-faint)' }}>
                      ({parsed.repaired.join(', ')})
                    </span>
                  )}
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <TButton
                onClick={() => send(true)}
                disabled={!doc || readonly || busy !== null}
                style={{ cursor: doc ? 'pointer' : 'default' }}
              >
                {busy === 'check' ? 'Checking…' : 'Check it'}
              </TButton>
              <TButton
                quiet
                onClick={() => send(false)}
                disabled={!doc || readonly || busy !== null}
                title="Writes the routines and the library entries. Idempotent — re-importing the same slug updates it."
                style={{ cursor: doc ? 'pointer' : 'default' }}
              >
                {busy === 'import' ? 'Importing…' : 'Import'}
              </TButton>
              <span className="mono-eyebrow" style={{ color: 'var(--color-faint)' }}>
                CHECK RENDERS THE SESSIONS AND WRITES NOTHING
              </span>
            </div>

            {/* ── The prompt, once fetched ─────────────────────────────────── */}
            {prompt && (
              <Well style={{ display: 'block', padding: 10, marginTop: 14 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
                  <span className="mono-eyebrow" style={{ color: 'var(--color-accent)' }}>
                    {copied ? 'COPIED TO THE CLIPBOARD' : 'THE PROMPT'}
                  </span>
                  <span className="mono-eyebrow">
                    HAND THIS TO ANY ASSISTANT — IT CARRIES YOUR LIBRARY AND THE EXACT OUTPUT SHAPE
                  </span>
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                    <TButton quiet onClick={downloadPrompt} style={{ padding: '2px 8px', cursor: 'pointer' }}>↓ .md</TButton>
                    <TButton quiet onClick={() => setPrompt(null)} style={{ padding: '2px 8px', cursor: 'pointer' }}>×</TButton>
                  </div>
                </div>
                <TextArea
                  readOnly value={prompt} rows={12} onFocus={(e) => e.currentTarget.select()}
                  style={{ width: '100%', lineHeight: 1.5 }}
                />
              </Well>
            )}
          </div>

          {/* ══ Right: what it will do ═══════════════════════════════════════ */}
          <div style={{ minWidth: 0, position: 'sticky', top: 0 }}>
            {!result && !failure && (
              <>
                <span className="mono-eyebrow">WHAT IT WILL DO</span>
                <div className="mono-eyebrow" style={{ color: 'var(--color-faint)', marginTop: 6, lineHeight: 1.7 }}>
                  CHECK IT FIRST. THE RULES COME BACK RENDERED AS NUMBERS — WHICH IS THE ONLY WAY TO SEE
                  THAT A PROGRESSION WHICH IS LEGAL AND PLAUSIBLE HAS YOU SQUATTING 400 LB BY NOVEMBER.
                </div>
                <Rule style={{ margin: '12px 0' }} />
                <span className="mono-eyebrow">THE SHAPE IT ACCEPTS</span>
                <div style={{ fontFamily: MONO, fontSize: 10.5, lineHeight: 1.6, color: 'var(--color-muted)', marginTop: 6 }}>
                  {'{'}<br />
                  &nbsp;&nbsp;"library": [ … ] &nbsp;<span style={{ color: 'var(--color-faint)' }}>// optional</span><br />
                  &nbsp;&nbsp;"routines": [ … ]<br />
                  {'}'}
                </div>
                <div className="mono-eyebrow" style={{ color: 'var(--color-faint)', marginTop: 8, lineHeight: 1.7 }}>
                  ENTRIES LAND FIRST, SO A ROUTINE CAN REFERENCE A MOVEMENT THE SAME PASTE TEACHES.
                  BOTH HALVES ARE IDEMPOTENT BY SLUG — RE-PASTING EDITS, IT NEVER DUPLICATES.
                </div>
              </>
            )}

            {/* ── Refused ─────────────────────────────────────────────────── */}
            {failure && (
              <Well style={{ display: 'block', padding: 10 }}>
                <div className="mono-eyebrow" style={{ color: 'var(--color-accent)', marginBottom: 6 }}>
                  REFUSED — NOTHING WAS WRITTEN
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--color-ink)', marginBottom: errors.length ? 8 : 0 }}>
                  {failure.error || 'the import was rejected'}
                </div>
                {errors.map((e, i) => (
                  <div key={i} style={{ marginBottom: 6 }}>
                    <div style={{ fontFamily: MONO, fontSize: 10, color: 'var(--color-accent)' }}>
                      {e.path || 'document'}{e.code ? ` · ${e.code}` : ''}
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--color-muted)' }}>
                      {e.message}{e.expected ? ` — expected ${e.expected}` : ''}
                    </div>
                  </div>
                ))}
              </Well>
            )}

            {/* ── Checked, or done ────────────────────────────────────────── */}
            {result && (
              <>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
                  <span className="mono-eyebrow" style={{ color: 'var(--color-accent)' }}>
                    {result.dryRun ? 'DRY RUN — NOTHING WRITTEN' : 'IMPORTED'}
                  </span>
                  {!result.dryRun && (
                    <Bubble tone="secondary" style={{ fontSize: 8, padding: '1px 6px' }}>
                      {result.routines?.reduce((n: number, r: any) => n + (r.minted || 0), 0) || 0} SESSIONS MINTED
                    </Bubble>
                  )}
                </div>

                {/* The library half */}
                {(result.library?.entries?.length > 0) && (
                  <Well style={{ display: 'block', padding: 9, marginBottom: 8 }}>
                    <div className="mono-eyebrow" style={{ marginBottom: 5 }}>
                      LIBRARY — {result.library.created} NEW · {result.library.updated} UPDATED
                    </div>
                    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                      {result.library.entries.map((e: any, i: number) => (
                        <Chip key={i} solid={e.action === 'create'}
                          style={{ fontFamily: MONO, fontSize: 9, padding: '2px 7px' }}
                          title={`${e.collection} · ${e.slug}`}>
                          {(e.title || e.slug || '—').toUpperCase()}
                        </Chip>
                      ))}
                    </div>
                  </Well>
                )}

                {/* Each routine, with its rules rendered */}
                {(result.routines || []).map((r: any, i: number) => (
                  <ResultCard key={i} routine={r} dryRun={result.dryRun} />
                ))}

                {/* The lint tier, kept visually apart from the refusals above. */}
                {warnings.length > 0 && (
                  <Well style={{ display: 'block', padding: 9, marginTop: 8 }}>
                    <div className="mono-eyebrow" style={{ marginBottom: 5 }}>
                      ACCEPTED — WORTH A LOOK
                    </div>
                    {warnings.map((w, i) => (
                      <div key={i} style={{ fontSize: 11.5, color: 'var(--color-muted)', marginBottom: 3 }}>
                        <span style={{ fontFamily: MONO, fontSize: 10 }}>{w.path || 'spec'}</span> — {w.message}
                      </div>
                    ))}
                  </Well>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── One routine's outcome ──────────────────────────────────────────────────
 * The action, the summary, and then the part that actually matters: the first
 * four sessions the rules produce. Read them. */
function ResultCard({ routine: r, dryRun }: any) {
  const sessions = r.sessions || []
  return (
    <div style={{
      padding: '8px 10px', marginBottom: 8,
      border: '1px solid var(--color-line)', borderRadius: 'var(--hub-radius-xs)',
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: FONT_HEAD, fontWeight: 700, fontSize: 14 }}>{r.title}</span>
        <Bubble tone="secondary" style={{ fontSize: 8, padding: '1px 6px' }}>
          {r.action === 'update' ? 'UPDATES' : 'NEW'}
        </Bubble>
        {!dryRun && r.minted > 0 && (
          <span className="mono-eyebrow" style={{ marginLeft: 'auto' }}>{r.minted} SESSIONS ON THE BOARD</span>
        )}
      </div>
      {r.summary && (
        <div className="mono-eyebrow" style={{ marginTop: 2 }}>{String(r.summary).toUpperCase()}</div>
      )}

      {sessions.length > 0 && (
        <>
          <div className="mono-eyebrow" style={{ color: 'var(--color-faint)', margin: '7px 0 4px' }}>
            THE FIRST {sessions.length} SESSIONS, RENDERED
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {sessions.map((s: any, i: number) => (
              <div key={i} style={{
                padding: '5px 8px',
                border: '1px solid var(--color-line)', borderRadius: 'var(--hub-radius-xs)',
                background: s.deload ? 'color-mix(in srgb, var(--hub-bg-4) 55%, transparent)' : 'transparent',
              }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span className="seg" style={{ fontSize: 11 }}>{String(i + 1).padStart(2, '0')}</span>
                  <span className="mono-eyebrow">
                    {[s.phase, s.deload ? 'DELOAD' : null].filter(Boolean).join(' · ').toUpperCase()}
                  </span>
                </div>
                {(s.steps || []).map((st: any) => (
                  <div key={st.key} style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 11 }}>
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--color-muted)' }}>
                      {st.title}
                    </span>
                    <span style={{ fontFamily: MONO, color: 'var(--color-ink)' }}>{st.line}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
