// player/icons.tsx — glyphs for the music-only controls @jkos/player/ui doesn't ship
// (ToDo.md §3 Wave 18, item 18.4 — see this wave's report on the ControlId/stock-part
// gap). Same house style as @jkos/player/ui's icons.tsx (currentColor everywhere, the
// host button's `color` drives them) and papyros PlayerBar.tsx's own bespoke
// IconBookmark/IconMore precedent — a control the kit doesn't stock gets its glyph
// defined locally, right next to the control that uses it.

export function IconShuffle() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M3 6h3.5l8 12H18M3 18h3.5l2.4-3.6M14.1 9.6 16.5 6H18"
        fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"
      />
      <path d="M15.5 4.5 18.5 6l-3 1.7zM15.5 19.5l3-1.5-3-1.7z" fill="currentColor" />
    </svg>
  );
}

/** Repeat-all — a closed loop of two arrows. */
export function IconRepeat() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M6 9V7a2 2 0 0 1 2-2h9M18 5v3M18 15v2a2 2 0 0 1-2 2H7M6 19v-3"
        fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"
      />
      <path d="M17 8l3-3-3-3zM7 16l-3 3 3 3z" fill="none" transform="translate(0,0)" />
      <path d="M15.5 3.5 18.5 6l-3 2.5z" fill="currentColor" />
      <path d="M8.5 20.5 5.5 18l3-2.5z" fill="currentColor" />
    </svg>
  );
}

/** Repeat-ONE — the same loop with a "1" badge, so the transport button's face can
 *  swap glyphs on the off/all/one cycle without a separate text badge. */
export function IconRepeatOne() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M6 9V7a2 2 0 0 1 2-2h9M18 5v3M18 15v2a2 2 0 0 1-2 2H7M6 19v-3"
        fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"
      />
      <path d="M15.5 3.5 18.5 6l-3 2.5z" fill="currentColor" />
      <path d="M8.5 20.5 5.5 18l3-2.5z" fill="currentColor" />
      <text x="12" y="15.5" textAnchor="middle" fontSize="8" fontFamily="var(--hub-font-mono)" fill="currentColor">1</text>
    </svg>
  );
}

export function IconVolume() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" />
      <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a9 9 0 0 1 0 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function IconVolumeMute() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" />
      <path d="M16 9.5l5 5M21 9.5l-5 5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

/** A stacked-lines "up next" glyph for the queue-opener button. */
export function IconQueue() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 6h12M4 12h12M4 18h8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M18 9v10M18 9l-3 3M18 9l3 3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
