import { useState } from 'react';
import { Led, useTick } from './hardware';

const BOOT_TIME = Date.now();

function useUptime() {
  useTick(1000);
  const ms = Date.now() - BOOT_TIME;
  const s = Math.floor(ms / 1000);
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

interface FooterProps {
  widgetCount?: number;
  message?: string;
}

export default function Footer({
  widgetCount = 0,
  message = '▸ DRAG HEADERS · RESIZE FROM ⌐ · RIGHT-CLICK FOR CONFIG',
}: FooterProps) {
  const up = useUptime();
  const stamp = new Date()
    .toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: '2-digit' })
    .replace(/\//g, '');

  return (
    <footer style={{
      position: 'fixed',
      bottom: 0, left: 0, right: 0,
      height: 'var(--hub-footer-h)',
      background: 'linear-gradient(180deg, var(--hub-bg-2), var(--hub-bg-1))',
      borderTop: '1px solid var(--hub-line-strong)',
      display: 'flex', alignItems: 'center',
      padding: '0 14px',
      gap: 18,
      fontSize: 9.5,
      color: 'var(--hub-cream-dim)',
      letterSpacing: '0.14em',
      zIndex: 100,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Led color="green" size="sm" />
        SURFACE READY
      </div>
      <div>WIDGETS: <span style={{ color: 'var(--hub-cream)' }}>{String(widgetCount).padStart(2, '0')}</span></div>
      <div>UPTIME: <span style={{ color: 'var(--hub-amber)' }} className="glow-dim">{up}</span></div>
      <div>HOST: ordeck.local</div>
      <div style={{ marginLeft: 'auto', color: 'var(--hub-cream-faint)' }}>{message}</div>
      <SignOutLink />
      <div style={{ paddingLeft: 12, borderLeft: '1px solid var(--hub-line)' }}>BUILD {stamp}</div>
    </footer>
  );
}

function SignOutLink() {
  const [hover, setHover] = useState(false);
  return (
    <a
      href="login.html"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        padding: '3px 8px',
        background: 'var(--hub-bg-0)',
        border: `1px solid ${hover ? 'var(--hub-amber-dim)' : 'var(--hub-line-strong)'}`,
        color: hover ? 'var(--hub-amber)' : 'var(--hub-cream-dim)',
        letterSpacing: '0.18em',
        fontSize: 9,
        textDecoration: 'none',
        transition: 'all 0.12s',
      }}
    >⏻ SIGN OUT</a>
  );
}
