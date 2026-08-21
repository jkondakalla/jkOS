// components/icons.tsx — the navigation and action glyphs the new screens need.
// Same house rule as player/icons.tsx and @jkos/player/ui's set: `currentColor`
// everywhere, no fills of their own, so the host button's `color` drives them and
// a glyph on glass inherits the glass's ink without a second stylesheet.
//
// The player's own transport glyphs are NOT re-declared here — play/pause/prev/
// next/close/grip/spinner come from @jkos/player/ui, and shuffle/repeat/volume/
// queue from player/icons.tsx. This file holds only what neither already ships.

interface GlyphProps {
  size?: number;
}

const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

export function IconHome({ size = 22 }: GlyphProps = {}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3.5 10.5 12 4l8.5 6.5V19a1.5 1.5 0 0 1-1.5 1.5h-3.5v-6h-7v6H5A1.5 1.5 0 0 1 3.5 19z" {...S} />
    </svg>
  );
}

/** Browse — a shelf of records seen edge-on. */
export function IconLibrary({ size = 22 }: GlyphProps = {}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3.5" y="4.5" width="4" height="15" rx="1" {...S} />
      <rect x="10" y="4.5" width="4" height="15" rx="1" {...S} />
      <path d="M17.2 5.6l3.1 13.2" {...S} />
    </svg>
  );
}

export function IconSearch({ size = 22 }: GlyphProps = {}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="11" cy="11" r="6.2" {...S} />
      <path d="m15.6 15.6 4.4 4.4" {...S} />
    </svg>
  );
}

/** The vibe map — a field of points with a dropped pin. */
export function IconMap({ size = 22 }: GlyphProps = {}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="6" cy="7" r="1.4" fill="currentColor" opacity="0.5" />
      <circle cx="6.5" cy="16" r="1.4" fill="currentColor" opacity="0.5" />
      <circle cx="17.5" cy="9" r="1.4" fill="currentColor" opacity="0.5" />
      <circle cx="16" cy="18" r="1.4" fill="currentColor" opacity="0.5" />
      <path d="M12 20.5s4.4-4.6 4.4-7.7a4.4 4.4 0 1 0-8.8 0c0 3.1 4.4 7.7 4.4 7.7z" {...S} />
      <circle cx="12" cy="12.6" r="1.6" fill="currentColor" />
    </svg>
  );
}

/** Chevron — direction set by the caller via `dir`. */
export function IconChevron({ size = 20, dir = 'right' }: GlyphProps & { dir?: 'up' | 'down' | 'left' | 'right' }) {
  const rot = { up: 270, right: 0, down: 90, left: 180 }[dir];
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ transform: `rotate(${rot}deg)` }}>
      <path d="m9.5 5.5 6.5 6.5-6.5 6.5" {...S} />
    </svg>
  );
}

/** "Play next" — a queue whose top slot is being filled. Deliberately DIFFERENT
 *  from IconAdd: the brief calls out that "Play next" and "Add to queue" must
 *  read as two distinct actions, which means two distinct glyphs, not one glyph
 *  with two labels. */
export function IconPlayNext({ size = 20 }: GlyphProps = {}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h9M4 12h6" {...S} />
      <path d="M4 17h5" {...S} opacity="0.45" />
      <path d="m15 10.5 5 3-5 3z" fill="currentColor" />
    </svg>
  );
}

/** "Add to queue" — the same list, appended at the BOTTOM. */
export function IconAddQueue({ size = 20 }: GlyphProps = {}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h12M4 12h12M4 17h6" {...S} />
      <path d="M16.5 15v5M14 17.5h5" {...S} />
    </svg>
  );
}

/** Radio / "start a station from here" — broadcast arcs. */
export function IconRadio({ size = 20 }: GlyphProps = {}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="2.2" fill="currentColor" />
      <path d="M8.2 8.2a5.4 5.4 0 0 0 0 7.6M15.8 15.8a5.4 5.4 0 0 0 0-7.6" {...S} />
      <path d="M5.5 5.5a9.2 9.2 0 0 0 0 13M18.5 18.5a9.2 9.2 0 0 0 0-13" {...S} opacity="0.5" />
    </svg>
  );
}

export function IconMore({ size = 20 }: GlyphProps = {}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="5.5" cy="12" r="1.6" fill="currentColor" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" />
      <circle cx="18.5" cy="12" r="1.6" fill="currentColor" />
    </svg>
  );
}

export function IconChevronDown({ size = 22 }: GlyphProps = {}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="m5.5 9.5 6.5 6.5 6.5-6.5" {...S} />
    </svg>
  );
}

/** The drag handle for queue reordering. The brief asks for "a real grab
 *  handle" — a visible affordance, not a whole-row drag that fights scrolling. */
export function IconGrip({ size = 20 }: GlyphProps = {}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="9" cy="7" r="1.35" fill="currentColor" />
      <circle cx="15" cy="7" r="1.35" fill="currentColor" />
      <circle cx="9" cy="12" r="1.35" fill="currentColor" />
      <circle cx="15" cy="12" r="1.35" fill="currentColor" />
      <circle cx="9" cy="17" r="1.35" fill="currentColor" />
      <circle cx="15" cy="17" r="1.35" fill="currentColor" />
    </svg>
  );
}

export function IconTrash({ size = 18 }: GlyphProps = {}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 7h14M10 7V5.5A1.5 1.5 0 0 1 11.5 4h1A1.5 1.5 0 0 1 14 5.5V7M6.5 7l.8 11.6A1.5 1.5 0 0 0 8.8 20h6.4a1.5 1.5 0 0 0 1.5-1.4L17.5 7" {...S} />
    </svg>
  );
}

/** An arc glyph for a Run — the shape of the set, drawn. `arc` picks the curve so
 *  "Build", "Wind down" and "Arc" are distinguishable at a glance in the rail. */
export function IconArc({ size = 20, arc = 'rise' }: GlyphProps & { arc?: string }) {
  const d = arc === 'wind_down' ? 'M4 7c4 0 8 4 16 10'
    : arc === 'peak' ? 'M4 18c4 0 5-11 8-11s4 11 8 11'
    : 'M4 17C12 17 16 7 20 7';
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d={d} {...S} />
    </svg>
  );
}

export function IconClock({ size = 20 }: GlyphProps = {}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8" {...S} />
      <path d="M12 7.5V12l3 2" {...S} />
    </svg>
  );
}
