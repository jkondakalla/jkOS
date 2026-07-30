import { Folio, Sheet, Rule } from '@jkos/ui';
import { Faces } from './_faces';

const pad: React.CSSProperties = { padding: '18px 24px' };

/** The folio mark — names CONTENT in print. `no` fills the accent-italic
 *  number slot. Chrome keeps `.label-tape`; content takes the folio. */
export const Default = () => (
  <Faces height={210}>
    <div style={{ ...pad, display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 380 }}>
      <Folio no="No. 4">The rollout dossier</Folio>
      <Folio no="3 / 12">Committed this week</Folio>
      <Folio>An unnumbered folio</Folio>
    </div>
  </Faces>
);

/** Heading a real content panel — the one call site the scarcity rule allows:
 *  one folio names THE content panel. */
export const HeadingAPanel = () => (
  <Faces height={210}>
    <div style={pad}>
      <Sheet style={{ padding: '20px 22px', maxWidth: 400 }}>
        <Folio no="No. 26">Full Press</Folio>
        <Rule weight="double" />
        <p style={{ fontFamily: 'var(--hub-font-serif)', fontSize: 15, lineHeight: 1.62, margin: '14px 0 0' }}>
          The wave that moved the sheet motif out of the shell and onto the body,
          so the grain runs under everything and the page keeps one measure.
        </p>
      </Sheet>
    </div>
  </Faces>
);
