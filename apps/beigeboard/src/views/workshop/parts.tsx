/**
 * parts.tsx — the field chrome and the one control the workshop's three document
 * surfaces share.
 *
 * The forge (a routine's document), the library (the vocabulary its steps are built
 * from) and the paste pane (a whole bundle at once) are all dense editors over the
 * same spec, and all three needed the same two things: inputs that agree on their
 * height, and a progression rule editor.
 *
 * They live here rather than in the forge because the forge is not the owner of
 * either — it was just the first to need them. Importing them out of RoutineForge
 * would also have made the library browser and the forge import each other, since
 * the forge opens the browser.
 *
 * A form whose inputs drift in height is the fastest way to make a dense editor
 * unreadable, so the chrome is declared once and spent everywhere.
 */
import React from 'react'
import { TButton, Field as UIField, NumField as UINumField, SelectField as UISelectField, TextArea as UITextArea } from '@jkos/ui'
import { PROGRESSIONS, DRIVES, PROGRESSION_LABEL } from '../../lib/routine-spec'

export const MONO = 'var(--hub-font-mono)'

/* The chrome is now the suite's — `.jk-field` and its family in @jkos/design
 * (see the "Fields" block in hub.css). What used to live here was a local style
 * object: a hairline box that left `appearance` alone, so under it the browser
 * kept painting its own white spin buttons on every number and its own arrow on
 * every select. Half a dozen of those in one dense row is what finally made the
 * workshop look like a form bolted onto the app rather than part of it.
 *
 * All three surfaces are dense editors, so the `sm` rung is bound HERE rather
 * than repeated at the ~90 call sites downstream. Call sites read exactly like
 * the primitives they wrap; only the import path differs. */
// forwardRef, not a plain arrow: React strips `ref` from a function component's
// props, so a bare `(p) => <UITextArea {...p} />` would silently drop the ref the
// paste pane hands its textarea.
export const Field = React.forwardRef<HTMLInputElement, React.ComponentPropsWithoutRef<typeof UIField>>(
  (p, ref) => <UIField size="sm" {...p} ref={ref} />)
export const NumField = React.forwardRef<HTMLInputElement, React.ComponentPropsWithoutRef<typeof UINumField>>(
  (p, ref) => <UINumField size="sm" {...p} ref={ref} />)
export const SelectField = React.forwardRef<HTMLSelectElement, React.ComponentPropsWithoutRef<typeof UISelectField>>(
  (p, ref) => <UISelectField size="sm" {...p} ref={ref} />)
export const TextArea = React.forwardRef<HTMLTextAreaElement, React.ComponentPropsWithoutRef<typeof UITextArea>>(
  (p, ref) => <UITextArea size="sm" {...p} ref={ref} />)

/** The width every bare number in the workshop takes, so a column of them lines
 *  up. On the wrapper, not the input — the stepper is part of the group. */
export const NUM_W: React.CSSProperties = { width: 58 }

/* A label and the control it names, as ONE thing that wraps. A progression rule
   is a sentence with six fields in it and it has to reflow on a narrow forge; if
   every word and box is a separate flex child, the line breaks wherever it likes
   and you get "… ONCE EVERY 1 SESSIONS STOP AT" on one row with the number it
   belongs to orphaned on the next. Grouping the pair costs one span and makes the
   break points the only ones that still read as English. */
const PAIR: React.CSSProperties = { display: 'inline-flex', gap: 6, alignItems: 'center' }
function Pair({ children }: { children: React.ReactNode }) {
  return <span style={PAIR}>{children}</span>
}
const Label = ({ children }: { children: React.ReactNode }) => (
  <span className="mono-eyebrow" style={{ whiteSpace: 'nowrap' }}>{children}</span>
)

/** One progression rule, written as a sentence: what makes it harder, what moves,
 *  by how much, how often, and where it stops. Only the fields THIS type needs are
 *  drawn — a form that shows every field of every progression at once is the form
 *  nobody fills in correctly. */
export function RuleRow({ rule: p, variants = [], vars = [], readonly, onSet, onRemove }: any) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 4 }}>
      <Pair>
        <Label>GETS HARDER BY</Label>
        <SelectField value={p.type} disabled={readonly} onChange={(e) => onSet('type', e.target.value)}>
          {PROGRESSIONS.filter((t) => t !== 'fixed').map((t) => (
            <option key={t} value={t}>{t} — {PROGRESSION_LABEL[t]}</option>
          ))}
        </SelectField>
      </Pair>

      {(p.type === 'linear' || p.type === 'ladder') && (
        <Pair>
          <Label>CHANGING THE</Label>
          <SelectField value={p.drives} disabled={readonly} onChange={(e) => onSet('drives', e.target.value)}>
            {DRIVES.map((d) => (
              <option key={d} value={d} disabled={d === 'variant' && variants.length < 2}>{d}</option>
            ))}
          </SelectField>
        </Pair>
      )}

      {p.type === 'linear' && (
        <>
          <Pair>
            <Label>BY</Label>
            <NumField step={0.5} value={p.increment ?? 0} disabled={readonly}
              onChange={(e) => onSet('increment', Number(e.target.value) || 0)} wrapperStyle={NUM_W} />
          </Pair>
          <Pair>
            <Label>ONCE EVERY</Label>
            <NumField min={1} value={p.every ?? 1} disabled={readonly}
              onChange={(e) => onSet('every', Math.max(1, Number(e.target.value) || 1))} wrapperStyle={NUM_W} />
            <Label>SESSIONS</Label>
          </Pair>
        </>
      )}

      {(p.type === 'double' || p.type === 'autoregulated') && (
        <>
          <Pair>
            <Label>CLIMBING FROM</Label>
            <NumField value={p.range?.[0] ?? 5} disabled={readonly}
              onChange={(e) => onSet('range', [Number(e.target.value) || 0, p.range?.[1] ?? 8])} wrapperStyle={NUM_W} />
            <Label>TO</Label>
            <NumField value={p.range?.[1] ?? 8} disabled={readonly}
              onChange={(e) => onSet('range', [p.range?.[0] ?? 5, Number(e.target.value) || 0])} wrapperStyle={NUM_W} />
            <Label>REPS</Label>
          </Pair>
          <Pair>
            <Label>THEN BACK TO THE BOTTOM WITH</Label>
            <NumField step={0.5} value={p.increment ?? 5} disabled={readonly}
              onChange={(e) => onSet('increment', Number(e.target.value) || 0)} wrapperStyle={NUM_W} />
            <Label>MORE WEIGHT</Label>
          </Pair>
        </>
      )}

      {p.type === 'ladder' && (
        <Pair>
          <Label>THE RUNGS, IN ORDER</Label>
          <Field
            value={(p.values || []).join(', ')} disabled={readonly} placeholder="3, 5, 8, 13"
            onChange={(e) => onSet('values', e.target.value.split(',').map((v: string) => Number(v.trim())).filter((n: number) => Number.isFinite(n)))}
            style={{ width: 140 }}
          />
        </Pair>
      )}

      {p.type === 'percent' && (
        <>
          <Pair>
            <Label>AS A % OF YOUR</Label>
            {/* A library entry has no `vars` of its own — a percent default only means
                something once a routine supplies the named number, so the field is a
                free text key there and a picker inside the forge. */}
            {vars.length > 0 ? (
              <SelectField value={p.of ?? ''} disabled={readonly} onChange={(e) => onSet('of', e.target.value)}>
                <option value="">—</option>
                {vars.map((v: string) => <option key={v} value={v}>{v}</option>)}
              </SelectField>
            ) : (
              <Field value={p.of ?? ''} disabled={readonly} placeholder="squat_max"
                onChange={(e) => onSet('of', e.target.value)} style={{ width: 100 }} />
            )}
          </Pair>
          <Pair>
            <Label>STARTING AT</Label>
            <NumField step={0.05} value={p.start ?? 0.6} disabled={readonly}
              onChange={(e) => onSet('start', Number(e.target.value) || 0)} wrapperStyle={NUM_W} />
          </Pair>
          <Pair>
            <Label>RISING BY</Label>
            <NumField step={0.005} value={p.increment ?? 0.025} disabled={readonly}
              onChange={(e) => onSet('increment', Number(e.target.value) || 0)} wrapperStyle={NUM_W} />
          </Pair>
        </>
      )}

      <Pair>
        <Label>STOP AT</Label>
        <NumField value={p.cap ?? ''} disabled={readonly} placeholder="no limit"
          onChange={(e) => onSet('cap', e.target.value === '' ? null : Number(e.target.value))} wrapperStyle={NUM_W}
          title="Leave this blank and the number climbs forever. At +5 seconds a session, a 30-second plank becomes a five-minute plank inside a year." />
      </Pair>

      {!readonly && onRemove && (
        <TButton quiet onClick={onRemove} style={{ padding: '1px 6px', cursor: 'pointer' }}>×</TButton>
      )}
    </div>
  )
}
