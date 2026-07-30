import { Colophon, Sheet, Rule, Lab } from '@jkos/ui';
import { Faces } from './_faces';

const pad: React.CSSProperties = { padding: '18px 24px' };

/** The end-of-sheet record: centre-set serif over the accent fleuron (which
 *  halates on the tube). One per sheet, at the foot. */
export const Default = () => (
  <Faces height={220}>
    <div style={{ ...pad, maxWidth: 400 }}>
      <Colophon>Set in Fraunces and IBM Plex · jkOS</Colophon>
    </div>
  </Faces>
);

/** Closing a sheet — where it belongs, under the double rule. */
export const ClosingASheet = () => (
  <Faces height={220}>
    <div style={pad}>
      <Sheet style={{ padding: '20px 22px', maxWidth: 400 }}>
        <Lab size="sm">Week 31</Lab>
        <Rule weight="strong" />
        <p style={{ fontFamily: 'var(--hub-font-serif)', fontSize: 15, lineHeight: 1.6, margin: '12px 0 16px' }}>
          Sixteen schedules across seven days. Six of them are still on the bench,
          which is where they should be until Monday.
        </p>
        <Rule weight="double" />
        <Colophon>Jul 27 – Aug 2 · printed from staging</Colophon>
      </Sheet>
    </div>
  </Faces>
);
