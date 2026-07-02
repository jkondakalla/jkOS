import type { ElementType, HTMLAttributes, ReactNode } from 'react';

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

interface BaseProps extends HTMLAttributes<HTMLElement> {
  /** Render as a different element (default per component). */
  as?: ElementType;
  children?: ReactNode;
}

/** Single-element accent pill — struck (primary) or flat (secondary). */
export function Bubble({
  as: As = 'span',
  tone = 'primary',
  large = false,
  className,
  children,
  ...rest
}: BaseProps & { tone?: 'primary' | 'secondary'; large?: boolean }) {
  return (
    <As className={cx('jk-bubble', `jk-bubble-${tone}`, large && 'jk-bubble-lg', className)} {...rest}>
      {children}
    </As>
  );
}

/** Struck/pressed PRIMARY text. `large` for display sizes (clocks, hero figures). */
export function Press({ as: As = 'span', large = false, className, children, ...rest }: BaseProps & { large?: boolean }) {
  return (
    <As className={cx(large ? 'jk-press-lg' : 'jk-press', className)} {...rest}>
      {children}
    </As>
  );
}

/** Flat SECONDARY text. */
export function Sub({ as: As = 'span', className, children, ...rest }: BaseProps) {
  return <As className={cx('jk-sub', className)} {...rest}>{children}</As>;
}

/** Flat SECONDARY link (underlined). */
export function SubLink({ as: As = 'a', className, children, ...rest }: BaseProps) {
  return <As className={cx('jk-sub-link', className)} {...rest}>{children}</As>;
}

/** Inset accent-tinted container (debossed on paper, emissive in CRT).
 *  `tint` retints the fill (and dark-mode glow) in a data colour via --jk-tint. */
export function Well({ as: As = 'span', tint, className, style, children, ...rest }: BaseProps & { tint?: string }) {
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
export function Sheet({ as: As = 'div', className, children, ...rest }: BaseProps) {
  return <As className={cx('jk-sheet', className)} {...rest}>{children}</As>;
}

/** Uppercase mono label. `size`: 'md' (default) | 'sm' | 'xs'. `sans` swaps the
 *  mono face for the UI sans (the blessed eyebrow variant). */
export function Lab({
  as: As = 'div',
  size = 'md',
  sans = false,
  className,
  children,
  ...rest
}: BaseProps & { size?: 'md' | 'sm' | 'xs'; sans?: boolean }) {
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
export function TButton({
  as: As = 'button',
  quiet = false,
  className,
  children,
  ...rest
}: BaseProps & { quiet?: boolean }) {
  return (
    <As className={cx('jk-tbtn', quiet && 'jk-tbtn-quiet', className)} {...rest}>
      {children}
    </As>
  );
}

/** Status pill — defaults to the OK/green status. */
export function Pill({ as: As = 'span', className, children, ...rest }: BaseProps) {
  return <As className={cx('jk-pill', className)} {...rest}>{children}</As>;
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
