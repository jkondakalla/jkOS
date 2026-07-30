import { ChromeBar, Eyebrow, RecLamp, TaskChip } from '@jkos/ui';
import { Faces } from './_faces';

/* The kit's view header: a title on the left, optional stats, optional trailing
   nav. Every calendar body mounts one so the four tabs share one masthead. */
const pad: React.CSSProperties = { padding: '18px 20px', width: 620 };

const Title = ({ children }: { children: React.ReactNode }) => (
  <span style={{ fontFamily: 'var(--hub-font-serif)', fontSize: 17, letterSpacing: '-0.01em', whiteSpace: 'nowrap' }}>{children}</span>
);

const navBtn: React.CSSProperties = {
  border: '1px solid var(--color-line)',
  background: 'transparent',
  borderRadius: 'var(--hub-radius-sm)',
  padding: '3px 9px',
  fontFamily: 'var(--hub-font-mono)',
  fontSize: 9,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: 'var(--color-muted)',
  cursor: 'pointer',
};

/** Title with a stats read-out — the common week/day header. */
export const WithStats = () => (
  <Faces height={180} stacked>
    <div style={pad}>
      <ChromeBar
        title={<Title>Jul 27 – Aug 2</Title>}
        stats={<Eyebrow>7 days · 16 schedules · 06 on the bench</Eyebrow>}
      />
    </div>
  </Faces>
);

/** The full bar: stats plus trailing week navigation. */
export const WithNav = () => (
  <Faces height={180} stacked>
    <div style={pad}>
      <ChromeBar
        title={<Title>Jul 27 – Aug 2</Title>}
        stats={<Eyebrow>16 schedules</Eyebrow>}
        nav={
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button type="button" style={navBtn}>
              ← W30
            </button>
            <button type="button" style={navBtn}>
              This week
            </button>
            <button type="button" style={navBtn}>
              W32 →
            </button>
          </div>
        }
      />
    </div>
  </Faces>
);
