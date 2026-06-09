import '@jkos/ui/tokens.css';
import { useState } from 'react';

const COLOR = '#e5a00d';

export default function PlexWidget() {
  const [mood, setMood]       = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult]   = useState('');
  const [error, setError]     = useState('');

  async function suggest() {
    if (!mood.trim() || loading) return;
    setLoading(true);
    setError('');
    setResult('');
    try {
      const r = await fetch('/api/plex/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ mood: mood.trim() }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      setResult(data.suggestions ?? '');
    } catch (e: any) {
      setError(e.message ?? 'Request failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      height: '100%', display: 'flex', flexDirection: 'column',
      background: 'var(--hub-bg-1)',
      fontFamily: 'var(--hub-font-mono)',
      padding: 'var(--hub-widget-pad)',
      gap: 10, boxSizing: 'border-box',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        borderBottom: '1px solid var(--hub-line)',
        paddingBottom: 8, flexShrink: 0,
      }}>
        <span style={{ color: COLOR, fontSize: 11, letterSpacing: '0.2em', fontWeight: 700 }}>▶ PLEX</span>
        <span style={{ fontSize: 9, color: `${COLOR}88`, letterSpacing: '0.14em' }}>MEDIA ADVISOR</span>
        <span style={{ marginLeft: 'auto', fontSize: 9, color: 'var(--hub-cream-faint)', letterSpacing: '0.1em' }}>RMT-001</span>
      </div>

      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
        <input
          value={mood}
          onChange={e => setMood(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && suggest()}
          placeholder="mood, genre, or feeling…"
          style={{
            flex: 1,
            background: 'var(--hub-bg-0)',
            border: '1px solid var(--hub-line)',
            color: 'var(--hub-cream)',
            fontFamily: 'var(--hub-font-mono)',
            fontSize: 11, padding: '7px 9px', outline: 'none',
          }}
        />
        <button
          onClick={suggest}
          disabled={loading || !mood.trim()}
          style={{
            background: loading ? 'transparent' : `${COLOR}18`,
            border: `1px solid ${COLOR}55`,
            color: loading ? 'var(--hub-cream-faint)' : COLOR,
            fontFamily: 'var(--hub-font-mono)',
            fontSize: 10, letterSpacing: '0.14em',
            padding: '7px 12px', cursor: loading ? 'wait' : 'pointer',
            flexShrink: 0,
          }}
        >
          {loading ? '●●●' : 'SUGGEST'}
        </button>
      </div>

      {error && (
        <div style={{
          color: 'var(--hub-red)', fontSize: 10, letterSpacing: '0.08em',
          padding: '6px 8px', border: '1px solid var(--hub-red-dim)',
          background: 'var(--hub-red-dim)22', flexShrink: 0,
        }}>
          ERR · {error}
        </div>
      )}

      {result ? (
        <div style={{
          flex: 1, overflowY: 'auto',
          background: 'var(--hub-bg-0)',
          border: '1px solid var(--hub-line)',
          padding: '10px 12px',
          color: 'var(--hub-cream)',
          fontSize: 11, lineHeight: 1.8,
          whiteSpace: 'pre-wrap',
        }}>
          {result}
        </div>
      ) : (
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 10,
          border: '1px dashed var(--hub-line)',
          background: 'var(--hub-bg-0)',
        }}>
          <div style={{ fontSize: 22, color: `${COLOR}55`, filter: `drop-shadow(0 0 6px ${COLOR}44)` }}>▶</div>
          <div style={{ fontSize: 9, color: 'var(--hub-cream-faint)', letterSpacing: '0.2em' }}>
            {loading ? 'QUERYING LAZUROS…' : 'AWAITING MOOD INPUT'}
          </div>
        </div>
      )}
    </div>
  );
}
