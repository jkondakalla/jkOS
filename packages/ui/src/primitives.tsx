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

/** Inset accent-tinted container (debossed on paper, emissive in CRT). */
export function Well({ as: As = 'span', className, children, ...rest }: BaseProps) {
  return <As className={cx('jk-well', className)} {...rest}>{children}</As>;
}

/** Card surface. */
export function Sheet({ as: As = 'div', className, children, ...rest }: BaseProps) {
  return <As className={cx('jk-sheet', className)} {...rest}>{children}</As>;
}
