import { forwardRef, useRef } from 'react';
import type { ComponentPropsWithoutRef, CSSProperties, ElementType, HTMLAttributes, ReactNode } from 'react';

/* ─────────────────────────────────────────────────────────────────────────────
   @jkos/ui — accent "bubble" primitives.

   Thin React wrappers over the two-accent classes in @jkos/design/tokens.css.
   Primary = struck/pressed into the paper (glows in CRT); secondary = flat, one
   rung down. The user's accent pair flows in through --accent / --accent-secondary
   (deepened for paper, raw + glow for dark), so these never hardcode a colour and
   always respond to the chosen pair + mode.

   Import the tokens once per app:  import '@jkos/ui/tokens.css'
   ───────────────────────────────────────────────────────────────────────────── */

/** Join class names, dropping falsy values. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/** Shared polymorphic prop shape for the primitives below: `as` picks the
 *  rendered element (default per component, see each component's signature),
 *  and the allowed DOM props follow THAT element — so a button-default
 *  primitive carries `disabled`/`type`, and `as="a"` unlocks `href` — instead
 *  of the old fixed `HTMLAttributes<HTMLElement>`, which had neither. Own
 *  props (`tone`, `size`, `quiet`, ...) win over any same-named DOM attribute. */
type PolymorphicProps<E extends ElementType, Own extends object = object> = Own & {
  /** Render as a different element (default per component). */
  as?: E;
  children?: ReactNode;
} & Omit<ComponentPropsWithoutRef<E>, keyof Own | 'as' | 'children'>;

/** Single-element accent pill — struck (primary) or flat (secondary). */
export function Bubble<E extends ElementType = 'span'>({
  as,
  tone = 'primary',
  large = false,
  className,
  children,
  ...rest
}: PolymorphicProps<E, { tone?: 'primary' | 'secondary'; large?: boolean }>) {
  const As = (as ?? 'span') as ElementType;
  return (
    <As className={cx('jk-bubble', `jk-bubble-${tone}`, large && 'jk-bubble-lg', className)} {...rest}>
      {children}
    </As>
  );
}

/** Struck/pressed text. Default is the RAISED primary-accent badge (`.jk-press`);
 *  `large` for display sizes (clocks, hero figures). `variant` switches to the
 *  Full Press chip CUT — type pressed INTO the sheet, reading `tint` (--jk-tint):
 *    'ink' neutral-ink title on a tinted chip · 'rev' cream knockout on a solid
 *    tab · 'sm' the small tinted press. `variant` wins over `large`. */
export function Press<E extends ElementType = 'span'>({
  as,
  large = false,
  variant,
  tint,
  className,
  style,
  children,
  ...rest
}: PolymorphicProps<E, { large?: boolean; variant?: 'ink' | 'rev' | 'sm'; tint?: string }>) {
  const As = (as ?? 'span') as ElementType;
  const cls = variant ? `jk-press-${variant}` : large ? 'jk-press-lg' : 'jk-press';
  return (
    <As
      className={cx(cls, className)}
      style={tint ? { ...style, ['--jk-tint' as string]: tint } : style}
      {...rest}
    >
      {children}
    </As>
  );
}

/** The Full Press solid-ink CHIP — the suite-default tinted item (a calendar
 *  event, a task leaf, a bench card). `solid` (default true) paints the loud
 *  saturated tab; drop to false for the faint raised base. `live`/`done`/`small`
 *  layer the state modifiers. `tint` colours the chip in a data hue (--jk-tint).
 *  Pair a `<Press variant="rev">` title inside a solid chip, `variant="ink"` on
 *  the faint base.
 *
 *  `spent` is the state that is easy to forget: ENDED, but nobody struck it off.
 *  It keeps its ink and loses only its weight, which is what makes a now-line
 *  read as a position in the day rather than a line drawn across it. Don't
 *  choose these per call site — `chipState(item, now)` in @jkos/cards decides,
 *  so a chip carries the same weight in every view that renders it.
 *
 *  `off` is for TOGGLE GROUPS and nothing else — a weekday selector, a filter
 *  rail, a tab strip. Write the pair as `solid={picked} off={!picked}`, never as
 *  `solid={picked}` alone: the faint base chip is a tinted ITEM, and on the CRT
 *  face it is emissive, so `solid` on its own is not a legible on/off anywhere
 *  the tube is lit. See .jk-chip-off in hub.css. */
export function Chip<E extends ElementType = 'span'>({
  as,
  solid = true,
  live = false,
  spent = false,
  done = false,
  off = false,
  small = false,
  tint,
  className,
  style,
  children,
  ...rest
}: PolymorphicProps<E, { solid?: boolean; live?: boolean; spent?: boolean; done?: boolean; off?: boolean; small?: boolean; tint?: string }>) {
  const As = (as ?? 'span') as ElementType;
  return (
    <As
      className={cx(
        'jk-chip',
        solid && 'jk-chip-solid',
        live && 'jk-chip-live',
        spent && 'jk-chip-spent',
        done && 'jk-chip-done',
        off && 'jk-chip-off',
        small && 'jk-chip-sm',
        className,
      )}
      style={tint ? { ...style, ['--jk-tint' as string]: tint } : style}
      {...rest}
    >
      {children}
    </As>
  );
}

/** Flat SECONDARY text. */
export function Sub<E extends ElementType = 'span'>({ as, className, children, ...rest }: PolymorphicProps<E>) {
  const As = (as ?? 'span') as ElementType;
  return <As className={cx('jk-sub', className)} {...rest}>{children}</As>;
}

/** Flat SECONDARY link (underlined). */
export function SubLink<E extends ElementType = 'a'>({ as, className, children, ...rest }: PolymorphicProps<E>) {
  const As = (as ?? 'a') as ElementType;
  return <As className={cx('jk-sub-link', className)} {...rest}>{children}</As>;
}

/** Inset accent-tinted container (debossed on paper, emissive in CRT).
 *  `tint` retints the fill (and dark-mode glow) in a data colour via --jk-tint. */
export function Well<E extends ElementType = 'span'>({
  as,
  tint,
  className,
  style,
  children,
  ...rest
}: PolymorphicProps<E, { tint?: string }>) {
  const As = (as ?? 'span') as ElementType;
  return (
    <As
      className={cx('jk-well', className)}
      style={tint ? { ...style, ['--jk-tint' as string]: tint } : style}
      {...rest}
    >
      {children}
    </As>
  );
}

/** Card surface. */
export function Sheet<E extends ElementType = 'div'>({ as, className, children, ...rest }: PolymorphicProps<E>) {
  const As = (as ?? 'div') as ElementType;
  return <As className={cx('jk-sheet', className)} {...rest}>{children}</As>;
}

/** Uppercase mono label. `size`: 'md' (default) | 'sm' | 'xs'. `sans` swaps the
 *  mono face for the UI sans (the blessed eyebrow variant). */
export function Lab<E extends ElementType = 'div'>({
  as,
  size = 'md',
  sans = false,
  className,
  children,
  ...rest
}: PolymorphicProps<E, { size?: 'md' | 'sm' | 'xs'; sans?: boolean }>) {
  const As = (as ?? 'div') as ElementType;
  return (
    <As
      className={cx('jk-lab', size === 'sm' && 'jk-lab-sm', size === 'xs' && 'jk-lab-xs', sans && 'jk-lab-sans', className)}
      {...rest}
    >
      {children}
    </As>
  );
}

/** Compact mono text button. `quiet` for the de-emphasised variant. */
export function TButton<E extends ElementType = 'button'>({
  as,
  quiet = false,
  className,
  children,
  ...rest
}: PolymorphicProps<E, { quiet?: boolean }>) {
  const As = (as ?? 'button') as ElementType;
  return (
    <As className={cx('jk-tbtn', quiet && 'jk-tbtn-quiet', className)} {...rest}>
      {children}
    </As>
  );
}

/** Status pill — defaults to the OK/green status. */
export function Pill<E extends ElementType = 'span'>({ as, className, children, ...rest }: PolymorphicProps<E>) {
  const As = (as ?? 'span') as ElementType;
  return <As className={cx('jk-pill', className)} {...rest}>{children}</As>;
}

/** Progress meter — a `.bar-track` well with a tint-deepened fill.
 *
 *  The gradient runs from the tint deepened toward --bar-deepen-ink to the tint
 *  itself, which is exactly how --hub-amber-dim → --hub-amber works, generalised
 *  to an arbitrary per-item hue. It lived open-coded at six call sites before
 *  this, each inlining the deepen ink as a raw hex — a §13.3 fence violation
 *  that this component makes structurally unrepeatable.
 *
 *  `value` is 0–1 and clamps. `height` is the one number that varies by context:
 *  5 on a rail card, 6 inside a branch row, 7 on the forge header. */
export function Bar({
  value,
  tint = 'var(--accent)',
  height = 5,
  radius,
  className,
  style,
  ...rest
}: Omit<HTMLAttributes<HTMLDivElement>, 'children'> & {
  value: number;
  tint?: string;
  height?: number;
  radius?: number;
}) {
  const pct = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)) * 100;
  const r = radius ?? Math.round(height / 2) + 1;
  return (
    <div
      className={cx('bar-track', className)}
      style={{ height, borderRadius: r, ...style }}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      {...rest}
    >
      <div
        className="bar-fill"
        style={{
          width: `${pct}%`,
          height: '100%',
          background: `linear-gradient(90deg, color-mix(in srgb, ${tint} 72%, var(--bar-deepen-ink)), ${tint})`,
        }}
      />
    </div>
  );
}

/** The print idiom for nothing-here (§15.3): an italic Fraunces line over a mono
 *  sub. The component owns the TREATMENT; the copy is a prop, so each view still
 *  speaks for itself.
 *
 *  NOT over a drawn grid. The calendar bodies used to float one of these over an
 *  empty Day/Week/Month ("A clean week. Nothing set in type yet.") and it read as
 *  debris laid on a surface that already said "empty" by being empty. Removed
 *  2026-08-12. Use this where nothing is drawn at all — a list pane, a results
 *  panel — and let structured surfaces speak for themselves. */
export function EmptyState({
  line,
  sub,
  className,
  style,
  ...rest
}: Omit<HTMLAttributes<HTMLDivElement>, 'children'> & { line: ReactNode; sub?: ReactNode }) {
  return (
    <div
      className={className}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 7,
        padding: '28px 20px',
        textAlign: 'center',
        ...style,
      }}
      {...rest}
    >
      <span
        style={{
          fontFamily: 'var(--hub-font-serif)',
          fontStyle: 'italic',
          fontSize: 15,
          color: 'var(--color-muted)',
        }}
      >
        {line}
      </span>
      {sub != null && <span className="mono-eyebrow" style={{ fontSize: 8 }}>{sub}</span>}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   Print marks (Full Press, Wave 23) — thin wrappers over the .jk-rule* /
   .jk-folio / .jk-colophon classes. Doctrine: content is named in PRINT
   (<Folio>); .label-tape stays for machine chrome. Same scarcity rule as the
   hardware — one folio names THE content panel, one colophon closes THE sheet.
   ───────────────────────────────────────────────────────────────────────────── */

/** Editorial rule — the <hr> face of the rules ladder. `weight`: 'hairline'
 *  (default — rows, exhibits) | 'strong' (chapter heads) | 'double' (the
 *  contents block, the colophon). */
export function Rule<E extends ElementType = 'hr'>({
  as,
  weight = 'hairline',
  className,
  ...rest
}: PolymorphicProps<E, { weight?: 'hairline' | 'strong' | 'double' }>) {
  const As = (as ?? 'hr') as ElementType;
  return (
    <As
      className={cx(
        weight === 'strong' ? 'jk-rule-strong' : weight === 'double' ? 'jk-rule-double' : 'jk-rule',
        className,
      )}
      {...rest}
    />
  );
}

/** The folio mark — names CONTENT in print: running-head rules above/below,
 *  serif caps, with `no` filling the accent-italic number/count slot
 *  ("No. 4", "3 / 12"). Chrome keeps `.label-tape`; content takes the folio. */
export function Folio<E extends ElementType = 'span'>({
  as,
  no,
  className,
  children,
  ...rest
}: PolymorphicProps<E, { no?: ReactNode }>) {
  const As = (as ?? 'span') as ElementType;
  return (
    <As className={cx('jk-folio', className)} {...rest}>
      {children}
      {no != null && <span className="jk-folio-no">{no}</span>}
    </As>
  );
}

/** The colophon — the end-of-sheet record: centre-set serif over the accent
 *  fleuron (which halates in CRT). One per sheet, at the foot. */
export function Colophon<E extends ElementType = 'div'>({ as, className, children, ...rest }: PolymorphicProps<E>) {
  const As = (as ?? 'div') as ElementType;
  return <As className={cx('jk-colophon', className)} {...rest}>{children}</As>;
}

/* ─────────────────────────────────────────────────────────────────────────────
   Toggles, meters, and CRT atmosphere.

   Switch/Check are controlled: pass `checked` + `onChange`. They render a real
   <button role="switch|checkbox"> so the tap-floor + aria-state styling apply.
   VU is a segmented level bar. Scanlines/Vignette/Scrim are the shared veils —
   all driven by the factory's CRT + scrim tokens, never per-app opacity literals.
   ───────────────────────────────────────────────────────────────────────────── */

type ToggleProps = Omit<HTMLAttributes<HTMLButtonElement>, 'onChange'> & {
  checked: boolean;
  onChange?: (next: boolean) => void;
  /** Retint the checked fill in a data colour via --jk-tint. */
  tint?: string;
  disabled?: boolean;
};

/** Sliding on/off switch. */
export function Switch({ checked, onChange, tint, className, style, ...rest }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={cx('jk-switch', className)}
      style={tint ? { ...style, ['--jk-tint' as string]: tint } : style}
      onClick={() => onChange?.(!checked)}
      {...rest}
    >
      <span className="jk-switch-knob" aria-hidden="true" />
    </button>
  );
}

/** Square checkbox. Shows a ✓ mark (or `children`) when checked. */
export function Check({ checked, onChange, tint, className, style, children, ...rest }: ToggleProps & { children?: ReactNode }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      className={cx('jk-check', className)}
      style={tint ? { ...style, ['--jk-tint' as string]: tint } : style}
      onClick={() => onChange?.(!checked)}
      {...rest}
    >
      {children ?? (
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path d="M2.5 6.5L5 9L9.5 3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="square" />
        </svg>
      )}
    </button>
  );
}

/** Continuous range control — the house fader. Controlled: pass `value` +
 *  `onChange`. Renders a real <input type="range"> so keyboard/step/aria come
 *  from the platform; the elapsed fill is painted from the value via
 *  --jk-slider-fill, and `tint` recolours it (and the CRT cap glow) via --jk-tint.
 *
 *  `onChange` fires on every move (live value); `onCommit` fires once the drag /
 *  key press is released — the split a seek control needs, so it can preview
 *  without committing a seek per pixel. */
export function Slider({
  value,
  min = 0,
  max = 100,
  step = 1,
  onChange,
  onCommit,
  tint,
  className,
  style,
  ...rest
}: Omit<ComponentPropsWithoutRef<'input'>, 'value' | 'onChange' | 'type'> & {
  value: number;
  min?: number;
  max?: number;
  step?: number | 'any';
  onChange?: (next: number) => void;
  onCommit?: (next: number) => void;
  tint?: string;
}) {
  const span = max - min;
  const pct = span > 0 ? ((Math.max(min, Math.min(max, value)) - min) / span) * 100 : 0;
  const commit = () => onCommit?.(value);
  // `rest` is spread BEFORE the wiring, not after: the four release events are this
  // component's commit contract, so a caller passing its own onKeyUp must not silently
  // disable the commit. Everything a caller legitimately overrides (className, style)
  // is destructured above and merged explicitly.
  return (
    <input
      {...rest}
      type="range"
      className={cx('jk-slider', className)}
      min={min}
      max={max}
      step={step}
      value={value}
      style={{
        ...style,
        ['--jk-slider-fill' as string]: `${pct}%`,
        ...(tint ? { ['--jk-tint' as string]: tint } : null),
      }}
      onChange={(e) => onChange?.(Number(e.currentTarget.value))}
      onPointerUp={commit}
      onMouseUp={commit}
      onTouchEnd={commit}
      onKeyUp={commit}
    />
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   Fields — the WRITE half of the control set.

   Every one of these hosts a real form element, so validation, IME, autofill and
   the keyboard stay the platform's job; the classes only take the OS *paint*
   away (see the .jk-field block in hub.css for why that mattered). They are
   uncontrolled-friendly wrappers: pass `value`/`onChange` or `defaultValue`
   exactly as you would to the bare element.
   ───────────────────────────────────────────────────────────────────────────── */

/** Size rung shared by every field: 'md' (default) | 'sm' (dense editors). */
type FieldSize = 'md' | 'sm';

const fieldCx = (size: FieldSize, display: boolean, className?: string, bare?: boolean) =>
  cx('jk-field', bare ? 'jk-field-bare' : size === 'sm' && 'jk-field-sm',
     !bare && display && 'jk-field-title', className);

/* All four forward refs. A form primitive that swallows the ref is a trap: the
 * caller reaches for `.focus()`, `.select()`, a drop target or a measurement,
 * gets `null`, and the failure is silent. */

/** Single-line text field. `display` sets it in the display serif — one per form,
 *  for the thing being named, so a name reads as a name and not as another
 *  parameter of the thing. (Named `display` rather than `title` because `title`
 *  is a real HTML attribute these fields carry tooltips in; intersecting the two
 *  makes the prop uninhabitable.) */
/** `bare` drops the slot — no face, no recess, no padding, type and colour
 *  inherited — for edits that happen inside running text or on a coloured band,
 *  where a debossed box would put a control where a piece of writing is. It
 *  keeps the whole native-chrome reset, which is the point. */
export const Field = forwardRef<
  HTMLInputElement,
  Omit<ComponentPropsWithoutRef<'input'>, 'size'> &
    { size?: FieldSize; display?: boolean; bare?: boolean }
>(function Field({ size = 'md', display = false, bare = false, className, ...rest }, ref) {
  return <input {...rest} ref={ref} className={fieldCx(size, display, className, bare)} />;
});

/** Multi-line field. Resizes vertically only — a textarea that can be dragged
 *  wider breaks whatever row it sits in. */
export const TextArea = forwardRef<
  HTMLTextAreaElement,
  ComponentPropsWithoutRef<'textarea'> & { size?: FieldSize; bare?: boolean }
>(function TextArea({ size = 'md', bare = false, className, ...rest }, ref) {
  return <textarea {...rest} ref={ref} className={fieldCx(size, false, className, bare)} />;
});

/** Select with the house caret. The OS arrow is gone (`appearance: none`), so
 *  the wrapper draws one — which is also why this returns a wrapper rather than
 *  a bare `<select>`: there is nowhere on a `<select>` to hang a pseudo-element.
 *  `wrapperStyle` sizes the GROUP (the select fills it), which is what a flex
 *  row wants to lay out. */
export const SelectField = forwardRef<
  HTMLSelectElement,
  // `size` is Omitted, not merged: <select> has its own numeric `size` attribute
  // (the visible-row count), and intersecting it with the rung would make the
  // prop uninhabitable.
  Omit<ComponentPropsWithoutRef<'select'>, 'size'> & {
    size?: FieldSize;
    wrapperClassName?: string;
    wrapperStyle?: CSSProperties;
  }
>(function SelectField({ size = 'md', className, wrapperClassName, wrapperStyle, children, ...rest }, ref) {
  return (
    <span className={cx('jk-field-sel', wrapperClassName)} style={wrapperStyle}>
      <select {...rest} ref={ref} className={fieldCx(size, false, className)}>
        {children}
      </select>
    </span>
  );
});

/** Number field with the house stepper — the replacement for the browser's white
 *  increment buttons.
 *
 *  The carets drive the input's own `stepUp()`/`stepDown()`, so `min`/`max`/`step`
 *  behave exactly as the native chrome did, including the clamping. The value is
 *  then read back off the element and dispatched through the SAME onChange the
 *  caller already passes for typing — a controlled field would otherwise snap
 *  straight back to its prop, which is the classic way a hand-rolled stepper
 *  ends up doing nothing at all.
 *
 *  React's `onChange` is a synthetic wrapper over `input`, and `stepUp()` fires
 *  no event, so the event has to be dispatched by hand for the caller's handler
 *  to see it. `.set` off the prototype descriptor is what makes React notice the
 *  change: React tracks the last value it wrote on the node, and assigning
 *  `el.value` directly updates that tracker, so the event it does receive looks
 *  like a no-op and is swallowed. */
export const NumField = forwardRef<
  HTMLInputElement,
  Omit<ComponentPropsWithoutRef<'input'>, 'size' | 'type'> & {
    size?: FieldSize;
    wrapperClassName?: string;
    wrapperStyle?: CSSProperties;
  }
>(function NumField({ size = 'md', className, wrapperClassName, wrapperStyle, ...rest }, forwarded) {
  const ref = useRef<HTMLInputElement | null>(null);
  const step = (dir: 'up' | 'down') => {
    const el = ref.current;
    if (!el || el.disabled || el.readOnly) return;
    // An empty field has no value to step FROM; stepUp() throws on some engines
    // and silently no-ops on others, so seed it from min (or 0) first.
    if (el.value === '') el.value = el.min !== '' ? el.min : '0';
    else if (dir === 'up') el.stepUp();
    else el.stepDown();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    const next = el.value;
    if (setter) { el.value = ''; setter.call(el, next); }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.focus();
  };
  // The stepper needs the node, and so may the caller. Keep the internal ref and
  // pass the node on to whatever the caller handed us.
  const attach = (el: HTMLInputElement | null) => {
    ref.current = el;
    if (typeof forwarded === 'function') forwarded(el);
    else if (forwarded) forwarded.current = el;
  };
  return (
    <span className={cx('jk-field-num', wrapperClassName)} style={wrapperStyle}>
      <input {...rest} ref={attach} type="number" className={fieldCx(size, false, className)} />
      {/* tabIndex -1: the arrow keys already step a focused number field, so the
          carets are a pointer affordance. Putting them in the tab order would
          add two stops per number to a form that has a dozen of them. */}
      <button
        type="button" tabIndex={-1} aria-hidden="true"
        className="jk-field-step" data-step="up"
        onClick={() => step('up')}
      />
      <button
        type="button" tabIndex={-1} aria-hidden="true"
        className="jk-field-step" data-step="down"
        onClick={() => step('down')}
      />
    </span>
  );
});

/* The typed fields below are deliberately thin. `<Field type="date">` would pick
 * up identical styling — what these buy is that the type is not a stringly-typed
 * prop a call site can typo, and that there is one obvious name to reach for, so
 * the next date input doesn't get hand-rolled next to a bespoke style object. */

/** Date field. The inline segments (mm/dd/yyyy) are drawn by hub.css; the
 *  calendar it drops is the engine's own popup — no engine exposes it to CSS in
 *  any form, so `color-scheme` on :root is the entire lever over it, and it is
 *  why that declaration exists. It comes up dark on the tube and light on paper. */
export const DateField = forwardRef<
  HTMLInputElement,
  Omit<ComponentPropsWithoutRef<'input'>, 'size' | 'type'> & { size?: FieldSize }
>(function DateField({ size = 'md', className, ...rest }, ref) {
  return <input {...rest} ref={ref} type="date" className={fieldCx(size, false, className)} />;
});

/** Time field. Same story as DateField — and the same reason the segment you are
 *  editing no longer fills with Chrome's blue highlight. */
export const TimeField = forwardRef<
  HTMLInputElement,
  Omit<ComponentPropsWithoutRef<'input'>, 'size' | 'type'> & { size?: FieldSize }
>(function TimeField({ size = 'md', className, ...rest }, ref) {
  return <input {...rest} ref={ref} type="time" className={fieldCx(size, false, className)} />;
});

/** Search field. `type="search"` for the semantics and the mobile keyboard; the
 *  OS clear × it normally brings is stripped in hub.css. */
export const SearchField = forwardRef<
  HTMLInputElement,
  Omit<ComponentPropsWithoutRef<'input'>, 'size' | 'type'> & { size?: FieldSize }
>(function SearchField({ size = 'md', className, ...rest }, ref) {
  return <input {...rest} ref={ref} type="search" className={fieldCx(size, false, className)} />;
});

/** Disclosure. A real `<details>`, so it keeps find-in-page, the toggle event and
 *  the built-in semantics; `.jk-fold` swaps the OS triangle for the house caret —
 *  the same mark the select picker turns when it opens. */
export const Fold = forwardRef<
  HTMLDetailsElement,
  ComponentPropsWithoutRef<'details'> & { summary: ReactNode; summaryClassName?: string }
>(function Fold({ summary, summaryClassName, className, children, ...rest }, ref) {
  return (
    <details {...rest} ref={ref} className={cx('jk-fold', className)}>
      <summary className={summaryClassName}>{summary}</summary>
      {children}
    </details>
  );
});

/** Segmented VU / level meter. `value` 0–1 lights the first N of `segments`. */
export function VU({
  value,
  segments = 20,
  tint,
  className,
  style,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { value: number; segments?: number; tint?: string }) {
  const lit = Math.round(Math.max(0, Math.min(1, value)) * segments);
  return (
    <div
      className={cx('jk-vu', className)}
      style={tint ? { ...style, ['--jk-tint' as string]: tint } : style}
      role="meter"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={1}
      {...rest}
    >
      {Array.from({ length: segments }, (_, i) => (
        <span key={i} className={cx('jk-vu-seg', i < lit && 'on')} />
      ))}
    </div>
  );
}

/** CRT scanline veil — absolute overlay; host needs `position`. */
export function Scanlines(props: HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden="true" {...props} className={cx('jk-scanlines', props.className)} />;
}

/** CRT halation vignette veil — absolute overlay; host needs `position`. */
export function Vignette(props: HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden="true" {...props} className={cx('jk-vignette', props.className)} />;
}

/** Modal backdrop scrim. `heavy` for opaque covers. */
export function Scrim({ heavy = false, className, ...rest }: HTMLAttributes<HTMLDivElement> & { heavy?: boolean }) {
  return <div {...rest} className={cx('jk-scrim', heavy && 'jk-scrim-heavy', className)} />;
}
