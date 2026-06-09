import '@jkos/ui/tokens.css';
import { useState } from 'react';

const COLOR = '#5cd66a';

export default function RecipeWidget() {
  const [prompt, setPrompt]   = useState('');
  const [loading, setLoading] = useState(false);
  const [recipe, setRecipe]   = useState('');
  const [error, setError]     = useState('');

  async function generate() {
    if (!prompt.trim() || loading) return;
    setLoading(true);
    setError('');
    setRecipe('');
    try {
      const r = await fetch('/api/recipes/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ prompt: prompt.trim() }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      setRecipe(data.recipe ?? '');
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
        <span style={{ color: COLOR, fontSize: 11, letterSpacing: '0.2em', fontWeight: 700 }}>◉ RECIPE</span>
        <span style={{ fontSize: 9, color: `${COLOR}88`, letterSpacing: '0.14em' }}>AI CHEF</span>
        <span style={{ marginLeft: 'auto', fontSize: 9, color: 'var(--hub-cream-faint)', letterSpacing: '0.1em' }}>RMT-004</span>
      </div>

      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
        <input
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && generate()}
          placeholder="ingredients, meal type, or dietary need…"
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
          onClick={generate}
          disabled={loading || !prompt.trim()}
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
          {loading ? '●●●' : 'GENERATE'}
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

      {recipe ? (
        <div style={{
          flex: 1, overflowY: 'auto',
          background: 'var(--hub-bg-0)',
          border: '1px solid var(--hub-line)',
          padding: '10px 12px',
          color: 'var(--hub-cream)',
          fontSize: 11, lineHeight: 1.8,
          whiteSpace: 'pre-wrap',
        }}>
          {recipe}
        </div>
      ) : (
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 10,
          border: '1px dashed var(--hub-line)',
          background: 'var(--hub-bg-0)',
        }}>
          <div style={{ fontSize: 22, color: `${COLOR}55`, filter: `drop-shadow(0 0 6px ${COLOR}44)` }}>◉</div>
          <div style={{ fontSize: 9, color: 'var(--hub-cream-faint)', letterSpacing: '0.2em' }}>
            {loading ? 'QUERYING LAZUROS…' : 'AWAITING INGREDIENTS'}
          </div>
        </div>
      )}
    </div>
  );
}
