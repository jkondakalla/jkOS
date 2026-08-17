import { useRef, useState, useEffect } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { ACCENT_SCHEMES, matchAccentScheme, CUSTOM_SCHEME_ID, withAlpha } from '@jkos/design';
import { Field, Slider } from './primitives';

/* ─────────────────────────────────────────────────────────────────────────────
   @jkos/ui — the ONE settings drawer for the whole suite.

   Every app (ORDECK, BeigeBoard, SylibOS) mounts this exact component so the
   settings tray is identical everywhere. It is fully mode-aware: it paints from
   the shared --hub-* and --color-* tokens, so it is warm paper in light mode and a
   dark phosphor panel in dark mode — never a hardcoded dark glass.

   The data contract matches @jkos/auth-client's useJkOSPreferences() return.
   Types are declared structurally here so @jkos/ui stays decoupled from
   auth-client; the field names are the canonical preferences contract.

   There is deliberately no AI section: LazurOS has no per-user settings (one fixed
   edge path, models chosen per tier from the deployment config), and its one knob —
   the suite-wide kill switch — is owned by the jkAuth portal. Apps only READ
   `lazuros.enabled` to hide their own AI surfaces.
   App-specific settings (e.g. ORDECK weather) are passed via `extra`.
   ───────────────────────────────────────────────────────────────────────────── */

interface Theme {
  mode: 'light' | 'dark' | 'system';
  primary: string;
  secondary: string;
}
interface Effects {
  scanLines: boolean;
  scanStrength: number;
  artifacts: boolean;
  // halation is intrinsic to dark mode — deliberately not surfaced as a toggle.
  // film grain is a suite-wide background default (@jkos/design factory) — no toggle.
}
interface User {
  email: string;
  name: string;
  role?: string;
}

export interface SettingsDrawerProps {
  open: boolean;
  onClose: () => void;
  user: User | null;
  theme: Theme;
  effects: Effects;
  saving: boolean;
  patchTheme: (p: Partial<Theme>) => void;
  patchEffects: (p: Partial<Effects>) => void;
  /** jkAuth origin used by the Manage ↗ / Sign out actions. */
  authUrl: string;
  /** App-specific extra section(s), rendered just before Account (e.g. weather). */
  extra?: ReactNode;
  /** Drawer width in px (default 380). */
  width?: number;
}

const FONT = 'var(--hub-font-mono)';
const ACCENT = 'var(--color-accent)';
const CONTRAST = 'var(--color-accent-contrast)';
const TXT = 'var(--color-ink)';
const TXT_MUTED = 'var(--color-muted)';
const TXT_FAINT = 'var(--color-faint)';
const LINE = 'var(--hub-line)';
const FIELD = 'color-mix(in srgb, var(--color-ink) 6%, transparent)';
const FIELD_HI = 'color-mix(in srgb, var(--color-ink) 11%, transparent)';
const PRESS = 'var(--hub-accent-press)';

const sect: CSSProperties = { padding: '18px 20px', borderBottom: `1px solid ${LINE}` };

export function SettingsDrawer({
  open, onClose, user, theme, effects, saving,
  patchTheme, patchEffects, authUrl, extra, width = 380,
}: SettingsDrawerProps) {
  const src = (user?.name || user?.email || '?').trim();
  const parts = src.split(/[\s@.]+/).filter(Boolean);
  const inits = ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || src[0]?.toUpperCase() || '?';

  const handleLogout = () => {
    fetch(`${authUrl}/auth/logout`, { method: 'POST', credentials: 'include' })
      .finally(() => { window.location.href = `${authUrl}/auth/login`; });
  };

  // Esc closes the drawer.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const panelBase: CSSProperties = {
    position: 'fixed', top: 0, right: 0,
    height: '100dvh', width,
    background: 'color-mix(in srgb, var(--hub-bg-1) 96%, transparent)',
    backdropFilter: 'blur(32px) saturate(160%)',
    WebkitBackdropFilter: 'blur(32px) saturate(160%)',
    borderLeft: `1px solid ${LINE}`,
    boxShadow: '-24px 0 64px rgba(0,0,0,0.45)',
    zIndex: 400,
    display: 'flex', flexDirection: 'column',
    overflowY: 'auto', overflowX: 'hidden',
    transition: 'transform 0.28s cubic-bezier(0.4, 0.2, 0.2, 1)',
    transform: open ? 'translateX(0)' : 'translateX(105%)',
    fontFamily: 'var(--hub-font-sans)',
  };

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0,
          background: open ? 'var(--hub-scrim)' : 'transparent',
          backdropFilter: open ? 'blur(1px)' : 'none',
          opacity: open ? 1 : 0,
          pointerEvents: open ? 'auto' : 'none',
          transition: 'opacity 0.25s, backdrop-filter 0.25s',
          zIndex: 399,
        }}
      />

      <aside style={panelBase}>
        {/* Top bar */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '13px 20px', borderBottom: `1px solid ${LINE}`, flexShrink: 0,
        }}>
          <span style={{ fontSize: 9, letterSpacing: '0.2em', color: TXT_MUTED, fontFamily: FONT, textTransform: 'uppercase' }}>
            jkOS Suite{saving && <span style={{ color: ACCENT, marginLeft: 10 }}>· Saving</span>}
          </span>
          <button type="button" onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: TXT_FAINT, cursor: 'pointer', fontSize: 18, padding: '0 2px', lineHeight: 1, transition: 'color 0.12s', outline: 'none' }}
            onMouseEnter={e => (e.currentTarget.style.color = TXT)}
            onMouseLeave={e => (e.currentTarget.style.color = TXT_FAINT)}
          >×</button>
        </div>

        {/* Profile */}
        <section style={{ ...sect, display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{
            width: 38, height: 38, borderRadius: '50%', flexShrink: 0,
            background: 'linear-gradient(135deg, var(--hub-amber-dim), var(--hub-amber))',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: FONT, fontSize: 14, fontWeight: 700, color: CONTRAST,
            boxShadow: PRESS,
          }}>{inits}</div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, color: TXT, fontWeight: 600, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {user?.name || 'User'}
              {user?.role === 'guest' && (
                <span style={{ marginLeft: 8, fontSize: 8, letterSpacing: '0.1em', color: ACCENT, fontFamily: FONT }}>GUEST</span>
              )}
            </div>
            <div style={{ fontSize: 11, color: TXT_FAINT, marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontFamily: FONT }}>
              {user?.email}
            </div>
          </div>
        </section>

        {/* Appearance */}
        <section style={sect}>
          <SectionLabel>Appearance</SectionLabel>

          <div style={{ display: 'flex', gap: 3, marginBottom: 16 }}>
            {(['system', 'light', 'dark'] as Theme['mode'][]).map(m => (
              <button type="button" key={m} onClick={() => patchTheme({ mode: m })} style={{
                flex: 1, padding: '7px 0',
                background: theme.mode === m ? ACCENT : FIELD,
                border: `1px solid ${theme.mode === m ? ACCENT : LINE}`,
                color: theme.mode === m ? CONTRAST : TXT_MUTED,
                fontFamily: FONT, fontSize: 8, letterSpacing: '0.14em', textTransform: 'uppercase',
                cursor: 'pointer', transition: 'all 0.14s',
                boxShadow: theme.mode === m ? PRESS : 'none', outline: 'none',
              }}>
                {m === 'system' ? 'Auto' : m === 'light' ? 'Light' : 'Dark'}
              </button>
            ))}
          </div>

          <AccentChooser theme={theme} patchTheme={patchTheme} />
        </section>

        {/* Effects */}
        <section style={sect}>
          <SectionLabel>Effects</SectionLabel>
          <EffectRow label="Scan lines" value={effects.scanLines} onToggle={v => patchEffects({ scanLines: v })}>
            {effects.scanLines && <SliderInput value={effects.scanStrength} min={0} max={1} step={0.05} onChange={v => patchEffects({ scanStrength: v })} />}
          </EffectRow>
          <EffectRow label="Artifacts" value={effects.artifacts} onToggle={v => patchEffects({ artifacts: v })} />
        </section>

        {/* App-specific extras (e.g. ORDECK weather) */}
        {extra}

        {/* Account */}
        <section style={{ ...sect, borderBottom: 'none' }}>
          <SectionLabel>Account</SectionLabel>
          <div style={{ display: 'flex', gap: 8 }}>
            <a href={`${authUrl}/auth/dashboard`} target="_blank" rel="noopener noreferrer"
              style={{
                flex: 1, padding: '8px 12px', textAlign: 'center', textDecoration: 'none',
                border: `1px solid ${LINE}`, background: FIELD, color: TXT_MUTED,
                fontSize: 10, letterSpacing: '0.1em', fontFamily: FONT, transition: 'all 0.12s',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = FIELD_HI; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = FIELD; }}
            >Manage ↗</a>
            <button type="button" onClick={handleLogout}
              style={{
                flex: 1, padding: '8px 12px',
                border: '1px solid color-mix(in srgb, var(--hub-red) 35%, transparent)',
                background: 'transparent', color: 'color-mix(in srgb, var(--hub-red) 75%, var(--color-ink))',
                fontSize: 10, letterSpacing: '0.1em', cursor: 'pointer',
                fontFamily: FONT, transition: 'all 0.12s', outline: 'none',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.borderColor = 'var(--hub-red)';
                (e.currentTarget as HTMLElement).style.color = 'var(--hub-red)';
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.borderColor = 'color-mix(in srgb, var(--hub-red) 35%, transparent)';
                (e.currentTarget as HTMLElement).style.color = 'color-mix(in srgb, var(--hub-red) 75%, var(--color-ink))';
              }}
            >Sign out</button>
          </div>
        </section>
      </aside>
    </>
  );
}

/* ── Sub-components ────────────────────────────────────────────────────────── */

function SectionLabel({ children }: { children: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
      <span style={{ fontSize: 9, letterSpacing: '0.2em', color: TXT_FAINT, textTransform: 'uppercase', fontFamily: FONT, flexShrink: 0 }}>
        {children}
      </span>
      <span style={{ flex: 1, height: 1, background: LINE }} />
    </div>
  );
}

/** A weather/extra section wrapper apps can reuse so extras match the drawer. */
export function SettingsSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section style={sect}>
      <SectionLabel>{label}</SectionLabel>
      {children}
    </section>
  );
}

/**
 * The one suite-wide accent chooser: five slots — the four ACCENT_SCHEMES presets
 * plus a Custom slot. Picking a preset writes its pair; picking Custom reveals the
 * dual colour pickers seeded with the current pair. The active slot is derived from
 * the stored { primary, secondary } via matchAccentScheme(), so nothing extra is
 * persisted; `customOpen` just keeps the editor open while the user edits a pair
 * (and re-opens it when the stored pair isn't one of the presets).
 */
function AccentChooser({ theme, patchTheme }: { theme: Theme; patchTheme: (p: Partial<Theme>) => void }) {
  const matchedId = matchAccentScheme(theme.primary, theme.secondary);
  const [customOpen, setCustomOpen] = useState(matchedId === CUSTOM_SCHEME_ID);
  useEffect(() => { if (matchedId === CUSTOM_SCHEME_ID) setCustomOpen(true); }, [matchedId]);

  const activeId = customOpen ? CUSTOM_SCHEME_ID : matchedId;
  const activeLabel = activeId === CUSTOM_SCHEME_ID
    ? 'Custom'
    : (ACCENT_SCHEMES.find(s => s.id === activeId)?.label ?? '');

  const dot = (c: string): CSSProperties => ({
    width: 9, height: 9, borderRadius: '50%', background: c,
    boxShadow: `0 0 4px ${withAlpha(c, 0.533)}`, display: 'inline-block', flexShrink: 0,
  });
  const tile = (active: boolean): CSSProperties => ({
    flex: 1, minWidth: 0, height: 30,
    background: active ? FIELD_HI : FIELD,
    border: `1px solid ${active ? ACCENT : LINE}`,
    boxShadow: active ? PRESS : 'none',
    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
    transition: 'all 0.12s', outline: 'none',
  });

  return (
    <>
      <div style={{ fontSize: 8, letterSpacing: '0.16em', color: TXT_FAINT, fontFamily: FONT, marginBottom: 8, textTransform: 'uppercase' }}>
        Accent — {activeLabel}
      </div>
      <div style={{ display: 'flex', gap: 4, marginBottom: customOpen ? 14 : 0 }}>
        {ACCENT_SCHEMES.map(s => (
          <button type="button" key={s.id} title={s.label}
            onClick={() => { setCustomOpen(false); patchTheme({ primary: s.primary, secondary: s.secondary }); }}
            style={tile(activeId === s.id)}>
            <span style={dot(s.primary)} />
            <span style={dot(s.secondary)} />
          </button>
        ))}
        {/* Fifth slot — the user's own pair; reflects the live custom colours. */}
        <button type="button" title="Custom — pick your own pair"
          onClick={() => setCustomOpen(true)}
          style={{ ...tile(activeId === CUSTOM_SCHEME_ID), position: 'relative' }}>
          <span style={dot(theme.primary)} />
          <span style={dot(theme.secondary)} />
          <span style={{ position: 'absolute', top: 1, right: 3, fontSize: 8, lineHeight: 1, fontFamily: FONT, color: activeId === CUSTOM_SCHEME_ID ? ACCENT : TXT_FAINT }}>✎</span>
        </button>
      </div>

      {/* Both accents are co-equal, user-pickable, always in use. hub.css deepens
          the pair on paper for legibility and shows it raw + glow in dark. */}
      {customOpen && (
        <>
          <ColorRow label="Primary"   color={theme.primary}   onChange={c => patchTheme({ primary: c })} />
          <ColorRow label="Secondary" color={theme.secondary} onChange={c => patchTheme({ secondary: c })} />
        </>
      )}
    </>
  );
}

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
      <span style={{ fontSize: 10, color: TXT_FAINT, width: 62, flexShrink: 0, fontFamily: FONT, letterSpacing: '0.06em' }}>{label}</span>
      <button type="button" onClick={() => ref.current?.click()}
        style={{ width: 30, height: 30, flexShrink: 0, background: color, border: `2px solid ${LINE}`, cursor: 'pointer', boxShadow: `0 0 10px ${withAlpha(color, 0.333)}`, outline: 'none', transition: 'box-shadow 0.15s' }} />
      <Field bare ref={ref} type="color" value={color} onChange={e => onChange(e.target.value)} style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: 0, height: 0 }} />
      <Field type="text" value={draft} onChange={e => handleText(e.target.value)}
        onBlur={() => { if (!/^#[0-9a-fA-F]{6}$/.test(draft)) setDraft(color); }} maxLength={7} spellCheck={false}
        style={{ flex: 1, color: /^#[0-9a-fA-F]{6}$/.test(draft) ? undefined : 'var(--hub-red)', padding: '5px 10px', fontSize: 11, letterSpacing: '0.08em' }} />
    </div>
  );
}

function EffectRow({ label, value, onToggle, children }: { label: string; value: boolean; onToggle: (v: boolean) => void; children?: ReactNode }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: children ? 7 : 0 }}>
        <span style={{ fontSize: 11, color: value ? TXT : TXT_FAINT, fontFamily: FONT, letterSpacing: '0.04em' }}>{label}</span>
        <Toggle value={value} onChange={onToggle} />
      </div>
      {children}
    </div>
  );
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!value)} aria-pressed={value}
      style={{ width: 36, height: 20, position: 'relative', cursor: 'pointer', flexShrink: 0, background: value ? ACCENT : LINE, border: `1px solid ${value ? ACCENT : LINE}`, borderRadius: 10, padding: 0, transition: 'all 0.18s', outline: 'none' }}>
      <span style={{ position: 'absolute', top: 2, left: value ? 16 : 2, width: 14, height: 14, background: value ? CONTRAST : TXT_MUTED, borderRadius: '50%', transition: 'left 0.18s cubic-bezier(0.4, 0.2, 0.2, 1)' }} />
    </button>
  );
}

function SliderInput({ value, min, max, step, onChange }: { value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingLeft: 10, marginTop: 2 }}>
      <Slider min={min} max={max} step={step} value={value} onChange={onChange} style={{ flex: 1 }} />
      <span style={{ fontSize: 10, color: TXT_MUTED, width: 30, textAlign: 'right', fontFamily: FONT, flexShrink: 0 }}>{Math.round(value * 100)}%</span>
    </div>
  );
}
