import { useEffect, useState, type ReactNode } from 'react';

const JKOS_AUTH_URL =
  (import.meta.env.VITE_JKOS_AUTH_URL as string | undefined) ?? 'https://auth.jkos.net';

interface App {
  id: string;
  name: string;
  origin: string;
  icon_url: string | null;
  allowed_roles: string;
}

export default function AppsWidget() {
  const [apps, setApps] = useState<App[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    fetch(`${JKOS_AUTH_URL}/auth/apps`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then(data => { setApps(data.apps ?? []); setStatus('ready'); })
      .catch(() => setStatus('error'));
  }, []);

  if (status === 'loading') return <Empty>POLLING REGISTRY...</Empty>;
  if (status === 'error')   return <Empty warn>REGISTRY UNREACHABLE</Empty>;
  if (!apps.length)         return <Empty>NO APPS REGISTERED</Empty>;

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(148px, 1fr))',
      gap: 8,
      padding: 4,
      alignContent: 'start',
    }}>
      {apps.map(app => <AppTile key={app.id} app={app} />)}
    </div>
  );
}

function AppTile({ app }: { app: App }) {
  const [hovered, setHovered] = useState(false);
  const domain = app.origin.replace(/^https?:\/\//, '');

  return (
    <a
      href={app.origin}
      target="_blank"
      rel="noopener noreferrer"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display:        'flex',
        flexDirection:  'column',
        gap:            6,
        padding:        '12px 10px',
        background:     hovered ? 'var(--hub-bg-3)' : 'var(--hub-bg-2)',
        border:         `1px solid ${hovered ? 'var(--hub-amber)' : 'var(--hub-line)'}`,
        boxShadow:      hovered ? '0 0 8px var(--hub-amber-glow)' : 'none',
        textDecoration: 'none',
        cursor:         'pointer',
        transition:     'background 0.1s, border-color 0.1s, box-shadow 0.1s',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span className="led amber" style={{ flexShrink: 0 }} />
        <span style={{
          fontSize: 9, letterSpacing: '0.2em',
          color: 'var(--hub-cream-dim)', textTransform: 'uppercase',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {app.id}
        </span>
      </div>
      <div style={{
        fontSize:      13,
        fontWeight:    600,
        letterSpacing: '0.04em',
        color:         hovered ? 'var(--hub-amber)' : 'var(--hub-cream)',
        transition:    'color 0.1s',
      }}>
        {app.name}
      </div>
      <div style={{
        fontSize:  9,
        letterSpacing: '0.06em',
        color:     'var(--hub-cream-dim)',
        wordBreak: 'break-all',
      }}>
        {domain}
      </div>
    </a>
  );
}

function Empty({ children, warn }: { children: ReactNode; warn?: boolean }) {
  return (
    <div style={{
      height:         '100%',
      display:        'flex',
      alignItems:     'center',
      justifyContent: 'center',
      fontSize:       10,
      letterSpacing:  '0.1em',
      color:          warn ? 'var(--hub-red)' : 'var(--hub-cream-dim)',
    }}>
      {children}
    </div>
  );
}
