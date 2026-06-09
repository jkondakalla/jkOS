import { useEffect, useState } from 'react';
import { SegDisplay, DymoTape, Led } from '../../components/hardware';

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      background: 'var(--hub-bg-0)',
      border: '1px solid var(--hub-line)',
      padding: '5px 7px',
      display: 'flex', flexDirection: 'column', gap: 2,
    }}>
      <span style={{ fontSize: 8, letterSpacing: '0.2em', color: 'var(--hub-cream-faint)' }}>{label}</span>
      <span style={{ color: 'var(--hub-amber)', fontSize: 11 }} className="glow-dim">{value}</span>
    </div>
  );
}

export default function ClockWidget() {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const iv = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(iv);
  }, []);

  const pad = (n: number) => String(n).padStart(2, '0');
  const time   = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const utc    = `${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}`;
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: '2-digit' }).toUpperCase();
  const jday   = Math.floor((now.getTime() - new Date(now.getFullYear(), 0, 0).getTime()) / 86400000);
  const tz     = Intl.DateTimeFormat().resolvedOptions().timeZone;

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
      height: '100%', gap: 12, padding: 2,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <DymoTape style={{ fontSize: 8 }}>LOCAL · 24H</DymoTape>
        <Led color="green" size="sm" />
      </div>

      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <SegDisplay value={time} length={6} size={34} separator />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
        <Field label="DATE" value={dateStr} />
        <Field label="UTC"  value={utc} />
        <Field label="JDAY" value={String(jday).padStart(3, '0')} />
      </div>

      <div style={{ fontSize: 8, color: 'var(--hub-cream-faint)', letterSpacing: '0.16em', textAlign: 'center' }}>
        // {tz.toUpperCase()} //
      </div>
    </div>
  );
}
