import { SubLink, Sub, Lab } from '@jkos/ui';
import { Faces } from './_faces';

/* alignItems: flex-start matters — a stretched column would blow each link's
   underline out to the full width, which is not how the mark reads inline. */
const pad: React.CSSProperties = {
  padding: '18px 20px',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: 12,
};

/** The underlined secondary link — defaults to an `<a>`. */
export const Default = () => (
  <Faces height={190}>
    <div style={pad}>
      <SubLink href="#week">Open the week</SubLink>
      <SubLink href="#workshop">Back to the workshop</SubLink>
      <SubLink href="#settings">Manage account ↗</SubLink>
    </div>
  </Faces>
);

/** A footer nav row. `as="button"` is available when the link drives a handler
 *  rather than an href — but reset the native button chrome yourself, and reset
 *  only the TOP/LEFT/RIGHT borders: `.jk-sub-link` draws its underline with
 *  `border-bottom`, so a blanket `border: none` silently erases the mark. */
export const NavRow = () => {
  const asButton: React.CSSProperties = {
    borderTop: 'none',
    borderLeft: 'none',
    borderRight: 'none',
    background: 'none',
    padding: '0 0 1px',
    font: 'inherit',
    cursor: 'pointer',
  };
  return (
    <Faces height={190}>
      <div style={pad}>
        <Lab size="xs">Elsewhere</Lab>
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'baseline' }}>
          {['Week', 'Calendar', 'Workshop'].map((t) => (
            <SubLink as="button" key={t} type="button" style={asButton}>
              {t}
            </SubLink>
          ))}
          <Sub>·</Sub>
          <SubLink href="#help">Help</SubLink>
        </div>
      </div>
    </Faces>
  );
};
