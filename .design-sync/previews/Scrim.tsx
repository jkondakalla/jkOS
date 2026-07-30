import { Scrim, Sheet, Lab, Rule, TButton } from '@jkos/ui';
import { Faces } from './_faces';

/* The scrim covers its positioning context — give it a relative host with the
   content it is meant to be covering, or it will fill the viewport. */
const host: React.CSSProperties = {
  position: 'relative',
  overflow: 'hidden',
  border: '1px solid var(--color-line)',
  borderRadius: 'var(--hub-radius-widget)',
  width: 400,
  height: 210,
  padding: '18px 20px',
  background: 'var(--color-paper-2)',
};

const pad: React.CSSProperties = { padding: '18px 20px' };

const Underneath = () => (
  <>
    <Lab size="xs">Week 31</Lab>
    <Rule />
    {['Draft the rollout dossier', 'Review the token parity gate', 'Cut the staging release'].map((t) => (
      <div key={t} style={{ fontFamily: 'var(--hub-font-serif)', fontSize: 14, padding: '6px 0' }}>
        {t}
      </div>
    ))}
  </>
);

/** The default backdrop — content stays readable underneath. */
export const Default = () => (
  <Faces height={250} stacked>
    <div style={pad}>
      <div style={host}>
        <Underneath />
        <Scrim />
      </div>
    </div>
  </Faces>
);

/** What it is actually for: holding a modal off the page behind it. */
export const BehindADialog = () => (
  <Faces height={250} stacked>
    <div style={pad}>
      <div style={host}>
        <Underneath />
        <Scrim />
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Sheet style={{ padding: '16px 18px', width: 260 }}>
            <Lab size="xs">Discard changes?</Lab>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
              <TButton quiet>Cancel</TButton>
              <TButton>Discard</TButton>
            </div>
          </Sheet>
        </div>
      </div>
    </div>
  </Faces>
);
