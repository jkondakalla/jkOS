import type { ReactNode, CSSProperties } from 'react';

interface WidgetProps {
  label:    string;
  led?:     'green' | 'amber' | 'red' | 'cyan' | 'blue' | boolean;
  right?:   ReactNode;
  children: ReactNode;
  pad?:     boolean;
  flush?:   boolean;
  color?:   string;
}

export function Widget({ label, led, right, children, pad = false, flush = false, color }: WidgetProps) {
  const ledColor = led === true ? 'green' : led === false ? undefined : led;

  const rail: CSSProperties = {
    height: 'var(--hub-bus-h, 28px)',
    padding: '0 10px',
    background: 'var(--hub-bg-2)',
    borderBottom: '1px solid var(--hub-line)',
    display: 'flex', alignItems: 'center', gap: 8,
    flexShrink: 0,
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={rail}>
        <span style={{
          fontSize: 9, letterSpacing: '0.18em', textTransform: 'uppercase',
          color: color ?? 'var(--hub-amber)', fontWeight: 600,
        }} className="glow-dim">
          {label}
        </span>
        <span style={{ flex: 1 }} />
        {right}
        {ledColor && <span className={`led ${ledColor}`} />}
      </div>
      <div style={{
        flex: 1, overflow: flush ? 'hidden' : 'auto',
        padding: pad ? 10 : 0,
      }}>
        {children}
      </div>
    </div>
  );
}
