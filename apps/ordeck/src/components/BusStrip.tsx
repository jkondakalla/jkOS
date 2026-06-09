import { DymoTape, Led, Sparkline, useWaveform } from './hardware';

export interface BusChannel {
  label: string;
  value: string | number;
  color: 'amber' | 'cyan' | 'red' | 'green';
}

interface BusStripProps {
  buses?: BusChannel[];
}

const DEFAULT_BUSES: BusChannel[] = [
  { label: 'TX', value: '0 B/s',   color: 'amber' },
  { label: 'RX', value: '0 B/s',   color: 'green' },
  { label: 'ERR', value: '0',      color: 'red'   },
  { label: 'LAT', value: '0 ms',   color: 'cyan'  },
];

export default function BusStrip({ buses = DEFAULT_BUSES }: BusStripProps) {
  const data = useWaveform(140, 90);

  return (
    <div style={{
      position: 'fixed',
      top: 'var(--hub-header-h)',
      left: 0, right: 0,
      height: 'var(--hub-bus-h)',
      background: 'var(--hub-bg-1)',
      borderBottom: '1px solid var(--hub-line)',
      display: 'flex', alignItems: 'center',
      padding: '0 12px',
      gap: 16,
      zIndex: 90,
      overflow: 'hidden',
    }}>
      <DymoTape style={{ fontSize: 8, flexShrink: 0 }}>SYS-BUS</DymoTape>

      {/* waveform */}
      <div style={{
        flex: 1, height: 22,
        background: 'var(--hub-bg-0)',
        border: '1px solid var(--hub-line)',
        position: 'relative',
        overflow: 'hidden',
        boxShadow: 'inset 0 0 6px rgba(0,0,0,0.6)',
      }}>
        <Sparkline points={data} width={1200} height={22} color="var(--hub-amber)" area />
        <div style={{
          position: 'absolute', top: 0, bottom: 0, right: 0,
          width: 1,
          background: 'var(--hub-amber)',
          boxShadow: '0 0 6px var(--hub-amber)',
          animation: 'data-flicker 4s infinite',
        }} />
      </div>

      {/* bus channels */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexShrink: 0 }}>
        {buses.map(b => (
          <div key={b.label} style={{
            display: 'flex', alignItems: 'center', gap: 5,
            fontSize: 9, letterSpacing: '0.1em',
          }}>
            <Led color={b.color} size="sm" />
            <span style={{ color: 'var(--hub-cream-dim)' }}>{b.label}</span>
            <span style={{ color: 'var(--hub-cream)', fontVariantNumeric: 'tabular-nums' }}>{b.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
