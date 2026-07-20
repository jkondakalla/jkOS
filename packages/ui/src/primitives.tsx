import type { ComponentPropsWithoutRef, ElementType, HTMLAttributes, ReactNode } from 'react';

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
 *  the faint base. */
export function Chip<E extends ElementType = 'span'>({
  as,
  solid = true,
  live = false,
  done = false,
  small = false,
  tint,
  className,
  style,
  children,
  ...rest
}: PolymorphicProps<E, { solid?: boolean; live?: boolean; done?: boolean; small?: boolean; tint?: string }>) {
  const As = (as ?? 'span') as ElementType;
  return (
    <As
      className={cx(
        'jk-chip',
        solid && 'jk-chip-solid',
        live && 'jk-chip-live',
        done && 'jk-chip-done',
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
