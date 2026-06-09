import { useState, useEffect } from 'react';
import { DymoTape, Led } from '../../components/hardware';
import { MiniLabel, ToolButton } from '../helpers';

interface PomState {
  phase: 'work' | 'break';
  running: boolean;
  endsAt: number | null;
  remaining: number;
  completed: number;
  workMin: number;
  breakMin: number;
}

export default function PomodoroWidget({ widgetId }: { widgetId: number }) {
  const key = `ordeck-pomodoro-${widgetId}`;
  const [state, setState] = useState<PomState>(() => {
    try { return JSON.parse(localStorage.getItem(key) || '') || { phase: 'work', running: false, endsAt: null, remaining: 25 * 60 * 1000, completed: 0, workMin: 25, breakMin: 5 }; }
    catch { return { phase: 'work', running: false, endsAt: null, remaining: 25 * 60 * 1000, completed: 0, workMin: 25, breakMin: 5 }; }
  });
  const [, force] = useState(0);

  useEffect(() => { localStorage.setItem(key, JSON.stringify(state)); }, [key, state]);

  useEffect(() => {
    if (!state.running || !state.endsAt) return;
    const iv = setInterval(() => {
      force(t => t + 1);
      if (state.endsAt! - Date.now() <= 0) {
        const newPhase = state.phase === 'work' ? 'break' : 'work';
        const newMin = newPhase === 'work' ? state.workMin : state.breakMin;
        setState(s => ({ ...s, phase: newPhase, running: false, endsAt: null, remaining: newMin * 60 * 1000, completed: s.phase === 'work' ? s.completed + 1 : s.completed }));
      }
    }, 250);
    return () => clearInterval(iv);
  }, [state.running, state.endsAt, state.phase, state.workMin, state.breakMin]);

  const rem = state.running && state.endsAt ? Math.max(0, state.endsAt - Date.now()) : state.remaining;
  const mm = Math.floor(rem / 60000);
  const ss = Math.floor((rem % 60000) / 1000);
  const totalMs = (state.phase === 'work' ? state.workMin : state.breakMin) * 60000;
  const pct = 1 - rem / totalMs;
  const isWork = state.phase === 'work';
  const color = isWork ? 'var(--hub-amber)' : 'var(--hub-cyan)';

  const start = () => setState(s => ({ ...s, running: true, endsAt: Date.now() + s.remaining }));
  const pause = () => setState(s => ({ ...s, running: false, remaining: Math.max(0, (s.endsAt ?? 0) - Date.now()) }));
  const skip  = () => setState(s => { const p = s.phase === 'work' ? 'break' : 'work'; return { ...s, phase: p, running: false, endsAt: null, remaining: (p === 'work' ? s.workMin : s.breakMin) * 60000 }; });
  const reset = () => setState(s => ({ ...s, running: false, endsAt: null, remaining: (s.phase === 'work' ? s.workMin : s.breakMin) * 60000 }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, height: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <DymoTape style={{ fontSize: 8 }}>POMODORO</DymoTape>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Led color={isWork ? 'amber' : 'cyan'} size="sm" />
          <span style={{ fontSize: 9, letterSpacing: '0.2em', color, fontWeight: 600 }} className="glow-dim">
            {isWork ? 'FOCUS' : 'BREAK'}
          </span>
        </div>
      </div>
      <div style={{ position: 'relative', alignSelf: 'center' }}>
        <svg width="118" height="118" viewBox="0 0 118 118">
          <circle cx="59" cy="59" r="50" fill="none" stroke="var(--hub-bg-3)" strokeWidth="6" />
          <circle cx="59" cy="59" r="50" fill="none" stroke={color} strokeWidth="6"
            strokeDasharray={`${pct * 314} 314`} strokeLinecap="butt"
            transform="rotate(-90 59 59)"
            style={{ filter: `drop-shadow(0 0 4px ${color})`, transition: 'stroke-dasharray 0.4s linear' }} />
          {Array.from({ length: 24 }).map((_, i) => {
            const a = (i / 24) * Math.PI * 2 - Math.PI / 2;
            const x1 = 59 + Math.cos(a) * 42; const y1 = 59 + Math.sin(a) * 42;
            const x2 = 59 + Math.cos(a) * (i % 6 === 0 ? 36 : 39);
            const y2 = 59 + Math.sin(a) * (i % 6 === 0 ? 36 : 39);
            return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--hub-amber-dim)" strokeWidth={i % 6 === 0 ? 1 : 0.5} />;
          })}
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ fontFamily: 'var(--hub-font-seg)', fontSize: 28, fontWeight: 700, color, lineHeight: 1 }} className="glow">
            {String(mm).padStart(2,'0')}:{String(ss).padStart(2,'0')}
          </div>
          <div style={{ fontSize: 8, color: 'var(--hub-cream-faint)', letterSpacing: '0.2em', marginTop: 3 }}>
            {state.completed} CYCLE{state.completed === 1 ? '' : 'S'}
          </div>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
        <ToolButton onClick={state.running ? pause : start} color={state.running ? 'var(--hub-amber)' : color}>
          {state.running ? '❚❚ PAUSE' : '▶ START'}
        </ToolButton>
        <ToolButton onClick={skip}>↷ SKIP</ToolButton>
        <ToolButton onClick={reset} secondary>⌫</ToolButton>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 9 }}>
        {(['FOCUS', 'BREAK'] as const).map(label => {
          const isWork2 = label === 'FOCUS';
          const val = isWork2 ? state.workMin : state.breakMin;
          const onChange = (v: number) => setState(s => ({
            ...s,
            ...(isWork2 ? { workMin: v } : { breakMin: v }),
            ...(!s.running && s.phase === (isWork2 ? 'work' : 'break') ? { remaining: v * 60000 } : {}),
          }));
          return (
            <div key={label} style={{ background: 'var(--hub-bg-0)', border: '1px solid var(--hub-line)', padding: '4px 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <MiniLabel>{label}</MiniLabel>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <button onClick={() => onChange(Math.max(1, val - 1))} style={{ width: 16, height: 16, padding: 0, border: '1px solid var(--hub-line-strong)', background: 'var(--hub-bg-2)', color: 'var(--hub-cream)', fontSize: 11, lineHeight: 1, cursor: 'pointer' }}>−</button>
                <span style={{ color: 'var(--hub-amber)', fontFamily: 'var(--hub-font-seg)', fontWeight: 700, fontSize: 13, minWidth: 22, textAlign: 'center' }} className="glow-dim">{val}</span>
                <button onClick={() => onChange(Math.min(99, val + 1))} style={{ width: 16, height: 16, padding: 0, border: '1px solid var(--hub-line-strong)', background: 'var(--hub-bg-2)', color: 'var(--hub-cream)', fontSize: 11, lineHeight: 1, cursor: 'pointer' }}>+</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
