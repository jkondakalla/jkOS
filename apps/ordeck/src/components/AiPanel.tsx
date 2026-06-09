import { useState, useRef, useEffect, useCallback } from 'react';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface AiPanelProps {
  open: boolean;
  onClose: () => void;
}

export default function AiPanel({ open, onClose }: AiPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput]       = useState('');
  const [streaming, setStreaming] = useState(false);
  const [models, setModels]     = useState<string[]>([]);
  const [model, setModel]       = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef  = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open) return;
    fetch('/api/lazuros/models', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data?.models?.length) return;
        const names: string[] = data.models.map((m: any) => m.name ?? String(m));
        setModels(names);
        setModel(prev => prev || names[0] || '');
      })
      .catch(() => {});
  }, [open]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const send = useCallback(async () => {
    if (!input.trim() || streaming) return;
    const userText = input.trim();
    setInput('');

    const history: Message[] = [...messages, { role: 'user', content: userText }];
    setMessages(history);
    setStreaming(true);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const r = await fetch('/api/lazuros/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        signal: ctrl.signal,
        body: JSON.stringify({
          model: model || 'llama3.2',
          messages: history.map(m => ({ role: m.role, content: m.content })),
          stream: true,
        }),
      });

      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      if (!r.body) throw new Error('No body');

      setMessages(prev => [...prev, { role: 'assistant', content: '' }]);

      const reader  = r.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';

        for (const line of lines) {
          const s = line.trim();
          if (!s) continue;
          try {
            const chunk = JSON.parse(s);
            const token: string = chunk.message?.content ?? '';
            if (token) {
              setMessages(prev => {
                const last = prev[prev.length - 1];
                return [...prev.slice(0, -1), { ...last, content: last.content + token }];
              });
            }
          } catch { /* skip */ }
        }
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      setMessages(prev => [...prev, { role: 'assistant', content: `ERR: ${err.message ?? err}` }]);
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }, [input, streaming, messages, model]);

  const stop = () => { abortRef.current?.abort(); };

  const clear = () => { if (!streaming) setMessages([]); };

  if (!open) return null;

  return (
    <div style={{
      position: 'fixed',
      top: 'var(--hub-header-h)',
      right: 0,
      bottom: 'var(--hub-footer-h)',
      width: 420,
      background: 'var(--hub-bg-1)',
      borderLeft: '1px solid var(--hub-line-strong)',
      boxShadow: '-4px 0 32px rgba(0,0,0,0.7)',
      display: 'flex', flexDirection: 'column',
      fontFamily: 'var(--hub-font-mono)',
      zIndex: 80,
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '0 12px',
        height: 44, flexShrink: 0,
        borderBottom: '1px solid var(--hub-line-strong)',
        background: 'linear-gradient(180deg, var(--hub-bg-3), var(--hub-bg-2))',
      }}>
        <div style={{ fontSize: 14, color: 'var(--hub-amber)', filter: 'drop-shadow(0 0 6px var(--hub-amber-glow))' }}>◎</div>
        <span style={{ color: 'var(--hub-amber)', fontSize: 11, letterSpacing: '0.2em', fontWeight: 700 }}>AI CONSOLE</span>

        {models.length > 0 && (
          <select
            value={model}
            onChange={e => setModel(e.target.value)}
            style={{
              marginLeft: 8,
              background: 'var(--hub-bg-0)', border: '1px solid var(--hub-line)',
              color: 'var(--hub-cream)', fontFamily: 'var(--hub-font-mono)',
              fontSize: 10, padding: '3px 6px', outline: 'none', cursor: 'pointer',
            }}
          >
            {models.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {messages.length > 0 && !streaming && (
            <button onClick={clear} style={btnStyle('var(--hub-cream-faint)', 'var(--hub-line)')}>CLR</button>
          )}
          {streaming && (
            <button onClick={stop} style={btnStyle('var(--hub-red)', 'var(--hub-red-dim)')}>STOP</button>
          )}
          <button onClick={onClose} style={btnStyle('var(--hub-cream-dim)', 'var(--hub-line)', 28)}>×</button>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} style={{
        flex: 1, overflowY: 'auto',
        padding: '14px 12px',
        display: 'flex', flexDirection: 'column', gap: 16,
      }}>
        {messages.length === 0 && (
          <div style={{
            flex: 1, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 14,
            minHeight: 200,
          }}>
            <div style={{ fontSize: 32, color: 'var(--hub-amber-dim)', filter: 'drop-shadow(0 0 10px var(--hub-amber-glow))' }}>◎</div>
            <div style={{ fontSize: 10, letterSpacing: '0.22em', color: 'var(--hub-cream-faint)' }}>CONSOLE READY</div>
            {model && (
              <div style={{ fontSize: 9, letterSpacing: '0.14em', color: 'var(--hub-cream-faint)', opacity: 0.6 }}>
                MODEL · {model}
              </div>
            )}
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} style={{
            display: 'flex', flexDirection: 'column',
            alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start',
            gap: 4,
          }}>
            <div style={{
              fontSize: 9, letterSpacing: '0.2em',
              color: msg.role === 'user' ? 'var(--hub-amber-dim)' : 'var(--hub-cyan-dim)',
            }}>
              {msg.role === 'user' ? 'OPERATOR' : `LAZUROS · ${model}`}
            </div>
            <div style={{
              maxWidth: '90%',
              padding: '8px 12px',
              background: msg.role === 'user' ? 'var(--hub-bg-3)' : 'var(--hub-bg-0)',
              border: `1px solid ${msg.role === 'user' ? 'var(--hub-line-strong)' : 'var(--hub-line)'}`,
              color: 'var(--hub-cream)',
              fontSize: 11, lineHeight: 1.75,
              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            }}>
              {msg.content || (
                <span style={{ color: 'var(--hub-amber)', opacity: 0.7 }}>█</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Input bar */}
      <div style={{
        flexShrink: 0, borderTop: '1px solid var(--hub-line-strong)',
        padding: '10px 12px', display: 'flex', gap: 8,
        background: 'var(--hub-bg-0)',
      }}>
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
          }}
          placeholder="Message… (Enter to send · Shift+Enter for newline)"
          rows={2}
          disabled={streaming}
          style={{
            flex: 1, resize: 'none',
            background: 'var(--hub-bg-1)', border: '1px solid var(--hub-line)',
            color: 'var(--hub-cream)', fontFamily: 'var(--hub-font-mono)',
            fontSize: 11, padding: '7px 9px', outline: 'none', lineHeight: 1.5,
          }}
        />
        <button
          onClick={send}
          disabled={streaming || !input.trim()}
          style={{
            ...btnStyle(
              streaming || !input.trim() ? 'var(--hub-cream-faint)' : 'var(--hub-amber)',
              streaming || !input.trim() ? 'var(--hub-line)' : 'var(--hub-amber-dim)',
            ),
            padding: '0 16px', alignSelf: 'stretch', height: 'auto',
            cursor: streaming ? 'wait' : !input.trim() ? 'default' : 'pointer',
            background: streaming || !input.trim() ? 'transparent' : 'var(--hub-amber-deep)',
            letterSpacing: '0.1em', fontSize: 10,
          }}
        >
          {streaming ? '●●●' : 'TX →'}
        </button>
      </div>
    </div>
  );
}

function btnStyle(color: string, border: string, size?: number): React.CSSProperties {
  return {
    background: 'transparent',
    border: `1px solid ${border}`,
    color,
    fontFamily: 'var(--hub-font-mono)',
    fontSize: 10, letterSpacing: '0.1em',
    height: size ?? 24, minWidth: size ?? 36,
    padding: size ? 0 : '0 8px',
    cursor: 'pointer',
    display: 'grid', placeItems: 'center',
  };
}
