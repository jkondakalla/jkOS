import { Sheet, Lab, Rule, Sub, Press, Colophon } from '@jkos/ui';
import { Faces } from './_faces';

const pad: React.CSSProperties = { padding: '18px 20px' };

/** The card surface — the suite's one bordered panel. */
export const Default = () => (
  <Faces height={300}>
    <div style={pad}>
      <Sheet style={{ padding: '18px 20px', maxWidth: 380 }}>
        <Lab size="sm">Deploy</Lab>
        <Rule />
        <p style={{ fontFamily: 'var(--hub-font-serif)', fontSize: 15, lineHeight: 1.6, margin: '12px 0 0' }}>
          Staging is twelve minutes ahead of production. Promoting will rebuild
          seven containers.
        </p>
      </Sheet>
    </div>
  </Faces>
);

/** Sheets tile as a rail of cards. */
export const AsCards = () => (
  <Faces height={300}>
    <div style={{ ...pad, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
      {[
        ['jkAuth', 'Identity + preferences'],
        ['BeigeBoard', 'Plan and schedule'],
        ['ORDECK', 'The widget dashboard'],
      ].map(([name, note]) => (
        <Sheet key={name} style={{ padding: '14px 16px', width: 190 }}>
          <Lab size="xs">{name}</Lab>
          <p style={{ fontFamily: 'var(--hub-font-serif)', fontSize: 13, lineHeight: 1.5, margin: '8px 0 0' }}>
            {note}
          </p>
        </Sheet>
      ))}
    </div>
  </Faces>
);
