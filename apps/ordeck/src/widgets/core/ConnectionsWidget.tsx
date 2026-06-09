import { Widget } from '../Widget';

const CONNS = [
  { id: 'beigeboard', label: 'BEIGEBRD', domain: 'bb.jkos.net',    signal: 88, online: true  },
  { id: 'lazuros',    label: 'LAZUROS',  domain: 'ai.jkos.net',    signal:  0, online: false },
  { id: 'sylib',      label: 'SYLIB-OS', domain: 'lib.jkos.net',   signal: 72, online: true  },
  { id: 'jkauth',     label: 'JK-AUTH',  domain: 'auth.jkos.net',  signal: 95, online: true  },
] as const;

function SignalBar({ pct }: { pct: number }) {
  const segs = 8;
  const filled = Math.round((pct / 100) * segs);
  return (
    <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end', height: 14 }}>
      {Array.from({ length: segs }, (_, i) => (
        <span key={i} style={{
          width: 3,
          height: `${40 + i * 8}%`,
          background: i < filled
            ? pct > 60 ? 'var(--hub-green)' : pct > 30 ? 'var(--hub-amber)' : 'var(--hub-red)'
            : 'var(--hub-line-strong)',
          transition: 'background 0.3s',
        }} />
      ))}
    </div>
  );
}

export default function ConnectionsWidget() {
  const online = CONNS.filter(c => c.online).length;
  const rightLabel = (
    <span style={{ fontSize: 8, color: 'var(--hub-cream-faint)', letterSpacing: '0.15em' }}>
      {online}/{CONNS.length} ONLINE
    </span>
  );

  return (
    <Widget label="CONN · PATCH" led="green" right={rightLabel} flush>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1, padding: '4px 0' }}>
        {CONNS.map(c => (
          <div key={c.id} style={{
            display: 'grid',
            gridTemplateColumns: '10px 68px 1fr auto',
            alignItems: 'center', gap: 10,
            padding: '6px 10px',
            background: 'var(--hub-bg-0)',
            borderBottom: '1px solid var(--hub-line)',
          }}>
            <span className={`led ${c.online ? 'green' : 'red'}`} />
            <div style={{ overflow: 'hidden' }}>
              <div style={{
                fontSize: 10, fontWeight: 700, letterSpacing: '0.12em',
                color: c.online ? 'var(--hub-amber)' : 'var(--hub-cream-faint)',
              }} className={c.online ? 'glow-dim' : undefined}>
                {c.label}
              </div>
              <div style={{ fontSize: 8, color: 'var(--hub-cream-faint)', letterSpacing: '0.1em', marginTop: 1 }}>
                {c.domain}
              </div>
            </div>
            <span style={{
              fontSize: 8, color: 'var(--hub-cream-faint)', letterSpacing: '0.1em',
            }}>
              {c.online ? `${c.signal}%` : '—'}
            </span>
            <SignalBar pct={c.signal} />
          </div>
        ))}
      </div>
    </Widget>
  );
}
