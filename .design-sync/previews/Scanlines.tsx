import { Scanlines, Press, Lab, Sub } from '@jkos/ui';
import { Faces } from './_faces';

/* Scanlines are a CRT veil — on the paper face hub.css tunes them to nothing,
   because there is no tube to emit. This page therefore renders on the DARK
   face, which is the only place the mark exists. Each component gets its own
   preview page, so this affects nothing else. */
/* The veil is an absolute overlay — the HOST must establish a positioning
   context, or it escapes to the nearest positioned ancestor. */
const host: React.CSSProperties = {
  position: 'relative',
  overflow: 'hidden',
  background: 'var(--color-paper-2)',
  border: '1px solid var(--color-line)',
  borderRadius: 'var(--hub-radius-widget)',
  padding: '22px 24px',
  width: 380,
  minHeight: 130,
};

const pad: React.CSSProperties = { padding: '18px 20px' };

/** The veil over a panel — `position: relative` on the host is required. */
export const OverAPanel = () => (
  <Faces height={200} stacked>
    <div style={pad}>
      <div style={host}>
        <Lab size="xs">Now playing</Lab>
        <div style={{ fontFamily: 'var(--hub-font-serif)', fontSize: 20, margin: '8px 0 4px' }}>
          <Press large>The Forge</Press>
        </div>
        <Sub>Chapter 4 · 12:04 remaining</Sub>
        <Scanlines />
      </div>
    </div>
  </Faces>
);

/* NOTE: there is deliberately no side-by-side "with / without" cell. On the dark
   face hub.css sets --crt-scanline-opacity: 0.012 over a 5%-alpha line, and on
   paper it is 0 outright — the mark is a texture you feel on a real screen, not
   one a screenshot can resolve. A comparison cell would assert a difference no
   capture can show. Apps may raise --crt-scanline-opacity via their own theme. */
