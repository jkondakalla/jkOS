import { useState, useEffect } from 'react';
import { MiniLabel } from '../helpers';

function compute(a: number, b: number, op: string): number {
  switch (op) {
    case '+': return a + b;
    case '-': return a - b;
    case '*': return a * b;
    case '/': return b === 0 ? NaN : a / b;
    default:  return b;
  }
}

function formatNum(n: number): string {
  if (!isFinite(n)) return 'ERR';
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return String(n);
  return parseFloat(n.toFixed(8)).toString();
}

export default function CalcWidget({ widgetId }: { widgetId: number }) {
  const key = `ordeck-calc-${widgetId}`;
  const [display, setDisplay] = useState('0');
  const [acc, setAcc] = useState<number | null>(null);
  const [op, setOp] = useState<string | null>(null);
  const [doReset, setDoReset] = useState(false);
  const [history, setHistory] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; }
  });
  useEffect(() => { localStorage.setItem(key, JSON.stringify(history)); }, [key, history]);

  const press = (n: number) => {
    if (doReset || display === '0') setDisplay(String(n));
    else setDisplay(d => d.length > 14 ? d : d + n);
    setDoReset(false);
  };
  const pressDot = () => {
    if (doReset) { setDisplay('0.'); setDoReset(false); return; }
    if (!display.includes('.')) setDisplay(d => d + '.');
  };
  const setOperator = (newOp: string) => {
    const cur = parseFloat(display);
    if (acc != null && op && !doReset) {
      const result = compute(acc, cur, op);
      setAcc(result); setDisplay(formatNum(result));
    } else { setAcc(cur); }
    setOp(newOp); setDoReset(true);
  };
  const equals = () => {
    if (acc == null || op == null) return;
    const cur = parseFloat(display);
    const result = compute(acc, cur, op);
    const fmt = formatNum(result);
    setHistory(h => [`${formatNum(acc)} ${op} ${formatNum(cur)} = ${fmt}`, ...h].slice(0, 30));
    setDisplay(fmt); setAcc(null); setOp(null); setDoReset(true);
  };
  const clear  = () => { setDisplay('0'); setAcc(null); setOp(null); setDoReset(false); };
  const back   = () => setDisplay(d => d.length <= 1 ? '0' : d.slice(0, -1));
  const negate = () => setDisplay(d => d === '0' ? d : d.startsWith('-') ? d.slice(1) : '-' + d);
  const pct    = () => setDisplay(d => formatNum(parseFloat(d) / 100));

  const btn = (label: string, action: () => void, color?: string) => (
    <button key={label} onClick={action}
      onMouseDown={e => { (e.currentTarget as HTMLElement).style.background = 'var(--hub-bg-0)'; }}
      onMouseUp={e => { (e.currentTarget as HTMLElement).style.background = 'linear-gradient(180deg, var(--hub-bg-3), var(--hub-bg-2))'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'linear-gradient(180deg, var(--hub-bg-3), var(--hub-bg-2))'; }}
      style={{
        padding: '10px 6px',
        background: 'linear-gradient(180deg, var(--hub-bg-3), var(--hub-bg-2))',
        border: '1px solid var(--hub-line-strong)',
        color: color || 'var(--hub-cream)',
        fontFamily: 'var(--hub-font-mono)',
        fontSize: 12, letterSpacing: '0.06em', fontWeight: 500,
        cursor: 'pointer',
        boxShadow: 'inset 0 1px 0 rgba(255,220,160,0.06), 0 1px 0 rgba(0,0,0,0.6)',
      }}
    >{label}</button>
  );

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{
        padding: '6px 10px', background: 'var(--hub-bg-0)', borderBottom: '1px solid var(--hub-line)',
        display: 'flex', alignItems: 'center', gap: 8, fontSize: 10, letterSpacing: '0.08em',
      }}>
        <span style={{ color: 'var(--hub-amber)', letterSpacing: '0.15em', fontWeight: 600 }} className="glow-dim">CALC · 64-BIT</span>
        <MiniLabel style={{ marginLeft: 'auto' }}>{history.length} HIST</MiniLabel>
      </div>
      <div style={{ padding: 8, background: 'var(--hub-bg-0)', borderBottom: '1px solid var(--hub-line)' }}>
        <div style={{ fontSize: 8, color: 'var(--hub-cream-faint)', letterSpacing: '0.15em', minHeight: 12, textAlign: 'right' }}>
          {acc != null ? `${formatNum(acc)} ${op || ''}` : ' '}
        </div>
        <div style={{
          color: 'var(--hub-amber)', fontSize: 28, fontWeight: 600,
          fontFamily: 'var(--hub-font-seg)', textShadow: '0 0 8px var(--hub-amber-glow)',
          letterSpacing: '0.04em', textAlign: 'right',
          overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{display}</div>
      </div>
      <div style={{
        flex: 1, padding: 6, background: 'var(--hub-bg-1)',
        display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
        gridAutoRows: '1fr', gap: 4,
      }}>
        {btn('AC', clear, 'var(--hub-red)')}
        {btn('±',  negate)}
        {btn('%',  pct)}
        {btn('÷',  () => setOperator('/'), 'var(--hub-amber)')}
        {btn('7',  () => press(7))}{btn('8', () => press(8))}{btn('9', () => press(9))}
        {btn('×',  () => setOperator('*'), 'var(--hub-amber)')}
        {btn('4',  () => press(4))}{btn('5', () => press(5))}{btn('6', () => press(6))}
        {btn('−',  () => setOperator('-'), 'var(--hub-amber)')}
        {btn('1',  () => press(1))}{btn('2', () => press(2))}{btn('3', () => press(3))}
        {btn('+',  () => setOperator('+'), 'var(--hub-amber)')}
        {btn('⌫',  back)}
        {btn('0',  () => press(0))}
        {btn('.',  pressDot)}
        {btn('=',  equals, 'var(--hub-amber-bright)')}
      </div>
    </div>
  );
}
