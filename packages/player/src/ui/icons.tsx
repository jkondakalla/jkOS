// icons.tsx — the kit's inline glyphs, lifted verbatim from papyros PlayerBar.tsx
// (currentColor everywhere; the host button's `color` drives them — no hardcoded
// stroke/fill colours). Exported so an app's bespoke controls can compose the same
// glyphs its stock neighbours render (papyros's bookmark rows reuse IconClose).

export function IconPlay() {
  return <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor" /></svg>;
}
export function IconPause() {
  return <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor" /></svg>;
}
export function IconSpinner() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" className="pb-spin">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2.2" opacity="0.25" />
      <path d="M12 3a9 9 0 0 1 9 9" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}
/** Circular skip arrow with the second count in its bowl — mirrored for back vs
 *  forward. papyros's IconSkip generalized only in the number it prints (was a
 *  hardcoded "30"; identical output for seconds === 30). */
export function IconSkipArrow({ dir, seconds }: { dir: 'back' | 'fwd'; seconds: number }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" style={dir === 'fwd' ? { transform: 'scaleX(-1)' } : undefined}>
      <path d="M12 6V3L7 7l5 4V8a5 5 0 1 1-5 5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <text x="12.5" y="16.5" textAnchor="middle" fontSize="7" fontFamily="var(--hub-font-mono)" fill="currentColor" style={dir === 'fwd' ? { transform: 'scaleX(-1)', transformOrigin: '12.5px 14px' } : undefined}>{seconds}</text>
    </svg>
  );
}
export function IconPrev() {
  return <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 6v12M19 6l-9 6 9 6z" fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>;
}
export function IconNext() {
  return <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M17 6v12M5 6l9 6-9 6z" fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>;
}
export function IconMoon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a7 7 0 1 0 10.5 10.5z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /></svg>;
}
export function IconClose() {
  return <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>;
}
/** Drag-handle grip for <QueuePanel> rows. */
export function IconGrip() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <circle cx="9" cy="6" r="1.6" /><circle cx="15" cy="6" r="1.6" />
      <circle cx="9" cy="12" r="1.6" /><circle cx="15" cy="12" r="1.6" />
      <circle cx="9" cy="18" r="1.6" /><circle cx="15" cy="18" r="1.6" />
    </svg>
  );
}
/** Neutral artwork placeholder for <CoverArt> with no (or a 404'd) image. */
export function IconArtwork() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="4" width="16" height="16" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="3.5" fill="none" stroke="currentColor" strokeWidth="1.3" opacity="0.7" />
      <circle cx="12" cy="12" r="0.9" fill="currentColor" opacity="0.7" />
    </svg>
  );
}
