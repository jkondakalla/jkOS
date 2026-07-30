import { Pill, Lab, Sub } from '@jkos/ui';
import { Faces } from './_faces';

const pad: React.CSSProperties = { padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 14 };

/** The status pill — a fixed OK/green signal, not an accent-tinted badge.
 *  Use it where something is confirmed healthy. */
export const Default = () => (
  <Faces height={230}>
    <div style={pad}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <Pill>Healthy</Pill>
        <Pill>Live</Pill>
        <Pill>Synced</Pill>
      </div>
    </div>
  </Faces>
);

/** In a service list — the call site the pill was cut for. */
export const ServiceList = () => (
  <Faces height={230}>
    <div style={pad}>
      <Lab size="xs">Containers</Lab>
      {[
        ['jkauth', 'Healthy'],
        ['beigeboard', 'Healthy'],
        ['ordeck', 'Healthy'],
        ['nginx', 'Healthy'],
      ].map(([name, status]) => (
        <div
          key={name}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 20,
            minWidth: 280,
          }}
        >
          <span style={{ fontFamily: 'var(--hub-font-mono)', fontSize: 12 }}>{name}</span>
          <Pill>{status}</Pill>
        </div>
      ))}
      <Sub>7 of 7 up · checked 14:20</Sub>
    </div>
  </Faces>
);
