import { useState, useEffect } from 'react';
import { DymoTape, Led, SegDisplay } from '../../components/hardware';
import { ToolButton } from '../helpers';

interface SwState {
  running: boolean;
  elapsed: number;
  startedAt: number | null;
  laps: number[];
}

function fmtTime(ms: number) {
  const t = Math.floor(ms / 1000);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const cs = Math.floor((ms % 1000) / 10);
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(cs).padStart(2,'0')}`;
}

export default function StopwatchWidget({ widgetId }: { widgetId: number }) {
  const key = `ordeck-stopwatch-${widgetId}`;
  const [state, setState] = useState<SwState>(() => {
    try { return JSON.parse(localStorage.getItem(key) || '') || { running: false, elapsed: 0, startedAt: null, laps: [] }; }
    catch { return { running: false, elapsed: 0, startedAt: null, laps: [] }; }
  });
  const [, force] = useState(0);

  useEffect(() => { localStorage.setItem(key, JSON.stringify(state)); }, [key, state]);
  useEffect(() => {
    if (!state.running) return;
    const iv = setInterval(() => force(t => t + 1), 50);
    return () => clearInterval(iv);
  }, [state.running]);

  const totalMs = state.elapsed + (state.running && state.startedAt ? Date.now() - state.startedAt : 0);
  const totalSec = Math.floor(totalMs / 1000);
  const hh = Math.floor(totalSec / 3600);
  const mm = Math.floor((totalSec % 3600) / 60);
  const ss = totalSec % 60;
  const cs = Math.floor((totalMs % 1000) / 10);

  const toggle = () => setState(s => s.running
    ? { ...s, running: false, elapsed: s.elapsed + (Date.now() - (s.startedAt ?? 0)), startedAt: null }
    : { ...s, running: true, startedAt: Date.now() });
  const reset = () => setState({ running: false, elapsed: 0, startedAt: null, laps: [] });
  const lap   = () => setState(s => ({ ...s, laps: [totalMs, ...s.laps].slice(0, 20) }));

  const timeStr = `${String(hh).padStart(2,'0')}${String(mm).padStart(2,'0')}${String(ss).padStart(2,'0')}`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, height: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <DymoTape style={{ fontSize: 8 }}>STOPWATCH</DymoTape>
        <Led color={state.running ? 'green' : 'amber'} off={!state.running} size="sm" />
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', gap: 4, alignItems: 'baseline' }}>
        <SegDisplay value={timeStr} length={6} size={26} separator />
        <span style={{
          color: 'var(--hub-amber-dim)', fontSize: 18,
          fontFamily: 'var(--hub-font-seg)', fontWeight: 700,
          marginLeft: 4, minWidth: 28,
        }} className="glow-dim">.{String(cs).padStart(2,'0')}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
        <ToolButton onClick={toggle} color={state.running ? 'var(--hub-red)' : 'var(--hub-green)'}>
          {state.running ? '■ STOP' : '▶ START'}
        </ToolButton>
        <ToolButton onClick={lap} disabled={!state.running}>↻ LAP</ToolButton>
        <ToolButton onClick={reset} secondary>⌫ RESET</ToolButton>
      </div>
      <div style={{ flex: 1, minHeight: 60, overflow: 'auto', background: 'var(--hub-bg-0)', border: '1px solid var(--hub-line)', padding: 4 }}>
        {state.laps.length === 0
          ? <div style={{ padding: 8, fontSize: 9, color: 'var(--hub-cream-faint)', letterSpacing: '0.15em', textAlign: 'center' }}>// NO LAPS RECORDED</div>
          : state.laps.map((lapMs, i) => {
              const idx = state.laps.length - i;
              const next = state.laps[i + 1] ?? 0;
              return (
                <div key={i} style={{
                  display: 'grid', gridTemplateColumns: '24px 1fr 1fr',
                  gap: 6, fontSize: 10, padding: '3px 6px',
                  borderBottom: '1px dotted var(--hub-bg-2)',
                  fontVariantNumeric: 'tabular-nums',
                }}>
                  <span style={{ color: 'var(--hub-cream-faint)' }}>#{String(idx).padStart(2,'0')}</span>
                  <span style={{ color: 'var(--hub-cream)' }}>{fmtTime(lapMs)}</span>
                  <span style={{ color: 'var(--hub-amber-dim)' }}>+{fmtTime(lapMs - next)}</span>
                </div>
              );
            })}
      </div>
    </div>
  );
}
