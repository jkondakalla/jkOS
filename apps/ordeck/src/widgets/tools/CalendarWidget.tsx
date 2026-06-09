import { useState, useEffect, useMemo, CSSProperties } from 'react';
import { MiniLabel } from '../helpers';

export default function CalendarWidget() {
  const [now, setNow] = useState(new Date());
  const [view, setView] = useState(() => { const n = new Date(); return { year: n.getFullYear(), month: n.getMonth() }; });
  useEffect(() => {
    const iv = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(iv);
  }, []);

  const days = useMemo(() => {
    const first = new Date(view.year, view.month, 1);
    const startDow = first.getDay();
    const daysIn = new Date(view.year, view.month + 1, 0).getDate();
    const prevDays = new Date(view.year, view.month, 0).getDate();
    const arr: { d: number; dim?: boolean }[] = [];
    for (let i = startDow - 1; i >= 0; i--) arr.push({ d: prevDays - i, dim: true });
    for (let i = 1; i <= daysIn; i++) arr.push({ d: i });
    while (arr.length % 7) arr.push({ d: arr.length - startDow - daysIn + 1, dim: true });
    return arr;
  }, [view.year, view.month]);

  const monthName = new Date(view.year, view.month).toLocaleDateString('en-US', { month: 'long' }).toUpperCase();
  const isCurrentMonth = view.year === now.getFullYear() && view.month === now.getMonth();
  const nudge = (d: number) => setView(v => { const m = new Date(v.year, v.month + d); return { year: m.getFullYear(), month: m.getMonth() }; });

  const navBtn: CSSProperties = { width: 24, height: 22, background: 'var(--hub-bg-2)', border: '1px solid var(--hub-line-strong)', color: 'var(--hub-amber)', fontSize: 10, cursor: 'pointer' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button onClick={() => nudge(-1)} style={navBtn}>◀</button>
        <div style={{ flex: 1, textAlign: 'center' }}>
          <span style={{ fontFamily: 'var(--hub-font-seg)', color: 'var(--hub-amber)', fontSize: 16, fontWeight: 700, letterSpacing: '0.1em' }} className="glow-dim">
            {monthName} {view.year}
          </span>
        </div>
        <button onClick={() => nudge(1)} style={navBtn}>▶</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
        {['SUN','MON','TUE','WED','THU','FRI','SAT'].map(d => (
          <div key={d} style={{ textAlign: 'center', fontSize: 8, color: 'var(--hub-cream-faint)', letterSpacing: '0.15em', padding: '4px 0', borderBottom: '1px solid var(--hub-line)' }}>{d}</div>
        ))}
        {days.map((day, i) => {
          const isToday = !day.dim && isCurrentMonth && day.d === now.getDate();
          return (
            <div key={i} style={{
              aspectRatio: '1', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 11, fontFamily: 'var(--hub-font-mono)', fontVariantNumeric: 'tabular-nums',
              color: day.dim ? 'var(--hub-cream-faint)' : 'var(--hub-cream)',
              background: isToday ? 'var(--hub-amber-deep)' : 'transparent',
              border: isToday ? '1px solid var(--hub-amber)' : '1px solid transparent',
              boxShadow: isToday ? '0 0 6px var(--hub-amber-glow), inset 0 0 4px var(--hub-amber-glow)' : 'none',
              position: 'relative',
            }}>
              <span style={isToday ? { color: 'var(--hub-amber)', fontWeight: 700, textShadow: '0 0 4px var(--hub-amber-glow)' } : {}}>
                {day.d}
              </span>
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 'auto', padding: 8, background: 'var(--hub-bg-0)', border: '1px solid var(--hub-line)', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4 }}>
        {[
          { label: 'DAY',  value: String(now.getDate()).padStart(2,'0') },
          { label: 'WEEK', value: `W${Math.ceil(((now.getTime() - new Date(now.getFullYear(),0,1).getTime()) / 86400000 + new Date(now.getFullYear(),0,1).getDay()) / 7)}` },
          { label: 'DOY',  value: String(Math.floor((now.getTime() - new Date(now.getFullYear(),0,0).getTime()) / 86400000)).padStart(3,'0') },
        ].map(({ label, value }) => (
          <div key={label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <MiniLabel>{label}</MiniLabel>
            <span style={{ color: 'var(--hub-amber)', fontSize: 12, fontWeight: 600 }} className="glow-dim">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
