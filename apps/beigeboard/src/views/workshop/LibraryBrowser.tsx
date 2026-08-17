/**
 * LibraryBrowser — the shelf the routine's steps are built from.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT EXISTS
 *
 * The library was reachable from exactly one place: a drop-down inside the forge,
 * sixty entries at a time, each shown as a title and a unit. That is enough to PICK
 * from and not nearly enough to KEEP — you could not see an entry's ladder, its rest
 * interval or its default progression without adding it to a routine first, and you
 * could not edit any of it at all. The most valuable thing in the whole primitive —
 * the ordered ladder of harder variations, the tacit knowledge a step inherits for
 * free from one `ref` — was write-only.
 *
 * So this is the shelf: everything the library knows, browsable, searchable,
 * editable, and honest about which routines are actually using each entry.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE COMPONENT, TWO MODES
 *
 *   BROWSE  its own board beside Goals and Routines. Curate the vocabulary without
 *           having a routine open, which is when you actually want to.
 *   PICK    the same shelf, opened from the forge (`onPick`). Clicking an entry
 *           adds it as a step and returns.
 *
 * Two modes rather than two components because a picker that shows less than the
 * browser is a picker that gets picked from wrongly — the ladder and the default
 * progression are exactly what you want to see at the moment you choose.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SHAPE
 *
 * Collections as a chip row (there are six, a rail would be mostly empty), then the
 * forge's own two-column split: the shelf on the left, the selected entry's editor
 * on the right, sticky. Matching the forge is deliberate — this is the same act
 * (editing a document) at a different scale, and a second layout language for it
 * would be one to learn for nothing.
 *
 * `used by` is computed from the items already in memory, not fetched: the routines
 * are on the board, and a count that lags the thing it counts is worse than none.
 */
import React, { useEffect, useMemo, useState } from 'react'
import { FONT_HEAD } from '../../lib/theme'
import { Bubble, Rule, TButton, Well, Chip } from '@jkos/ui'
import { stagger } from '@jkos/design'
import { MONO, field, numField, textField, RuleRow } from './parts'
import {
  normalizeSpec, slugify, stepLine,
  UNITS, LOAD_UNITS, COLLECTIONS, LIMITS,
} from '../../lib/routine-spec'

type Sort = 'title' | 'used' | 'newest'

const SORT_LABEL: Record<Sort, string> = {
  title: 'A–Z',
  used: 'MOST USED',
  newest: 'NEWEST',
}

/** A blank entry, in the shape the editor edits. `collection` carries over from
 *  whatever shelf you were looking at — you are almost always adding to the one
 *  you were just reading. */
const blankEntry = (collection: string) => ({
  id: null, collection, slug: '', title: '',
  unit: 'reps', load_unit: null as string | null,
  tags: [] as string[], variants: [] as string[],
  defaults: {} as any, notes: '',
})

export function LibraryBrowser({ api, items, readonly, onPick, onClose, onPaste }: any) {
  const [entries, setEntries] = useState<any[] | null>(null)
  const [collection, setCollection] = useState<string>('exercise')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<Sort>('title')
  const [draft, setDraft] = useState<any | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = () => api?.get('/api/library')
    .then((r: any) => setEntries(r?.entries || []))
    .catch(() => setEntries([]))

  useEffect(() => { load() }, [api])

  /* WHO USES WHAT. Every routine's document scanned once for its steps' `ref`s —
     the one question a library cannot answer about itself, and the one that decides
     whether an entry is safe to change. Cheap: a few dozen routines, each a spec
     already in memory. */
  const usage = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const it of items || []) {
      if (it.kind !== 'routine') continue
      let spec
      try { spec = normalizeSpec(it.spec) } catch { continue }
      for (const s of spec.steps) {
        if (!s.ref) continue
        if (!map.has(s.ref)) map.set(s.ref, [])
        const list = map.get(s.ref)!
        if (!list.includes(it.title)) list.push(it.title)
      }
    }
    return map
  }, [items])

  const counts = useMemo(() => {
    const c = new Map<string, number>()
    for (const e of entries || []) c.set(e.collection, (c.get(e.collection) || 0) + 1)
    return c
  }, [entries])

  /* The shelves that actually have something on them, plus any the vocabulary
     defines and the user has not filled yet — an empty `recipe` shelf is an
     invitation, and hiding it is how the library stays a training app forever. */
  const shelves = useMemo(() => {
    const seen = new Set((entries || []).map((e) => e.collection))
    return [...COLLECTIONS.filter((c) => seen.has(c) || counts.get(c)), ...[...seen].filter((c) => !COLLECTIONS.includes(c))]
      .filter((v, i, a) => a.indexOf(v) === i)
  }, [entries, counts])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = (entries || []).filter((e) => (collection === 'all' || e.collection === collection))
    if (q) {
      list = list.filter((e) =>
        e.title.toLowerCase().includes(q)
        || e.slug.includes(q)
        || (e.notes || '').toLowerCase().includes(q)
        || (e.tags || []).some((t: string) => t.toLowerCase().includes(q))
        || (e.variants || []).some((v: string) => v.toLowerCase().includes(q)),
      )
    }
    const used = (e: any) => (usage.get(e.slug) || []).length
    return [...list].sort((a, b) =>
      sort === 'newest' ? (b.id || 0) - (a.id || 0)
      : sort === 'used' ? (used(b) - used(a)) || a.title.localeCompare(b.title)
      : a.title.localeCompare(b.title))
  }, [entries, collection, query, sort, usage])

  const save = async () => {
    if (!draft || readonly) return
    setSaving(true); setError(null)
    try {
      const slug = slugify(draft.slug || draft.title, '')
      if (!slug) { setError('a title (or a slug) is required'); return }
      const body = {
        collection: draft.collection, slug, title: draft.title || slug,
        unit: draft.unit || null, load_unit: draft.load_unit || null,
        tags: draft.tags, variants: draft.variants,
        defaults: draft.defaults, notes: draft.notes || null,
      }
      /* POST for both, not PATCH for the edit: /api/library upserts by
         (collection, slug), which is the same key the editor locks, so one door
         covers create and update and cannot half-apply a rename. */
      const saved = await api.post('/api/library', body)
      if (saved?.error) { setError(saved.error); return }
      await load()
      setDraft(saved && saved.id ? { ...saved, notes: saved.notes || '' } : null)
    } catch (e: any) {
      setError(e?.message || 'could not save')
    } finally { setSaving(false) }
  }

  const remove = async () => {
    if (!draft?.id || readonly) return
    setSaving(true)
    try {
      await api.del(`/api/library/${draft.id}`)
      await load()
      setDraft(null)
    } finally { setSaving(false) }
  }

  const exportLibrary = () => {
    // A file, not a fetch. The library becomes something you can keep, diff, hand
    // to someone else, or paste to an assistant as the vocabulary to write against.
    api?.get('/api/library/export').then((doc: any) => {
      const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = 'jkos-library.json'
      a.click()
      URL.revokeObjectURL(a.href)
    }).catch(() => { /* best effort — the button is a convenience, not a contract */ })
  }

  const picking = typeof onPick === 'function'
  const total = entries?.length ?? 0

  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* ── Head ── */}
      <div className="mo-item" style={{ flex: 'none', padding: '16px 28px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
          <span className="jk-lab jk-lab-xs" style={{ color: 'var(--color-accent)' }}>THE LIBRARY</span>
          <span className="mono-eyebrow">
            {picking
              ? 'PICK ONE — IT BRINGS ITS UNIT, ITS REST, ITS LADDER AND A SANE PROGRESSION'
              : 'THE VOCABULARY EVERY ROUTINE IS WRITTEN IN'}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, marginTop: 12, flexWrap: 'wrap' }}>
          <span style={{ fontFamily: FONT_HEAD, fontWeight: 700, fontSize: '1.85rem', lineHeight: 1, letterSpacing: '-0.02em' }}>
            {collection === 'all' ? 'Everything' : collection.replace(/^\w/, (c) => c.toUpperCase())}
          </span>
          <span className="mono-eyebrow" style={{ marginBottom: 5 }}>
            {String(shown.length).padStart(2, '0')} OF {String(total).padStart(2, '0')} ENTRIES
          </span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
            {!readonly && !picking && (
              <TButton quiet onClick={onPaste} title="Paste a document to teach several entries at once" style={{ cursor: 'pointer' }}>
                ⇪ Paste
              </TButton>
            )}
            <TButton quiet onClick={exportLibrary} title="Download the library as a file you can keep, diff or share" style={{ cursor: 'pointer' }}>
              ↓ Export
            </TButton>
            {!readonly && (
              <TButton onClick={() => { setDraft(blankEntry(collection === 'all' ? 'exercise' : collection)); setError(null) }} style={{ cursor: 'pointer' }}>
                + New entry
              </TButton>
            )}
            {onClose && <TButton quiet onClick={onClose} style={{ cursor: 'pointer' }}>← Back</TButton>}
          </div>
        </div>

        {/* The shelves. Chips rather than a rail: there are six, and a rail for six
            short words is a column of whitespace. */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
          <Chip
            className="jk-hit" solid={collection === 'all'} onClick={() => setCollection('all')}
            style={{ fontFamily: MONO, fontSize: 9.5, padding: '3px 9px', cursor: 'pointer' }}
          >
            ALL {String(total).padStart(2, '0')}
          </Chip>
          {shelves.map((c) => (
            <Chip
              key={c} className="jk-hit" solid={c === collection} onClick={() => setCollection(c)}
              style={{ fontFamily: MONO, fontSize: 9.5, padding: '3px 9px', cursor: 'pointer' }}
            >
              {String(c).toUpperCase()} {String(counts.get(c) || 0).padStart(2, '0')}
            </Chip>
          ))}
          <input
            value={query} placeholder="search title, tag, ladder, notes…"
            onChange={(e) => setQuery(e.target.value)}
            style={{ ...field, marginLeft: 'auto', width: 230, padding: '4px 7px' }}
          />
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} style={field}>
            {(Object.keys(SORT_LABEL) as Sort[]).map((s) => <option key={s} value={s}>{SORT_LABEL[s]}</option>)}
          </select>
        </div>
      </div>
      <Rule style={{ margin: '4px 28px 0' }} />

      <div className="jk-scroll" style={{ flex: 1, minHeight: 0, padding: '14px 28px 20px', overflowY: 'auto' }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: draft ? 'minmax(0, 1.25fr) minmax(320px, 0.75fr)' : 'minmax(0, 1fr)',
          gap: 22, alignItems: 'start',
        }}>
          {/* ══ The shelf ═══════════════════════════════════════════════════ */}
          <div style={{ minWidth: 0 }}>
            {entries === null && <div className="mono-eyebrow">LOADING…</div>}
            {entries !== null && shown.length === 0 && (
              <div className="mono-eyebrow" style={{ color: 'var(--color-faint)' }}>
                {query ? 'NOTHING MATCHES' : 'THIS SHELF IS EMPTY — ADD AN ENTRY OR PASTE A SET'}
              </div>
            )}
            <div style={{
              display: 'grid',
              gridTemplateColumns: `repeat(auto-fill, minmax(${draft ? 240 : 280}px, 1fr))`,
              gap: 8,
            }}>
              {shown.map((e, i) => (
                <EntryCard
                  key={`${e.collection}:${e.slug}`}
                  entry={e}
                  used={usage.get(e.slug) || []}
                  selected={draft?.id === e.id}
                  picking={picking}
                  delay={stagger(i, 70, 26)}
                  onOpen={() => { setDraft({ ...e, notes: e.notes || '' }); setError(null) }}
                  onPick={picking ? () => onPick(e) : undefined}
                />
              ))}
            </div>
          </div>

          {/* ══ The entry ═══════════════════════════════════════════════════ */}
          {draft && (
            <div style={{ minWidth: 0, position: 'sticky', top: 0 }}>
              <EntryEditor
                /* Keyed on the entry, so switching which one you are looking at
                   remounts the editor — which is what resets the delete
                   confirmation rather than carrying it onto the next entry. */
                key={draft.id ?? 'new'}
                draft={draft}
                readonly={readonly}
                saving={saving}
                error={error}
                used={usage.get(draft.slug) || []}
                onEdit={(fn: any) => setDraft((d: any) => { const next = JSON.parse(JSON.stringify(d)); fn(next); return next })}
                onSave={save}
                onDelete={remove}
                onClose={() => { setDraft(null); setError(null) }}
                onPick={picking && draft.id ? () => onPick(draft) : undefined}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ── One entry on the shelf ─────────────────────────────────────────────────
 * Everything that makes the entry worth referencing, in the order you judge it:
 * what it is, what a step inherits, how it climbs, and who is already relying on
 * it. The ladder is drawn in full rather than counted — "4 RUNGS" tells you a
 * ladder exists, and the whole question is whether it is the RIGHT ladder. */
function EntryCard({ entry: e, used, selected, picking, delay, onOpen, onPick }: any) {
  const d = e.defaults || {}
  const dose = stepLine({
    sets: d.sets ?? 1, target: d.target ?? d.reps ?? null,
    unit: e.unit || 'reps', load: d.load ?? null, load_unit: e.load_unit || null,
  })
  const prog = d.progression && d.progression.type && d.progression.type !== 'fixed'
    ? String(d.progression.type).toUpperCase()
    : null
  const As: any = selected ? Well : 'div'

  return (
    <As
      className="jk-hit mo-item"
      onClick={picking && onPick ? onPick : onOpen}
      title={picking ? `Add ${e.title} as a step` : e.notes || e.title}
      style={{
        display: 'flex', flexDirection: 'column', gap: 5,
        padding: '9px 11px', cursor: 'pointer', animationDelay: delay,
        border: '1px solid var(--color-line)', borderRadius: 'var(--hub-radius-sm)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
        <span style={{
          fontFamily: FONT_HEAD, fontWeight: 700, fontSize: 14, letterSpacing: '-0.01em',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {e.title}
        </span>
        {prog && <Bubble tone="secondary" style={{ fontSize: 8, padding: '1px 6px' }}>{prog}</Bubble>}
        <span className="mono-eyebrow" style={{ marginLeft: 'auto', flex: 'none' }}>{dose}</span>
      </div>

      <span className="mono-eyebrow" style={{ color: 'var(--color-faint)' }}>
        {e.slug}{d.rest ? ` · REST ${d.rest}S` : ''}{e.source === 'starter' ? ' · STARTER' : ''}
      </span>

      {e.variants?.length > 1 && (
        <div style={{ fontSize: 11, color: 'var(--color-muted)', lineHeight: 1.35 }}>
          {e.variants.map((v: string, i: number) => (
            <span key={i}>
              {i > 0 && <span style={{ color: 'var(--color-faint)' }}> › </span>}
              <span style={{
                color: i === (d.variant_index ?? 0) ? 'var(--color-ink)' : undefined,
                fontWeight: i === (d.variant_index ?? 0) ? 600 : 400,
              }}>{v}</span>
            </span>
          ))}
        </div>
      )}

      {(e.tags?.length > 0 || used.length > 0) && (
        <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexWrap: 'wrap' }}>
          {(e.tags || []).slice(0, 4).map((t: string) => (
            <span key={t} className="mono-eyebrow" style={{ color: 'var(--color-faint)' }}>#{t}</span>
          ))}
          {used.length > 0 && (
            <span className="mono-eyebrow" style={{ marginLeft: 'auto', color: 'var(--color-accent)' }}
              title={used.join(', ')}>
              IN {used.length} ROUTINE{used.length > 1 ? 'S' : ''}
            </span>
          )}
        </div>
      )}
    </As>
  )
}

/* ── The entry itself ───────────────────────────────────────────────────────
 * The same three questions a step asks, in the same order the forge asks them:
 * what it is, what one of it looks like, and how it gets harder. Everything here
 * is a DEFAULT — the routine's own step always wins — so the editor says so once
 * rather than hedging on every field. */
function EntryEditor({ draft: e, readonly, saving, error, used, onEdit, onSave, onDelete, onClose, onPick }: any) {
  const d = e.defaults || {}
  /* Delete is two clicks, in the pane. Not a `confirm()` — nothing else in this app
     opens one, and the thing actually worth saying ("three routines reference this")
     is app knowledge a browser dialog cannot show well. */
  const [confirming, setConfirming] = useState(false)
  const setDefault = (k: string, v: any) => onEdit((n: any) => {
    n.defaults = { ...(n.defaults || {}) }
    if (v === null || v === '') delete n.defaults[k]
    else n.defaults[k] = v
  })
  const isNew = !e.id

  return (
    <Well style={{ display: 'block', padding: 12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
        <span className="mono-eyebrow" style={{ color: 'var(--color-accent)' }}>
          {isNew ? 'NEW ENTRY' : 'ENTRY'}
        </span>
        <span className="mono-eyebrow">EVERY FIELD IS A DEFAULT — A STEP CAN OVERRIDE ANY OF IT</span>
        <TButton quiet onClick={onClose} style={{ marginLeft: 'auto', padding: '1px 7px', cursor: 'pointer' }}>×</TButton>
      </div>

      {/* WHAT IT IS */}
      <input
        value={e.title} disabled={readonly} placeholder="Nordic Curl"
        onChange={(ev) => onEdit((n: any) => { n.title = ev.target.value })}
        style={{ ...textField, width: '100%', marginBottom: 5 }}
      />
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <select value={e.collection} disabled={readonly}
          onChange={(ev) => onEdit((n: any) => { n.collection = ev.target.value })} style={field}>
          {COLLECTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        {/* The slug is the identity every `ref` in every routine points at, so it is
            fixed once the entry exists. Renaming it would silently orphan the steps
            that reference it — a "duplicate" is the honest way to fork one. */}
        <input
          value={e.slug} disabled={readonly || !isNew}
          placeholder={slugify(e.title, 'slug')}
          onChange={(ev) => onEdit((n: any) => { n.slug = ev.target.value })}
          title={isNew ? 'The identity a step references. Kebab-case.' : 'Fixed — every step that references this entry points at this slug'}
          style={{ ...field, flex: '1 1 120px', opacity: isNew ? 1 : 0.65 }}
        />
      </div>

      <Rule style={{ margin: '9px 0' }} />

      {/* THE DOSE */}
      <div className="mono-eyebrow" style={{ marginBottom: 5 }}>ONE OF IT LOOKS LIKE</div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <input type="number" min={1} value={d.sets ?? ''} disabled={readonly} placeholder="1"
          onChange={(ev) => setDefault('sets', ev.target.value === '' ? null : Math.max(1, Number(ev.target.value) || 1))}
          style={numField} title="Sets" />
        <span className="mono-eyebrow">×</span>
        <input type="number" value={d.target ?? ''} disabled={readonly} placeholder="—"
          onChange={(ev) => setDefault('target', ev.target.value === '' ? null : Number(ev.target.value))}
          style={numField} title="Target per set" />
        <select value={e.unit || 'reps'} disabled={readonly}
          onChange={(ev) => onEdit((n: any) => { n.unit = ev.target.value })} style={field}>
          {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
        <span className="mono-eyebrow">@</span>
        <input type="number" step={0.5} value={d.load ?? ''} disabled={readonly} placeholder="—"
          onChange={(ev) => setDefault('load', ev.target.value === '' ? null : Number(ev.target.value))}
          style={numField} title="Starting load" />
        <select value={e.load_unit || ''} disabled={readonly}
          onChange={(ev) => onEdit((n: any) => { n.load_unit = ev.target.value || null })} style={field}>
          <option value="">—</option>
          {LOAD_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
        <span className="mono-eyebrow">REST</span>
        <input type="number" min={0} value={d.rest ?? ''} disabled={readonly} placeholder="—"
          onChange={(ev) => setDefault('rest', ev.target.value === '' ? null : Number(ev.target.value))}
          style={numField} />
      </div>

      <Rule style={{ margin: '9px 0' }} />

      {/* THE LADDER — the most valuable field in an entry. */}
      <div className="mono-eyebrow" style={{ marginBottom: 5 }}>
        THE LADDER — EASIEST TO HARDEST
      </div>
      <input
        value={(e.variants || []).join(', ')} disabled={readonly}
        placeholder="Knee Push-Up, Push-Up, Decline Push-Up, Archer Push-Up"
        onChange={(ev) => onEdit((n: any) => {
          n.variants = ev.target.value.split(',').map((v: string) => v.trim()).filter(Boolean).slice(0, LIMITS.variants)
        })}
        style={{ ...field, width: '100%' }}
      />
      {e.variants?.length > 1 && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 5 }}>
          <span className="mono-eyebrow">START AT</span>
          <select value={d.variant_index ?? 0} disabled={readonly}
            onChange={(ev) => setDefault('variant_index', Number(ev.target.value))} style={field}>
            {e.variants.map((v: string, i: number) => <option key={i} value={i}>{v}</option>)}
          </select>
          <span className="mono-eyebrow">CLIMB EVERY</span>
          <input type="number" min={0} value={d.variant_every ?? 0} disabled={readonly}
            onChange={(ev) => setDefault('variant_every', Math.max(0, Number(ev.target.value) || 0))}
            style={numField} title="0 = never climb on a clock" />
          <span className="mono-eyebrow">SESSIONS</span>
        </div>
      )}
      {(!e.variants || e.variants.length < 2) && (
        <div className="mono-eyebrow" style={{ color: 'var(--color-faint)', marginTop: 4 }}>
          NO LADDER — BODYWEIGHT WORK WITH NO LADDER CAN ONLY PLATEAU
        </div>
      )}

      <Rule style={{ margin: '9px 0' }} />

      {/* HOW IT GETS HARDER */}
      <div className="mono-eyebrow" style={{ marginBottom: 5 }}>ITS DEFAULT PROGRESSION</div>
      {d.progression && d.progression.type && d.progression.type !== 'fixed' ? (
        <RuleRow
          rule={d.progression}
          variants={e.variants || []}
          readonly={readonly}
          onSet={(k: string, v: any) => setDefault('progression', { ...d.progression, [k]: v })}
          onRemove={readonly ? undefined : () => setDefault('progression', null)}
        />
      ) : (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="mono-eyebrow" style={{ color: 'var(--color-faint)' }}>NEVER GETS HARDER</span>
          {!readonly && (
            <TButton quiet style={{ padding: '2px 8px', cursor: 'pointer' }}
              onClick={() => setDefault('progression', { type: 'linear', drives: 'target', increment: 1, every: 1, cap: null })}>
              + progression
            </TButton>
          )}
        </div>
      )}

      <Rule style={{ margin: '9px 0' }} />

      {/* THE REST */}
      <div className="mono-eyebrow" style={{ marginBottom: 5 }}>TAGS — HOW YOU WILL FIND IT AGAIN</div>
      <input
        value={(e.tags || []).join(', ')} disabled={readonly} placeholder="push, chest, bodyweight"
        onChange={(ev) => onEdit((n: any) => {
          n.tags = ev.target.value.split(',').map((t: string) => t.trim()).filter(Boolean).slice(0, LIMITS.tags)
        })}
        style={{ ...field, width: '100%' }}
      />
      <textarea
        value={e.notes || ''} disabled={readonly} rows={3}
        placeholder="Form cues, the method, the thing worth remembering."
        onChange={(ev) => onEdit((n: any) => { n.notes = ev.target.value })}
        style={{ ...field, width: '100%', marginTop: 6, resize: 'vertical', lineHeight: 1.45 }}
      />

      {used.length > 0 && (
        <div className="mono-eyebrow" style={{ marginTop: 8, color: 'var(--color-accent)' }} title={used.join(', ')}>
          USED BY {used.join(' · ').toUpperCase()}
        </div>
      )}
      {error && (
        <div className="mono-eyebrow" style={{ marginTop: 8, color: 'var(--color-accent)' }}>{error.toUpperCase()}</div>
      )}

      {confirming && (
        <div className="mono-eyebrow" style={{ marginTop: 8, color: 'var(--color-accent)', lineHeight: 1.6 }}>
          {used.length > 0
            ? `${used.length} ROUTINE${used.length > 1 ? 'S' : ''} REFERENCE THIS. THEIR STEPS KEEP WHAT THEY ALREADY INHERITED, BUT STOP PICKING UP EDITS.`
            : 'NOTHING REFERENCES THIS ENTRY.'}
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
        {!readonly && (
          <TButton onClick={onSave} disabled={saving} style={{ cursor: 'pointer' }}>
            {saving ? 'Saving…' : isNew ? 'Add to the library' : 'Save'}
          </TButton>
        )}
        {onPick && (
          <TButton quiet onClick={onPick} style={{ cursor: 'pointer' }}>Use as a step →</TButton>
        )}
        {!readonly && !isNew && (
          <>
            {confirming && (
              <TButton quiet onClick={() => setConfirming(false)} style={{ marginLeft: 'auto', cursor: 'pointer' }}>
                keep it
              </TButton>
            )}
            <TButton
              quiet
              onClick={() => (confirming ? onDelete() : setConfirming(true))}
              disabled={saving}
              style={{ marginLeft: confirming ? 0 : 'auto', cursor: 'pointer' }}
            >
              {confirming ? 'really delete' : 'delete'}
            </TButton>
          </>
        )}
      </div>
    </Well>
  )
}
