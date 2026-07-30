import { RecLamp, Eyebrow, ChromeBar } from '@jkos/ui';
import { Faces } from './_faces';

/* The lit hardware lamp — a glowing accent dot, optionally labelled. It is the
   kit's "something is live" mark, and the glow is intrinsic (not mode-gated
   like the CRT veils), so it reads on paper as well as on the tube. */
const pad: React.CSSProperties = { padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 16 };

/** Labelled and bare. */
export const Default = () => (
  <Faces height={170}>
    <div style={pad}>
      <RecLamp label="LIVE" />
      <RecLamp label="RECORDING" />
      <RecLamp />
    </div>
  </Faces>
);

/** In a chrome bar — the call site, where it signals the view is tracking now. */
export const InAChromeBar = () => (
  <Faces height={170}>
    <div style={{ padding: '18px 20px', width: 420 }}>
      <ChromeBar
        title={<span style={{ fontFamily: 'var(--hub-font-serif)', fontSize: 16 }}>Today</span>}
        stats={<Eyebrow>16 schedules</Eyebrow>}
        nav={<RecLamp label="LIVE" />}
      />
    </div>
  </Faces>
);
