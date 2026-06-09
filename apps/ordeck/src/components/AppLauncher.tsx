import { useState, useEffect } from 'react';

const AUTH_URL =
  (import.meta.env.VITE_JKOS_AUTH_URL as string | undefined) ?? 'https://auth.jkos.net';

interface App {
  id:            string;
  name:          string;
  origin:        string;
  icon_url:      string | null;
  allowed_roles: string;
}

interface Props {
  user?: { role?: string } | null;
}

// Per-app identity overrides for known IDs
const APP_META: Record<string, { color: string; colorPale: string; signal: number }> = {
  ordeck:      { color: '#ffb000', colorPale: '#ffb00022', signal: 95 },
  beigeboard:  { color: '#c05c15', colorPale: '#c05c1522', signal: 88 },
  sylibos:     { color: '#2468a0', colorPale: '#2468a022', signal: 72 },
  sylib:       { color: '#2468a0', colorPale: '#2468a022', signal: 72 },
  lazuros:     { color: '#4ecdc4', colorPale: '#4ecdc422', signal:  0 },
  jkauth:      { color: '#aaa',    colorPale: '#aaa2',     signal: 95 },
};

const DEFAULT_META = { color: '#ffb000', colorPale: '#ffb00022', signal: 80 };

function mono(name: string) { return name.slice(0, 2).toUpperCase(); }
function domain(origin: string) {
  try { return new URL(origin).hostname.replace(/^www\./, ''); } catch { return origin; }
}

function isOffline(id: string, signal: number) {
  return id === 'lazuros' || signal === 0;
}

function SignalPips({ pct }: { pct: number }) {
  const pips = 5;
  const filled = Math.round((pct / 100) * pips);
  return (
    <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
      {Array.from({ length: pips }, (_, i) => (
        <span key={i} style={{
          width: 4, height: 4, borderRadius: 1,
          background: i < filled ? 'var(--hub-amber)' : 'var(--hub-line-strong)',
          boxShadow: i < filled ? '0 0 3px var(--hub-amber-glow)' : 'none',
          transition: 'all 0.3s',
        }} />
      ))}
    </div>
  );
}

function DirRow({ app }: { app: App }) {
  const [hov, setHov] = useState(false);
  const meta = APP_META[app.id] ?? DEFAULT_META;
  const offline = isOffline(app.id, meta.signal);
  const led = offline ? 'red' : 'green';

  return (
    <a
      href={app.origin}
      target="_blank"
      rel="noopener noreferrer"
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: 'grid',
        gridTemplateColumns: '32px 80px 1fr auto 48px',
        alignItems: 'center', gap: 10,
        padding: '6px 12px',
        background: hov ? meta.colorPale : 'transparent',
        borderBottom: '1px solid var(--hub-line)',
        textDecoration: 'none',
        transition: 'background 0.12s',
      }}
    >
      <span className={`led ${led}`} />

      <div style={{
        fontFamily: 'var(--hub-font-seg, var(--hub-font-mono))',
        fontSize: 15, fontWeight: 700, letterSpacing: '0.12em',
        color: hov ? meta.color : 'var(--hub-amber-dim)',
        textShadow: hov ? `0 0 8px ${meta.color}88` : 'none',
        transition: 'color 0.12s, text-shadow 0.12s',
      }}>
        {mono(app.name)}
      </div>

      <div style={{ minWidth: 0 }}>
        <div style={{
          fontSize: 10, fontWeight: 600, letterSpacing: '0.08em',
          color: hov ? 'var(--hub-cream-bright)' : 'var(--hub-cream)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          transition: 'color 0.12s',
        }}>
          {app.name}
        </div>
        <div style={{ fontSize: 8, color: 'var(--hub-cream-faint)', letterSpacing: '0.1em', marginTop: 1 }}>
          {domain(app.origin)}
        </div>
      </div>

      <div style={{ fontSize: 8, color: offline ? 'var(--hub-red)' : 'var(--hub-green)', letterSpacing: '0.12em' }}>
        {offline ? 'OFFL' : 'LIVE'}
      </div>

      <SignalPips pct={meta.signal} />
    </a>
  );
}

export function AppLauncher({ user }: Props) {
  const [apps, setApps] = useState<App[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem('ordeck-launcher-open') !== '0'; } catch { return true; }
  });

  useEffect(() => {
    fetch(`${AUTH_URL}/auth/apps`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(data => {
        const filtered = (data.apps as App[]).filter(a =>
          a.allowed_roles === 'all' || !user?.role || a.allowed_roles === user.role
        );
        setApps(filtered);
        setStatus('ready');
      })
      .catch(() => setStatus('error'));
  }, [user?.role]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    try { localStorage.setItem('ordeck-launcher-open', next ? '1' : '0'); } catch { /* */ }
  };

  return (
    <div style={{
      flexShrink: 0,
      borderBottom: open ? '1px solid var(--hub-line)' : 'none',
      background: 'var(--hub-bg-1)',
    }}>
      {/* Rail header */}
      <div style={{
        height: 'var(--hub-bus-h, 28px)',
        display: 'flex', alignItems: 'center', gap: 10, padding: '0 12px',
        borderBottom: '1px solid var(--hub-line)',
      }}>
        <span className="led amber" />
        <span style={{ fontSize: 8, letterSpacing: '0.22em', color: 'var(--hub-cream-faint)', textTransform: 'uppercase' }}>
          APPS · DIRECTORY
        </span>
        <span style={{ flex: 1 }} />
        {status === 'ready' && (
          <span style={{ fontSize: 8, color: 'var(--hub-cream-faint)', letterSpacing: '0.12em' }}>
            {apps.length} REGISTERED
          </span>
        )}
        <button onClick={toggle} style={{
          background: 'none', border: 'none', cursor: 'pointer',
          color: 'var(--hub-cream-faint)', fontSize: 10, padding: '0 4px', lineHeight: 1,
          transition: 'color 0.12s',
        }}
          onMouseEnter={e => ((e.target as HTMLElement).style.color = 'var(--hub-amber)')}
          onMouseLeave={e => ((e.target as HTMLElement).style.color = 'var(--hub-cream-faint)')}
        >
          {open ? '▲' : '▼'}
        </button>
      </div>

      {/* Directory rows */}
      {open && (
        <div style={{ maxHeight: 180, overflowY: 'auto' }}>
          {status === 'loading' && (
            <div style={{ padding: '10px 12px', fontSize: 9, color: 'var(--hub-cream-faint)', letterSpacing: '0.18em' }}>
              POLLING REGISTRY…
            </div>
          )}
          {status === 'error' && (
            <div style={{ padding: '10px 12px', fontSize: 9, color: 'var(--hub-red)', letterSpacing: '0.12em' }}>
              REGISTRY UNREACHABLE
            </div>
          )}
          {status === 'ready' && apps.length === 0 && (
            <div style={{ padding: '10px 12px', fontSize: 9, color: 'var(--hub-cream-faint)', letterSpacing: '0.12em' }}>
              NO APPS REGISTERED
            </div>
          )}
          {status === 'ready' && apps.map(app => <DirRow key={app.id} app={app} />)}
        </div>
      )}
    </div>
  );
}
