import { useState, useEffect } from 'react';
import { DymoTape } from '../../components/hardware';
import { MiniLabel } from '../helpers';

const ZONES = [
  { id: 'sfo', label: 'SFO', name: 'San Francisco', tz: 'America/Los_Angeles' },
  { id: 'nyc', label: 'NYC', name: 'New York',       tz: 'America/New_York' },
  { id: 'lhr', label: 'LHR', name: 'London',         tz: 'Europe/London' },
  { id: 'sin', label: 'SIN', name: 'Singapore',      tz: 'Asia/Singapore' },
];

export default function WorldClocksWidget() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const iv = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(iv);
  }, []);

  return (
    <div style={{ height: '100%', overflow: 'auto' }}>
      <div style={{
        padding: '7px 12px', background: 'var(--hub-bg-2)',
        borderBottom: '1px solid var(--hub-line)',
        display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8,
      }}>
        <DymoTape style={{ fontSize: 8 }}>WORLD · TIME</DymoTape>
        <MiniLabel style={{ marginLeft: 'auto' }}>{ZONES.length} ZONES</MiniLabel>
      </div>
      <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {ZONES.map(z => {
          const t = new Date(now.toLocaleString('en-US', { timeZone: z.tz }));
          const hh = String(t.getHours()).padStart(2, '0');
          const mm = String(t.getMinutes()).padStart(2, '0');
          const ss = String(t.getSeconds()).padStart(2, '0');
          const isNight = t.getHours() < 6 || t.getHours() >= 20;
          return (
            <div key={z.id} style={{
              display: 'grid', gridTemplateColumns: '36px 1fr auto auto',
              alignItems: 'center', gap: 10, padding: '6px 10px',
              background: 'var(--hub-bg-0)', border: '1px solid var(--hub-line)',
            }}>
              <span style={{ fontFamily: 'var(--hub-font-seg)', fontWeight: 700, fontSize: 14, color: 'var(--hub-amber)' }} className="glow-dim">
                {z.label}
              </span>
              <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.1 }}>
                <span style={{ fontSize: 9.5, color: 'var(--hub-cream)' }}>{z.name}</span>
                <span style={{ fontSize: 8, color: 'var(--hub-cream-faint)', letterSpacing: '0.12em' }}>{z.tz}</span>
              </div>
              <span style={{ fontSize: 14, color: isNight ? 'var(--hub-cyan)' : 'var(--hub-amber)' }}>{isNight ? '◑' : '◐'}</span>
              <span style={{
                fontFamily: 'var(--hub-font-seg)', color: 'var(--hub-amber)',
                fontSize: 18, fontVariantNumeric: 'tabular-nums', fontWeight: 600,
              }} className="glow-dim">
                {hh}<span style={{ animation: 'blink 1s steps(2) infinite', color: 'var(--hub-amber-dim)' }}>:</span>{mm}
                <span style={{ color: 'var(--hub-amber-dim)', fontSize: 13 }}>:{ss}</span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
