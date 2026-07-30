import { Vignette, Press, Lab, Sub } from '@jkos/ui';
import { Faces } from './_faces';

/* Halation is a property of the tube, so this page renders on the DARK face —
   on paper hub.css tunes the vignette down to nothing. Each component gets its
   own preview page, so this affects nothing else. */
/* Absolute overlay — the HOST must establish a positioning context. */
const host: React.CSSProperties = {
  position: 'relative',
  overflow: 'hidden',
  background: 'var(--color-paper-2)',
  border: '1px solid var(--color-line)',
  borderRadius: 'var(--hub-radius-widget)',
  padding: '26px 28px',
  width: 380,
  minHeight: 150,
};

const pad: React.CSSProperties = { padding: '18px 20px' };

/** The halation vignette over a screen area — the corners fall off toward the
 *  bezel the way a real tube does. */
export const OverAScreen = () => (
  <Faces height={200} stacked>
    <div style={pad}>
      <div style={host}>
        <Lab size="xs">Deck</Lab>
        <div style={{ fontFamily: 'var(--hub-font-mono)', fontSize: 34, margin: '10px 0 6px' }}>
          <Press large>14:20</Press>
        </div>
        <Sub>7 containers up · staging</Sub>
        <Vignette />
      </div>
    </div>
  </Faces>
);

/** Paired with the scanline veil — the two CRT marks are meant to layer. */
export const WithAndWithout = () => (
  <Faces height={200} stacked>
    <div style={{ ...pad, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
      <div style={{ ...host, width: 240, minHeight: 120 }}>
        <Lab size="xs">Plain</Lab>
        <div style={{ fontFamily: 'var(--hub-font-mono)', fontSize: 26, marginTop: 12 }}>14:20</div>
      </div>
      <div style={{ ...host, width: 240, minHeight: 120 }}>
        <Lab size="xs">Vignette</Lab>
        <div style={{ fontFamily: 'var(--hub-font-mono)', fontSize: 26, marginTop: 12 }}>14:20</div>
        <Vignette />
      </div>
    </div>
  </Faces>
);
