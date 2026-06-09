export function WidgetShell({ name, code, color, note }: { name: string; code: string; color: string; note: string }) {
  return (
    <div style={{
      height: '100%',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      gap: 12, padding: 20, textAlign: 'center',
      fontFamily: 'var(--hub-font-mono)',
      background: 'var(--hub-bg-0)',
    }}>
      <div style={{ fontSize: 28, color, filter: `drop-shadow(0 0 8px ${color}88)` }}>◈</div>
      <div style={{ fontSize: 14, letterSpacing: '0.15em', color, fontWeight: 600 }}>{name}</div>
      <div style={{
        fontSize: 9, letterSpacing: '0.15em',
        padding: '2px 8px',
        border: `1px solid ${color}44`,
        color: 'var(--hub-cream-dim)',
      }}>
        {code} // MODULE OFFLINE
      </div>
      <div style={{ fontSize: 9, color: 'var(--hub-cream-dim)', letterSpacing: '0.08em', lineHeight: 1.6, maxWidth: 220, marginTop: 8 }}>
        {note}
      </div>
    </div>
  );
}
