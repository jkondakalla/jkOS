import { useEffect, useState } from 'react';
import { Led, Vent } from './hardware';
import { ConfigButton } from './settings';

// ─── Hooks ────────────────────────────────────────────────────────────────────

function useUTCClock() {
  const [time, setTime] = useState('');
  useEffect(() => {
    const fmt = () => {
      const n = new Date();
      return [n.getUTCHours(), n.getUTCMinutes(), n.getUTCSeconds()]
        .map(v => String(v).padStart(2, '0')).join(':');
    };
    setTime(fmt());
    const iv = setInterval(() => setTime(fmt()), 1000);
    return () => clearInterval(iv);
  }, []);
  return time;
}

// ─── Header ───────────────────────────────────────────────────────────────────

interface HeaderProps {
  widgetCount?: number;
  onOpenConfig?: () => void;
  configOpen?: boolean;
  onOpenAI?: () => void;
  aiOpen?: boolean;
  onOpenProfile?: () => void;
  profileOpen?: boolean;
  onOpenPalette?: () => void;
  paletteOpen?: boolean;
}

export default function Header({
  widgetCount = 0,
  onOpenConfig,
  configOpen = false,
  onOpenAI,
  aiOpen = false,
  onOpenProfile,
  profileOpen = false,
  onOpenPalette,
  paletteOpen = false,
}: HeaderProps) {
  const utc = useUTCClock();
  const count = widgetCount;

  return (
    <header style={{
      position: 'fixed', top: 0, left: 0, right: 0,
      height: 'var(--hub-header-h)',
      background: 'linear-gradient(180deg, var(--hub-bg-3) 0%, var(--hub-bg-1) 100%)',
      borderBottom: '1px solid var(--hub-line-strong)',
      boxShadow: '0 1px 0 rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,220,160,0.04)',
      display: 'flex', alignItems: 'stretch',
      zIndex: 100,
    }}>
      {/* Brand block */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '0 20px',
        borderRight: '1px solid var(--hub-line)',
        minWidth: 'var(--hub-sidebar-w)',
        flexShrink: 0,
      }}>
        <div style={{
          width: 32, height: 32, flexShrink: 0,
          border: '1.5px solid var(--hub-amber)',
          color: 'var(--hub-amber)',
          display: 'grid', placeItems: 'center',
          fontWeight: 800, fontSize: 14,
          boxShadow: '0 0 10px var(--hub-amber-glow)',
          background: 'radial-gradient(circle at 30% 25%, var(--hub-bg-3), var(--hub-bg-0))',
          fontFamily: 'var(--hub-font-seg)',
        }}>JK</div>
        <div>
          <div style={{
            color: 'var(--hub-amber)', fontWeight: 700,
            letterSpacing: '0.18em', fontSize: 14,
            textShadow: '0 0 6px var(--hub-amber-glow)',
            fontFamily: 'var(--hub-font-seg)',
            lineHeight: 1,
          }}>ORDECK</div>
          <div style={{ color: 'var(--hub-cream-faint)', fontSize: 8, letterSpacing: '0.18em', marginTop: 3 }}>
            PORTAL · v2.0
          </div>
        </div>
      </div>

      {/* Center — status only */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', padding: '0 16px', gap: 8 }}>
        <Led color="green" size="sm" />
        <span style={{ fontSize: 9, color: 'var(--hub-cream-dim)', letterSpacing: '0.18em', fontFamily: 'var(--hub-font-mono)' }}>READY</span>
        <span style={{ fontSize: 9, color: 'var(--hub-cream-faint)', letterSpacing: '0.12em', fontFamily: 'var(--hub-font-mono)' }}>
          · {count > 0 ? `${count} WIDGETS` : 'SURFACE CLEAR'}
        </span>
      </div>

      {/* Right cluster: UTC + AI + config + profile + vent */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '0 16px',
        borderLeft: '1px solid var(--hub-line)',
      }}>
        <div style={{
          padding: '5px 10px',
          background: 'var(--hub-bg-0)',
          border: '1px solid var(--hub-line)',
          boxShadow: 'inset 0 0 6px rgba(0,0,0,0.7)',
          display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2,
        }}>
          <span className="mono-eyebrow">UTC</span>
          <span style={{
            color: 'var(--hub-amber)', fontSize: 16, fontWeight: 500,
            fontVariantNumeric: 'tabular-nums',
            letterSpacing: '0.08em',
            fontFamily: 'var(--hub-font-seg)',
          }} className="glow">{utc || '00:00:00'}</span>
        </div>
        {onOpenPalette && (
          <button
            onClick={onOpenPalette}
            title="Widget Palette"
            style={{
              background: paletteOpen ? 'color-mix(in srgb, var(--hub-amber) 15%, transparent)' : 'transparent',
              border: `1px solid ${paletteOpen ? 'var(--hub-amber-dim)' : 'var(--hub-line)'}`,
              color: paletteOpen ? 'var(--hub-amber)' : 'var(--hub-cream-dim)',
              fontFamily: 'var(--hub-font-mono)',
              fontSize: 13, width: 32, height: 32,
              cursor: 'pointer', display: 'grid', placeItems: 'center',
              boxShadow: paletteOpen ? '0 0 8px var(--hub-amber-glow)' : 'none',
              transition: 'all 0.15s',
            }}
          >⊞</button>
        )}
        {onOpenAI && (
          <button
            onClick={onOpenAI}
            title="AI Console"
            style={{
              background: aiOpen ? 'color-mix(in srgb, var(--hub-amber) 15%, transparent)' : 'transparent',
              border: `1px solid ${aiOpen ? 'var(--hub-amber-dim)' : 'var(--hub-line)'}`,
              color: aiOpen ? 'var(--hub-amber)' : 'var(--hub-cream-dim)',
              fontFamily: 'var(--hub-font-mono)',
              fontSize: 14, width: 32, height: 32,
              cursor: 'pointer', display: 'grid', placeItems: 'center',
              boxShadow: aiOpen ? '0 0 8px var(--hub-amber-glow)' : 'none',
              transition: 'all 0.15s',
            }}
          >◎</button>
        )}
        {onOpenConfig && (
          <ConfigButton open={configOpen} onClick={onOpenConfig} />
        )}
        {onOpenProfile && (
          <ProfileButton open={profileOpen} onClick={onOpenProfile} />
        )}
        <Vent slats={4} width={32} />
      </div>
    </header>
  );
}

// ─── Internals ────────────────────────────────────────────────────────────────

function ProfileButton({ open, onClick }: { open: boolean; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label="Open suite settings"
      title="Suite Settings"
      style={{
        width: 30, height: 30, borderRadius: '50%', cursor: 'pointer',
        background: open
          ? 'var(--hub-amber)'
          : 'color-mix(in srgb, var(--hub-amber) 15%, var(--hub-bg-2))',
        border: `1.5px solid ${open ? 'var(--hub-amber)' : 'var(--hub-line-strong)'}`,
        color: open ? 'var(--hub-bg-0)' : 'var(--hub-amber)',
        fontFamily: 'var(--hub-font-mono)',
        fontSize: 11, fontWeight: 700, letterSpacing: '0.03em',
        display: 'grid', placeItems: 'center',
        boxShadow: open ? '0 0 10px var(--hub-amber-glow)' : 'none',
        transition: 'all 0.15s',
      }}
    >
      <span style={{ fontSize: 14, lineHeight: 1 }}>⊙</span>
    </button>
  );
}

