import { useRef, useState, useEffect } from 'react';
import type { JkOSTheme, JkosUser, EffectsPreferences } from '../../hooks/useJkOSPreferences';

const AUTH_URL =
  (import.meta.env.VITE_JKOS_AUTH_URL as string | undefined) ?? 'https://auth.jkos.net';

const PRESETS = [
  { label: 'Amber · Cyan',    primary: '#ffb000', secondary: '#4ecdc4' },
  { label: 'Green · Violet',  primary: '#5cd66a', secondary: '#c08aff' },
  { label: 'Ice · Coral',     primary: '#a8d8ff', secondary: '#ff6b5a' },
  { label: 'Gold · Mint',     primary: '#ffd000', secondary: '#5affc1' },
  { label: 'Rose · Amber',    primary: '#ff7a9a', secondary: '#ffb000' },
  { label: 'Electric · Lime', primary: '#2eb3ff', secondary: '#aeff1e' },
];

interface Props {
  open:         boolean;
  onClose:      () => void;
  user:         JkosUser | null;
  theme:        JkOSTheme;
  effects:      EffectsPreferences;
  saving:       boolean;
  patchTheme:   (p: Partial<JkOSTheme>) => void;
  patchEffects: (p: Partial<EffectsPreferences>) => void;
}

// ── Shared styles ─────────────────────────────────────────────────────────────

const FONT = 'var(--hub-font-mono)';
const ACCENT = 'var(--hub-amber)';

// Mode-flipping surfaces (resolve via data-mode tokens, so the drawer is dark
// on CRT and warm paper in light mode — not a hardcoded dark panel).
const SURFACE = 'color-mix(in srgb, var(--hub-bg-1) 96%, transparent)';
const TXT       = 'var(--color-ink)';     // bright/primary text
const TXT_MUTED = 'var(--color-muted)';
const TXT_FAINT = 'var(--color-faint)';
const LINE      = 'var(--hub-line)';
const FIELD     = 'color-mix(in srgb, var(--color-ink) 6%, transparent)';
const FIELD_HI  = 'color-mix(in srgb, var(--color-ink) 11%, transparent)';

const panelBase: React.CSSProperties = {
  position: 'fixed', top: 0, right: 0,
  height: '100dvh', width: 380,
  background: SURFACE,
  backdropFilter: 'blur(32px) saturate(160%)',
  borderLeft: `1px solid ${LINE}`,
  boxShadow: '-24px 0 64px rgba(0,0,0,0.45)',
  zIndex: 400,
  display: 'flex', flexDirection: 'column',
  overflowY: 'auto',
  overflowX: 'hidden',
  transition: 'transform 0.28s cubic-bezier(0.4, 0.2, 0.2, 1)',
};

const sect: React.CSSProperties = {
  padding: '18px 20px',
  borderBottom: `1px solid ${LINE}`,
};

function SectionLabel({ children }: { children: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14,
    }}>
      <span style={{
        fontSize: 9, letterSpacing: '0.2em', color: 'var(--hub-cream-faint)',
        textTransform: 'uppercase', fontFamily: FONT, flexShrink: 0,
      }}>{children}</span>
      <span style={{ flex: 1, height: 1, background: 'var(--hub-line)' }} />
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function UnifiedSettingsPanel({
  open, onClose, user, theme, effects, saving,
  patchTheme, patchEffects,
}: Props) {
  const src = (user?.name || user?.email || '?').trim();
  const parts = src.split(/[\s@.]+/).filter(Boolean);
  const inits = ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || src[0].toUpperCase();

  const handleLogout = () => {
    fetch(`${AUTH_URL}/auth/logout`, { method: 'POST', credentials: 'include' })
      .finally(() => { window.location.href = `${AUTH_URL}/auth/login`; });
  };

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0,
          background: open ? 'rgba(0,0,0,0.35)' : 'transparent',
          backdropFilter: open ? 'blur(1px)' : 'none',
          opacity: open ? 1 : 0,
          pointerEvents: open ? 'auto' : 'none',
          transition: 'opacity 0.25s, backdrop-filter 0.25s',
          zIndex: 399,
        }}
      />

      <aside style={{ ...panelBase, transform: open ? 'translateX(0)' : 'translateX(105%)' }}>

        {/* Top bar */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '13px 20px',
          borderBottom: `1px solid ${LINE}`,
          flexShrink: 0,
        }}>
          <span style={{ fontSize: 9, letterSpacing: '0.2em', color: TXT_MUTED, fontFamily: FONT, textTransform: 'uppercase' }}>
            jkOS Suite{saving && <span style={{ color: ACCENT, marginLeft: 10 }}>· Saving</span>}
          </span>
          <button type="button" onClick={onClose} style={{
            background: 'transparent', border: 'none',
            color: TXT_FAINT, cursor: 'pointer',
            fontSize: 18, padding: '0 2px', lineHeight: 1,
            transition: 'color 0.12s',
          }}
            onMouseEnter={e => (e.currentTarget.style.color = TXT)}
            onMouseLeave={e => (e.currentTarget.style.color = TXT_FAINT)}
          >×</button>
        </div>

        {/* Profile */}
        <section style={{ ...sect, display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{
            width: 38, height: 38, borderRadius: '50%', flexShrink: 0,
            background: `linear-gradient(135deg, var(--hub-amber-dim), var(--hub-amber))`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: FONT, fontSize: 14, fontWeight: 700, color: 'var(--color-accent-contrast)',
            boxShadow: 'var(--hub-accent-press)',
          }}>{inits}</div>
          <div style={{ minWidth: 0 }}>
            <div style={{
              fontSize: 13, color: TXT, fontWeight: 600,
              lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {user?.name || 'User'}
              {user?.role === 'guest' && (
                <span style={{ marginLeft: 8, fontSize: 8, letterSpacing: '0.1em', color: ACCENT, fontFamily: FONT }}>GUEST</span>
              )}
            </div>
            <div style={{
              fontSize: 11, color: TXT_FAINT, marginTop: 3,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              fontFamily: FONT,
            }}>
              {user?.email}
            </div>
          </div>
        </section>

        {/* Appearance */}
        <section style={sect}>
          <SectionLabel>Appearance</SectionLabel>

          {/* Mode toggle */}
          <div style={{ display: 'flex', gap: 3, marginBottom: 16 }}>
            {(['system', 'light', 'dark'] as JkOSTheme['mode'][]).map(m => (
              <button type="button" key={m}
                onClick={() => patchTheme({ mode: m })}
                style={{
                  flex: 1, padding: '7px 0',
                  background: theme.mode === m ? ACCENT : FIELD,
                  border: `1px solid ${theme.mode === m ? ACCENT : LINE}`,
                  color: theme.mode === m ? 'var(--color-accent-contrast)' : TXT_MUTED,
                  fontFamily: FONT,
                  fontSize: 8, letterSpacing: '0.14em', textTransform: 'uppercase',
                  cursor: 'pointer', transition: 'all 0.14s',
                  boxShadow: theme.mode === m ? 'var(--hub-accent-press)' : 'none',
                  outline: 'none',
                }}>
                {m === 'system' ? 'Auto' : m === 'light' ? 'Light' : 'Dark'}
              </button>
            ))}
          </div>

          {/* Presets */}
          <div style={{ fontSize: 8, letterSpacing: '0.16em', color: TXT_FAINT, fontFamily: FONT, marginBottom: 8, textTransform: 'uppercase' }}>
            Presets
          </div>
          <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
            {PRESETS.map(p => {
              const active = theme.primary === p.primary && theme.secondary === p.secondary;
              return (
                <button type="button"
                  key={p.label}
                  onClick={() => patchTheme({ primary: p.primary, secondary: p.secondary, customAccent: false })}
                  title={p.label}
                  style={{
                    width: 48, height: 28,
                    background: active ? FIELD_HI : FIELD,
                    border: `1px solid ${active ? 'var(--hub-amber)' : LINE}`,
                    boxShadow: active ? 'var(--hub-accent-press)' : 'none',
                    cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                    transition: 'all 0.12s',
                    outline: 'none',
                  }}
                >
                  <span style={{ width: 9, height: 9, borderRadius: '50%', background: p.primary, boxShadow: `0 0 4px ${p.primary}88`, display: 'inline-block', flexShrink: 0 }} />
                  <span style={{ width: 9, height: 9, borderRadius: '50%', background: p.secondary, boxShadow: `0 0 4px ${p.secondary}88`, display: 'inline-block', flexShrink: 0 }} />
                </button>
              );
            })}
          </div>

          {/* Hand-picked colors set customAccent so they're honored exactly in
              both modes (presets auto-deepen on light paper). */}
          <ColorRow label="Primary"   color={theme.primary}   onChange={c => patchTheme({ primary: c, customAccent: true })} />
          <ColorRow label="Secondary" color={theme.secondary} onChange={c => patchTheme({ secondary: c, customAccent: true })} />
        </section>

        {/* Effects */}
        <section style={sect}>
          <SectionLabel>Effects</SectionLabel>
          <EffectRow label="Film grain"  value={effects.grain}     onToggle={v => patchEffects({ grain: v })}>
            {effects.grain && <SliderInput value={effects.grainStrength} min={0} max={1} step={0.05} onChange={v => patchEffects({ grainStrength: v })} />}
          </EffectRow>
          {/* Halation is intrinsic to dark mode (always on) — not user-toggleable. */}
          <EffectRow label="Scan lines"  value={effects.scanLines} onToggle={v => patchEffects({ scanLines: v })}>
            {effects.scanLines && <SliderInput value={effects.scanStrength} min={0} max={1} step={0.05} onChange={v => patchEffects({ scanStrength: v })} />}
          </EffectRow>
          <EffectRow label="Artifacts"   value={effects.artifacts} onToggle={v => patchEffects({ artifacts: v })} />
        </section>

        {/* Account */}
        <section style={{ ...sect, borderBottom: 'none' }}>
          <SectionLabel>Account</SectionLabel>
          <div style={{ display: 'flex', gap: 8 }}>
            <a
              href={`${AUTH_URL}/auth/dashboard`}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                flex: 1, padding: '8px 12px', textAlign: 'center', textDecoration: 'none',
                border: '1px solid var(--hub-line)',
                background: FIELD,
                color: 'var(--hub-cream-dim)',
                fontSize: 10, letterSpacing: '0.1em', fontFamily: FONT,
                transition: 'all 0.12s',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = LINE; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = FIELD; }}
            >
              Manage ↗
            </a>
            <button type="button"
              onClick={handleLogout}
              style={{
                flex: 1, padding: '8px 12px',
                border: '1px solid color-mix(in srgb, var(--hub-red) 35%, transparent)',
                background: 'transparent',
                color: 'color-mix(in srgb, var(--hub-red) 65%, transparent)',
                fontSize: 10, letterSpacing: '0.1em', cursor: 'pointer',
                fontFamily: FONT, transition: 'all 0.12s', outline: 'none',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.borderColor = 'var(--hub-red-dim)';
                (e.currentTarget as HTMLElement).style.color = 'var(--hub-red)';
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.borderColor = 'color-mix(in srgb, var(--hub-red) 35%, transparent)';
                (e.currentTarget as HTMLElement).style.color = 'color-mix(in srgb, var(--hub-red) 65%, transparent)';
              }}
            >
              Sign out
            </button>
          </div>
        </section>
      </aside>
    </>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ColorRow({ label, color, onChange }: { label: string; color: string; onChange: (c: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(color);
  useEffect(() => setDraft(color), [color]);

  const handleText = (val: string) => {
    setDraft(val);
    if (/^#[0-9a-fA-F]{6}$/.test(val)) onChange(val);
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
      <span style={{ fontSize: 10, color: 'var(--hub-cream-faint)', width: 62, flexShrink: 0, fontFamily: FONT, letterSpacing: '0.06em' }}>
        {label}
      </span>
      <button type="button"
        onClick={() => ref.current?.click()}
        style={{
          width: 30, height: 30, flexShrink: 0,
          background: color,
          border: `2px solid ${LINE}`,
          cursor: 'pointer',
          boxShadow: `0 0 10px ${color}55`,
          outline: 'none',
          transition: 'box-shadow 0.15s',
        }}
      />
      <input ref={ref} type="color" value={color} onChange={e => onChange(e.target.value)}
        style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: 0, height: 0 }} />
      <input
        type="text"
        value={draft}
        onChange={e => handleText(e.target.value)}
        onBlur={() => { if (!/^#[0-9a-fA-F]{6}$/.test(draft)) setDraft(color); }}
        maxLength={7}
        spellCheck={false}
        style={{
          flex: 1,
          background: FIELD,
          border: '1px solid var(--hub-line)',
          color: /^#[0-9a-fA-F]{6}$/.test(draft) ? 'var(--hub-cream-bright)' : 'var(--hub-red)',
          padding: '5px 10px',
          fontFamily: FONT, fontSize: 11, letterSpacing: '0.08em',
          outline: 'none',
        }}
      />
    </div>
  );
}

function EffectRow({ label, value, onToggle, children }: {
  label: string; value: boolean; onToggle: (v: boolean) => void; children?: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: children ? 7 : 0 }}>
        <span style={{ fontSize: 11, color: value ? 'var(--hub-cream-bright)' : 'var(--hub-cream-faint)', fontFamily: FONT, letterSpacing: '0.04em' }}>
          {label}
        </span>
        <Toggle value={value} onChange={onToggle} />
      </div>
      {children}
    </div>
  );
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button"
      onClick={() => onChange(!value)}
      aria-pressed={value}
      style={{
        width: 36, height: 20, position: 'relative', cursor: 'pointer', flexShrink: 0,
        background: value ? ACCENT : LINE,
        border: `1px solid ${value ? ACCENT : LINE}`,
        borderRadius: 10, padding: 0, transition: 'all 0.18s', outline: 'none',
      }}
    >
      <span style={{
        position: 'absolute', top: 2, left: value ? 16 : 2, width: 14, height: 14,
        background: value ? 'var(--color-accent-contrast)' : TXT_MUTED,
        borderRadius: '50%',
        transition: 'left 0.18s cubic-bezier(0.4, 0.2, 0.2, 1)',
      }} />
    </button>
  );
}

function SliderInput({ value, min, max, step, onChange }: {
  value: number; min: number; max: number; step: number; onChange: (v: number) => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingLeft: 10, marginTop: 2 }}>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{ flex: 1, accentColor: ACCENT, cursor: 'pointer' }}
      />
      <span style={{ fontSize: 10, color: TXT_MUTED, width: 30, textAlign: 'right', fontFamily: FONT, flexShrink: 0 }}>
        {Math.round(value * 100)}%
      </span>
    </div>
  );
}

