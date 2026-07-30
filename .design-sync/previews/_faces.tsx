/* Both faces, side by side — the shared helper every jkOS preview uses.
 *
 * WHY AN IFRAME. jkOS's dark face is gated on `:root[data-mode="dark"]`, i.e.
 * the attribute must sit on the DOCUMENT element. One document can therefore
 * only ever be one face, and a card that showed paper alone would misrepresent
 * half the design system. Each face gets its own document, the shared
 * `styles.css` is linked into it, `data-mode` is set on ITS root, and the cell
 * content is portalled in. Same-origin, so no serialisation and no srcdoc.
 *
 * Paper and the tube are NOT one design with a palette swap: paper presses ink
 * INTO the sheet (bevel, deepened accent, debossed wells), the tube EMITS
 * (halation, raw accent, lit scanlines). Every preview shows both so the two
 * philosophies stay visible side by side.
 *
 * NOTE the labels are rendered in the PARENT document, deliberately: the render
 * check reads the root's textContent, and a root containing only iframes looks
 * empty to it and would collapse the card to the floor.
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const STYLES =
  typeof document !== 'undefined'
    ? new URL('../../../styles.css', document.baseURI).href
    : '';

type FaceProps = {
  mode: 'light' | 'dark';
  label: string;
  height: number;
  children: React.ReactNode;
};

function Face({ mode, label, height, children }: FaceProps) {
  const ref = useRef<HTMLIFrameElement | null>(null);
  const [body, setBody] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const doc = ref.current?.contentDocument;
    if (!doc) return;
    doc.documentElement.setAttribute('data-mode', mode);
    const link = doc.createElement('link');
    link.rel = 'stylesheet';
    link.href = STYLES;
    doc.head.appendChild(link);
    // The ground comes from styles.css (html body); only the harness reset here.
    doc.body.style.margin = '0';
    doc.body.style.minHeight = '100%';
    setBody(doc.body);
  }, [mode]);

  return (
    <div style={{ minWidth: 0 }}>
      <div
        style={{
          fontFamily: 'var(--hub-font-mono)',
          fontSize: 9,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: 'var(--color-faint)',
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <iframe
        ref={ref}
        title={label}
        style={{
          width: '100%',
          height,
          border: '1px solid var(--color-line)',
          borderRadius: 'var(--hub-radius-sm)',
          display: 'block',
          background: mode === 'dark' ? '#0b0a08' : 'var(--color-paper)',
        }}
      />
      {body && createPortal(children as React.ReactElement, body)}
    </div>
  );
}

/** Render a cell's content on BOTH faces.
 *  `height` is the inner document height in px — pick one that fits the content
 *  without leaving dead space. `stacked` puts the faces one above the other
 *  instead of side by side: use it for anything that needs the full card width
 *  to be legible (the calendar grids, the settings drawer, a chrome bar). */
export function Faces({
  height = 220,
  stacked = false,
  children,
}: {
  height?: number;
  stacked?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: stacked ? '1fr' : '1fr 1fr',
        gap: 14,
        padding: '16px 18px',
        alignItems: 'start',
      }}
    >
      <Face mode="light" label="Paper" height={height}>
        {children}
      </Face>
      <Face mode="dark" label="Tube" height={height}>
        {children}
      </Face>
    </div>
  );
}
