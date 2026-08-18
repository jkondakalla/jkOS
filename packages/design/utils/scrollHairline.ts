/**
 * installScrollHairline — the one rung of the suite scrollbar that CSS cannot
 * reach on its own.
 *
 * The hairline (hub.css, "Scrollbars — THE HAIRLINE") has three rungs: a quiet
 * resting mark, a deepened mark while you are IN the pane, and a bright one with
 * the pointer on the mark itself. The middle rung is `:hover` — and `:hover` is
 * wrong about a pane that is moving without a pointer over it, which is most
 * scrolling that actually happens: a wheel fling that carries past the pane, a
 * trackpad momentum scroll, PageDown, a `scrollIntoView` from a deep link, the
 * whole of touch. In every one of those the mark stays at rest exactly while the
 * content is racing past it, which is the one moment it is worth seeing.
 *
 * So: one capture-phase `scroll` listener on the document stamps `data-scrolling`
 * on whatever scrolled, and drops it after the motion stops. hub.css matches
 * `[data-scrolling]::-webkit-scrollbar-thumb` alongside `:hover`, so the two
 * rungs are the same rung and neither knows about the other.
 *
 * WHY CAPTURE. `scroll` does not bubble from an element (only the document's own
 * scroll reaches window through the document). Capture is the only phase in which
 * one listener at the top sees every pane's scroll, which is the difference
 * between this being a one-line install and every scrolling div in five apps
 * needing a ref and a handler.
 *
 * WHY AN ATTRIBUTE AND NOT A CLASS. `className` is React's to own — writing a
 * class onto a node React also renders is how you get a class that vanishes on
 * the next re-render (or worse, survives one it should not have). A `data-`
 * attribute React was never told about is left alone by reconciliation.
 *
 * WHO CALLS IT. injectJkOSTheme(), which every app in the suite already calls once
 * at boot to get its accent and neutrals. Hanging the install there rather than
 * exporting it for five apps to remember is the same discipline the rest of this
 * package uses: one funnel, so a new app cannot ship with the mark half-wired.
 * It stays exported for a host that wants to install or tear it down itself.
 *
 * PURE ENHANCEMENT. Without it the pointer rungs still work and the resting mark
 * is still painted, which is why the static jkAuth pages can skip it entirely.
 * Safe to call more than once — the second call is a no-op, so an app that mounts
 * two shells (or remounts one under StrictMode) does not stack listeners.
 */

const FLAG = '__jkosScrollHairline';
/** How long after the last scroll event the mark stays deepened. Long enough to
 *  cover the gap between the discrete events of a slow wheel, short enough that a
 *  pane you have stopped reading goes quiet while you are still looking at it. */
const LINGER_MS = 850;

const timers = new WeakMap<Element, ReturnType<typeof setTimeout>>();

export function installScrollHairline(doc: Document = globalThis.document): () => void {
  if (!doc || (doc as any)[FLAG]) return () => {};
  (doc as any)[FLAG] = true;

  const onScroll = (e: Event) => {
    /* The document's own scroll reports `document` as the target, and only an
       Element can carry an attribute — hand that case to <html>, which is the
       element whose scrollbar actually moved. */
    const t = e.target;
    const el: Element | null =
      t instanceof Element ? t : t === doc ? doc.documentElement : null;
    if (!el) return;

    el.setAttribute('data-scrolling', '');
    const prev = timers.get(el);
    if (prev) clearTimeout(prev);
    timers.set(el, setTimeout(() => {
      el.removeAttribute('data-scrolling');
      timers.delete(el);
    }, LINGER_MS));
  };

  doc.addEventListener('scroll', onScroll, true);
  return () => {
    doc.removeEventListener('scroll', onScroll, true);
    (doc as any)[FLAG] = false;
  };
}
