import { useState, useEffect, useCallback } from 'react';
import { Led } from '../hardware';

interface ApiToken {
  id: string;
  name: string;
  expiresAt: number;
  createdAt: number;
  lastUsedAt: number | null;
}

interface NewToken extends ApiToken {
  token: string;
}

function fmtDate(unix: number | null): string {
  if (!unix) return '—';
  return new Date(unix * 1000).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

function daysUntil(unix: number): number {
  return Math.max(0, Math.ceil((unix - Date.now() / 1000) / 86400));
}

const EXPIRY_OPTIONS = [
  { label: '30 days',  days: 30 },
  { label: '90 days',  days: 90 },
  { label: '180 days', days: 180 },
  { label: '1 year',   days: 365 },
];

export function TokensPanel() {
  const [tokens, setTokens]     = useState<ApiToken[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [newToken, setNewToken] = useState<NewToken | null>(null);
  const [copied, setCopied]     = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);

  // Create form state
  const [creating, setCreating] = useState(false);
  const [formName, setFormName] = useState('');
  const [formDays, setFormDays] = useState(90);
  const [formBusy, setFormBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await fetch('/api/auth/tokens', { credentials: 'include' });
      if (!r.ok) throw new Error();
      setTokens(await r.json());
    } catch {
      setError('Could not load API tokens');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function create() {
    if (!formName.trim()) return;
    setFormBusy(true); setError(null);
    try {
      const r = await fetch('/api/auth/tokens', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: formName.trim(), expiresInDays: formDays }),
      });
      if (!r.ok) throw new Error((await r.json()).error || 'Failed');
      const data: NewToken = await r.json();
      setNewToken(data);
      setTokens(prev => [data, ...prev]);
      setFormName(''); setCreating(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create token');
    } finally {
      setFormBusy(false);
    }
  }

  async function revoke(id: string) {
    setRevoking(id);
    try {
      await fetch(`/api/auth/tokens/${id}`, { method: 'DELETE', credentials: 'include' });
      setTokens(prev => prev.filter(t => t.id !== id));
      if (newToken?.id === id) setNewToken(null);
    } catch {
      setError('Failed to revoke token');
    } finally {
      setRevoking(null);
    }
  }

  async function copyToken(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {error && (
        <div style={{
          padding: '8px 10px', background: 'var(--hub-bg-0)',
          border: '1px solid var(--hub-red-dim)', color: 'var(--hub-red)',
          fontSize: 9, letterSpacing: '0.14em',
        }}>{error}</div>
      )}

      {/* Newly created token — show once */}
      {newToken && (
        <div style={{
          padding: '10px 12px',
          background: 'var(--hub-bg-0)',
          border: '1px solid var(--hub-amber-dim)',
          boxShadow: 'inset 0 0 10px var(--hub-amber-glow)',
          display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Led color="amber" size="sm" />
            <span style={{ fontSize: 9, letterSpacing: '0.16em', color: 'var(--hub-amber)', fontWeight: 700 }}>
              TOKEN CREATED — COPY NOW
            </span>
          </div>
          <div style={{ fontSize: 7.5, color: 'var(--hub-cream-faint)', letterSpacing: '0.1em' }}>
            This value will not be shown again.
          </div>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: 'var(--hub-bg-2)', border: '1px solid var(--hub-line)',
            padding: '6px 8px',
          }}>
            <code style={{
              flex: 1, fontSize: 8, color: 'var(--hub-amber)',
              fontFamily: 'var(--hub-font-mono)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {newToken.token}
            </code>
            <button
              onClick={() => copyToken(newToken.token)}
              style={{
                padding: '4px 10px',
                background: 'var(--hub-bg-3)',
                border: '1px solid var(--hub-amber-dim)',
                color: copied ? '#5cd66a' : 'var(--hub-amber)',
                fontFamily: 'var(--hub-font-mono)',
                fontSize: 8, letterSpacing: '0.14em',
                cursor: 'pointer', flexShrink: 0,
                transition: 'color 0.15s',
              }}
            >{copied ? '✓ COPIED' : 'COPY'}</button>
          </div>
          <div style={{ fontSize: 7.5, letterSpacing: '0.1em', color: 'var(--hub-cream-faint)' }}>
            USE AS: <code style={{ color: 'var(--hub-amber-dim)' }}>Authorization: Bearer &lt;token&gt;</code>
          </div>
          <button
            onClick={() => setNewToken(null)}
            style={{
              alignSelf: 'flex-end', padding: '3px 8px',
              background: 'transparent', border: '1px solid var(--hub-line)',
              color: 'var(--hub-cream-faint)', fontSize: 8, letterSpacing: '0.12em',
              cursor: 'pointer', fontFamily: 'var(--hub-font-mono)',
            }}
          >DISMISS</button>
        </div>
      )}

      {/* Create new token */}
      <Section title="NEW TOKEN" code="01">
        {!creating ? (
          <button
            onClick={() => setCreating(true)}
            style={{
              width: '100%', padding: '9px 12px',
              background: 'var(--hub-bg-0)',
              border: '1px solid var(--hub-amber-dim)',
              color: 'var(--hub-amber)',
              fontFamily: 'var(--hub-font-mono)',
              fontSize: 9, letterSpacing: '0.18em',
              cursor: 'pointer', transition: 'all 0.12s',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 0 6px var(--hub-amber-glow)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = ''; }}
          >+ GENERATE API TOKEN</button>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input
              autoFocus
              value={formName}
              onChange={e => setFormName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') create(); if (e.key === 'Escape') setCreating(false); }}
              placeholder="e.g. home-laptop, nas-scripts"
              style={{
                width: '100%', padding: '7px 10px',
                background: 'var(--hub-bg-0)',
                border: '1px solid var(--hub-line-strong)',
                color: 'var(--hub-cream)',
                fontFamily: 'var(--hub-font-mono)',
                fontSize: 10, letterSpacing: '0.08em',
                outline: 'none', boxSizing: 'border-box',
              }}
            />
            <div style={{ display: 'flex', gap: 4 }}>
              {EXPIRY_OPTIONS.map(o => (
                <button key={o.days} onClick={() => setFormDays(o.days)} style={{
                  flex: 1, padding: '5px 4px',
                  background: formDays === o.days ? 'var(--hub-bg-3)' : 'var(--hub-bg-0)',
                  border: `1px solid ${formDays === o.days ? 'var(--hub-amber-dim)' : 'var(--hub-line)'}`,
                  color: formDays === o.days ? 'var(--hub-amber)' : 'var(--hub-cream-faint)',
                  fontFamily: 'var(--hub-font-mono)',
                  fontSize: 7.5, letterSpacing: '0.1em',
                  cursor: 'pointer',
                }}>{o.label}</button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={create} disabled={!formName.trim() || formBusy} style={{
                flex: 1, padding: '7px 12px',
                background: 'var(--hub-bg-0)',
                border: '1px solid var(--hub-amber-dim)',
                color: 'var(--hub-amber)',
                fontFamily: 'var(--hub-font-mono)',
                fontSize: 9, letterSpacing: '0.14em',
                cursor: formName.trim() && !formBusy ? 'pointer' : 'not-allowed',
                opacity: formName.trim() && !formBusy ? 1 : 0.5,
              }}>{formBusy ? 'GENERATING…' : 'GENERATE'}</button>
              <button onClick={() => { setCreating(false); setFormName(''); }} style={{
                padding: '7px 12px',
                background: 'transparent', border: '1px solid var(--hub-line)',
                color: 'var(--hub-cream-faint)',
                fontFamily: 'var(--hub-font-mono)',
                fontSize: 9, letterSpacing: '0.14em',
                cursor: 'pointer',
              }}>CANCEL</button>
            </div>
          </div>
        )}
      </Section>

      {/* Token list */}
      <Section title="ACTIVE TOKENS" code="02">
        {loading ? (
          <EmptyRow>LOADING…</EmptyRow>
        ) : tokens.length === 0 ? (
          <EmptyRow>No API tokens — create one above to access the compute API from scripts</EmptyRow>
        ) : (
          tokens.map(t => {
            const days = daysUntil(t.expiresAt);
            const expiringSoon = days < 14;
            return (
              <div key={t.id} style={{
                background: 'var(--hub-bg-0)',
                border: `1px solid ${expiringSoon ? 'var(--hub-red-dim)' : 'var(--hub-line)'}`,
                padding: '8px 10px',
                display: 'flex', alignItems: 'center', gap: 10,
              }}>
                <Led color={expiringSoon ? 'red' : 'green'} size="sm" style={{ flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 10, letterSpacing: '0.1em',
                    color: 'var(--hub-cream)',
                    fontFamily: 'var(--hub-font-mono)',
                    marginBottom: 3,
                  }}>{t.name}</div>
                  <div style={{
                    fontSize: 7.5, color: 'var(--hub-cream-faint)',
                    letterSpacing: '0.1em', lineHeight: 1.5,
                  }}>
                    {expiringSoon
                      ? <span style={{ color: 'var(--hub-red)' }}>EXPIRES IN {days}d</span>
                      : <span>EXPIRES {fmtDate(t.expiresAt)}</span>
                    }
                    {t.lastUsedAt && <span style={{ marginLeft: 8 }}>· LAST USED {fmtDate(t.lastUsedAt)}</span>}
                    {!t.lastUsedAt && <span style={{ marginLeft: 8, color: '#6b7280' }}>· NEVER USED</span>}
                  </div>
                </div>
                <button
                  onClick={() => revoke(t.id)}
                  disabled={!!revoking}
                  style={{
                    padding: '5px 9px',
                    background: 'var(--hub-bg-2)',
                    border: '1px solid var(--hub-red-dim)',
                    color: 'var(--hub-red)',
                    fontFamily: 'var(--hub-font-mono)',
                    fontSize: 8, letterSpacing: '0.14em',
                    cursor: revoking ? 'wait' : 'pointer',
                    opacity: revoking ? 0.5 : 1, flexShrink: 0,
                  }}
                >{revoking === t.id ? '…' : 'REVOKE'}</button>
              </div>
            );
          })
        )}
      </Section>

      {/* Usage hint */}
      <div style={{
        padding: 10, border: '1px dashed var(--hub-line)',
        fontSize: 8, color: 'var(--hub-cream-faint)', letterSpacing: '0.12em',
        lineHeight: 1.6,
      }}>
        <Led color="green" size="sm" style={{ display: 'inline-block', marginRight: 8 }} />
        CLI USAGE · curl -H "Authorization: Bearer &lt;token&gt;" https://YOUR_DOMAIN/api/lazuros/api/chat
      </div>
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
          background: 'var(--hub-bg-3)', padding: '2px 6px',
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
      padding: '10px 12px', background: 'var(--hub-bg-0)',
      border: '1px dashed var(--hub-line)',
      color: 'var(--hub-cream-faint)', fontSize: 8, letterSpacing: '0.14em',
    }}>{children}</div>
  );
}
