import { useState, useEffect, useCallback } from 'react';
import { Led } from '../hardware';

interface Session {
  id: string;
  createdAt: number;
  lastUsedAt: number | null;
  userAgent: string | null;
  ipAddress: string | null;
  isCurrent: boolean;
}

function fmtDate(unix: number | null): string {
  if (!unix) return '—';
  return new Date(unix * 1000).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function shortUA(ua: string | null): string {
  if (!ua) return 'Unknown device';
  if (/iPhone|iPad/i.test(ua))  return 'iOS · Safari';
  if (/Android/i.test(ua))      return 'Android · ' + (/Chrome/i.test(ua) ? 'Chrome' : 'Browser');
  if (/Firefox/i.test(ua))      return 'Firefox';
  if (/Edg/i.test(ua))          return 'Edge';
  if (/Chrome/i.test(ua))       return 'Chrome';
  if (/Safari/i.test(ua))       return 'Safari';
  return ua.slice(0, 32);
}

export function SessionsPanel() {
  const [sessions, setSessions]   = useState<Session[]>([]);
  const [loading, setLoading]     = useState(true);
  const [revoking, setRevoking]   = useState<string | null>(null);
  const [error, setError]         = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch('/api/auth/sessions', { credentials: 'include' });
      if (!r.ok) throw new Error('Failed to load sessions');
      setSessions(await r.json());
    } catch {
      setError('Could not load sessions');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function revoke(id: string) {
    setRevoking(id);
    try {
      await fetch(`/api/auth/sessions/${id}`, { method: 'DELETE', credentials: 'include' });
      setSessions(prev => prev.filter(s => s.id !== id));
    } catch {
      setError('Failed to revoke session');
    } finally {
      setRevoking(null);
    }
  }

  async function revokeAll() {
    if (!window.confirm('Revoke all other sessions? Those devices will need to sign in again.')) return;
    setRevoking('all');
    try {
      await fetch('/api/auth/sessions', { method: 'DELETE', credentials: 'include' });
      await load();
    } catch {
      setError('Failed to revoke sessions');
    } finally {
      setRevoking(null);
    }
  }

  const others = sessions.filter(s => !s.isCurrent);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {error && (
        <div style={{
          padding: '8px 10px',
          background: 'var(--hub-bg-0)',
          border: '1px solid var(--hub-red-dim)',
          color: 'var(--hub-red)',
          fontSize: 9,
          letterSpacing: '0.14em',
        }}>{error}</div>
      )}

      {loading ? (
        <div style={{
          padding: 20, textAlign: 'center',
          color: 'var(--hub-cream-faint)', fontSize: 9, letterSpacing: '0.18em',
        }}>
          <Led color="amber" size="sm" style={{ display: 'inline-block', marginBottom: 8 }} />
          <div>LOADING SESSIONS…</div>
        </div>
      ) : (
        <>
          {/* Current session */}
          <Section title="CURRENT SESSION" code="01">
            {sessions.filter(s => s.isCurrent).map(s => (
              <SessionRow key={s.id} session={s} revoking={revoking} onRevoke={revoke} />
            ))}
            {!sessions.some(s => s.isCurrent) && (
              <EmptyRow>No active session token detected</EmptyRow>
            )}
          </Section>

          {/* Other sessions */}
          <Section title="OTHER SESSIONS" code="02">
            {others.length === 0 ? (
              <EmptyRow>No other active sessions</EmptyRow>
            ) : (
              others.map(s => (
                <SessionRow key={s.id} session={s} revoking={revoking} onRevoke={revoke} />
              ))
            )}
          </Section>

          {/* Revoke all other */}
          {others.length > 0 && (
            <button
              onClick={revokeAll}
              disabled={revoking === 'all'}
              onMouseEnter={e => {
                const el = e.currentTarget as HTMLElement;
                el.style.boxShadow = '0 0 8px var(--hub-red-glow)';
                el.style.borderColor = 'var(--hub-red)';
              }}
              onMouseLeave={e => {
                const el = e.currentTarget as HTMLElement;
                el.style.boxShadow = '';
                el.style.borderColor = 'var(--hub-red-dim)';
              }}
              style={{
                width: '100%',
                padding: '10px 12px',
                background: 'var(--hub-bg-0)',
                border: '1px solid var(--hub-red-dim)',
                color: 'var(--hub-red)',
                fontFamily: 'var(--hub-font-mono)',
                fontSize: 9,
                letterSpacing: '0.18em',
                fontWeight: 600,
                cursor: revoking === 'all' ? 'wait' : 'pointer',
                transition: 'all 0.12s',
                opacity: revoking === 'all' ? 0.5 : 1,
              }}
            >
              {revoking === 'all' ? '⌛ REVOKING…' : `⌫ REVOKE ALL OTHER SESSIONS (${others.length})`}
            </button>
          )}

          <div style={{
            padding: 10,
            border: '1px dashed var(--hub-line)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            fontSize: 8,
            color: 'var(--hub-cream-faint)',
            letterSpacing: '0.15em',
          }}>
            <Led color="green" size="sm" />
            SESSIONS EXPIRE AFTER 7 DAYS · ROTATING TOKENS
          </div>
        </>
      )}
    </div>
  );
}

function Section({ title, code, children }: { title: string; code: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{
          fontSize: 8, letterSpacing: '0.18em', fontWeight: 700,
          color: 'var(--hub-cream-dim)',
          background: 'var(--hub-bg-3)',
          padding: '2px 6px',
          border: '1px solid var(--hub-line)',
          fontFamily: 'var(--hub-font-mono)',
        }}>{title}</span>
        <span style={{ flex: 1, height: 1, background: 'var(--hub-line)' }} />
        <span style={{ fontSize: 8, color: 'var(--hub-cream-faint)', letterSpacing: '0.18em' }}>§{code}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {children}
      </div>
    </div>
  );
}

function EmptyRow({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      padding: '10px 12px',
      background: 'var(--hub-bg-0)',
      border: '1px dashed var(--hub-line)',
      color: 'var(--hub-cream-faint)',
      fontSize: 8,
      letterSpacing: '0.14em',
    }}>{children}</div>
  );
}

function SessionRow({ session: s, revoking, onRevoke }: {
  session: Session;
  revoking: string | null;
  onRevoke: (id: string) => void;
}) {
  return (
    <div style={{
      background: 'var(--hub-bg-0)',
      border: `1px solid ${s.isCurrent ? 'var(--hub-amber-dim)' : 'var(--hub-line)'}`,
      padding: '8px 10px',
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      boxShadow: s.isCurrent ? 'inset 0 0 6px var(--hub-amber-glow)' : 'none',
    }}>
      <Led color={s.isCurrent ? 'amber' : undefined} size="sm" style={{ flexShrink: 0, opacity: s.isCurrent ? 1 : 0.35 }} />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 9, color: s.isCurrent ? 'var(--hub-amber)' : 'var(--hub-cream)',
          letterSpacing: '0.12em', fontFamily: 'var(--hub-font-mono)',
          marginBottom: 3,
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          {shortUA(s.userAgent)}
          {s.isCurrent && (
            <span style={{
              fontSize: 7, padding: '1px 5px',
              background: 'var(--hub-amber-glow)',
              border: '1px solid var(--hub-amber-dim)',
              color: 'var(--hub-amber)',
              letterSpacing: '0.12em',
            }}>THIS DEVICE</span>
          )}
        </div>
        <div style={{
          fontSize: 7.5, color: 'var(--hub-cream-faint)',
          letterSpacing: '0.1em', lineHeight: 1.5,
        }}>
          {s.ipAddress && <span style={{ marginRight: 8 }}>{s.ipAddress}</span>}
          <span>ACTIVE {fmtDate(s.lastUsedAt ?? s.createdAt)}</span>
        </div>
      </div>

      {!s.isCurrent && (
        <button
          onClick={() => onRevoke(s.id)}
          disabled={!!revoking}
          style={{
            padding: '5px 9px',
            background: 'var(--hub-bg-2)',
            border: '1px solid var(--hub-red-dim)',
            color: 'var(--hub-red)',
            fontFamily: 'var(--hub-font-mono)',
            fontSize: 8,
            letterSpacing: '0.14em',
            cursor: revoking ? 'wait' : 'pointer',
            opacity: revoking ? 0.5 : 1,
            flexShrink: 0,
          }}
        >
          {revoking === s.id ? '…' : 'REVOKE'}
        </button>
      )}
    </div>
  );
}
