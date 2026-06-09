import { useState } from 'react';
import { WidgetType } from '@jkos/types';
import { Led } from './hardware';

export interface PaletteEntry {
  type: WidgetType;
  label: string;
  subtitle?: string;
  code: string;
  glyph: string;
  color: string;
  led?: 'amber' | 'cyan' | 'green' | 'red';
  tool?: boolean;
  deco?: boolean;
  remote?: boolean;
}

export interface ActiveSession {
  id: number;
  label: string;
}

interface Props {
  registry?: PaletteEntry[];
  sessions?: ActiveSession[];
  active: boolean;
  onAdd: (type: WidgetType) => void;
  onClose: () => void;
  onResetLayout: () => void;
  onClearAll: () => void;
}

export default function WidgetPalette({
  registry = [],
  sessions = [],
  active,
  onAdd,
  onClose,
  onResetLayout,
  onClearAll,
}: Props) {
  const core    = registry.filter(d => !d.remote && !d.tool && !d.deco);
  const tools   = registry.filter(d => d.tool);
  const deco    = registry.filter(d => d.deco);
  const remotes = registry.filter(d => d.remote);

  return (
    <>
      {/* Backdrop — click to close */}
      <div
        onClick={active ? onClose : undefined}
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,0.55)',
          zIndex: 199,
          opacity: active ? 1 : 0,
          pointerEvents: active ? 'auto' : 'none',
          transition: 'opacity 0.22s',
        }}
      />

      {/* Drawer */}
      <aside
        aria-hidden={!active}
        style={{
          position: 'fixed',
          top: 'var(--hub-header-h)',
          left: 0,
          bottom: 'var(--hub-footer-h)',
          width: 'var(--hub-sidebar-w)',
          background: 'linear-gradient(90deg, var(--hub-bg-2) 0%, var(--hub-bg-1) 100%)',
          borderRight: '1px solid var(--hub-line)',
          overflowY: 'hidden',
          overflowX: 'hidden',
          flexShrink: 0,
          zIndex: 200,
          display: 'flex', flexDirection: 'column',
          transform: active ? 'translateX(0)' : 'translateX(-100%)',
          transition: 'transform 0.22s cubic-bezier(0.4, 0.2, 0.2, 1)',
        }}
      >
        {/* Drawer header rail */}
        <div style={{
          height: 36, flexShrink: 0,
          display: 'flex', alignItems: 'center',
          padding: '0 12px', gap: 8,
          borderBottom: '1px solid var(--hub-line)',
        }}>
          <Led color="amber" size="sm" />
          <span style={{
            fontSize: 8, letterSpacing: '0.22em',
            color: 'var(--hub-amber)', flex: 1,
            fontFamily: 'var(--hub-font-mono)',
          }}>
            MODULE PALETTE
          </span>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--hub-cream-faint)', fontSize: 16, lineHeight: 1,
              padding: '0 4px', fontFamily: 'var(--hub-font-mono)',
              transition: 'color 0.12s',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--hub-amber)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--hub-cream-faint)'; }}
          >×</button>
        </div>

        {/* Scrollable content */}
        <div style={{ padding: '12px 0 60px', flex: 1, overflowY: 'auto' }}>
          {core.length > 0 && (
            <Section title="CORE">
              {core.map(def => (
                <ModuleSlot key={def.type} def={def} onAdd={() => { onAdd(def.type); onClose(); }} />
              ))}
            </Section>
          )}
          {tools.length > 0 && (
            <Section title="TOOLS">
              {tools.map(def => (
                <ModuleSlot key={def.type} def={def} onAdd={() => { onAdd(def.type); onClose(); }} />
              ))}
            </Section>
          )}
          {deco.length > 0 && (
            <Section title="DECO">
              {deco.map(def => (
                <ModuleSlot key={def.type} def={def} onAdd={() => { onAdd(def.type); onClose(); }} />
              ))}
            </Section>
          )}
          {remotes.length > 0 && (
            <Section title="REMOTE">
              {remotes.map(def => (
                <ModuleSlot key={def.type} def={def} onAdd={() => { onAdd(def.type); onClose(); }} remote />
              ))}
            </Section>
          )}

          <Section title={`ACTIVE (${sessions.length})`}>
            {sessions.length === 0 ? (
              <div style={{ fontSize: 9, color: 'var(--hub-cream-faint)', padding: '6px 4px', letterSpacing: '0.15em' }}>
                SURFACE CLEAR
              </div>
            ) : sessions.map(s => (
              <div key={s.id} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '5px 8px', marginBottom: 3,
                background: 'var(--hub-bg-2)', border: '1px solid var(--hub-line)',
                fontSize: 9, letterSpacing: '0.05em',
              }}>
                <Led color="green" size="sm" />
                <span style={{ flex: 1, color: 'var(--hub-cream)' }}>{s.label}</span>
                <span style={{ color: 'var(--hub-cream-faint)', fontSize: 7 }}>#{String(s.id).padStart(3, '0')}</span>
              </div>
            ))}
          </Section>

          <div style={{ padding: '0 12px', display: 'flex', gap: 6 }}>
            <SystemButton onClick={onResetLayout} label="RESET" />
            <SystemButton onClick={onClearAll} label="CLEAR" />
          </div>
        </div>
      </aside>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: '0 12px 12px', borderBottom: '1px dashed var(--hub-line)', marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <span style={{ fontSize: 8, color: 'var(--hub-amber)', letterSpacing: '0.22em' }} className="glow-dim">▸ {title}</span>
        <span style={{ flex: 1, height: 1, background: 'var(--hub-line)' }} />
      </div>
      {children}
    </div>
  );
}

function ModuleSlot({ def, onAdd, remote }: { def: PaletteEntry; onAdd: () => void; remote?: boolean }) {
  const [hover, setHover] = useState(false);
  const ledColor = def.led ?? (remote ? 'amber' : 'green');
  return (
    <button
      onClick={onAdd}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: '100%',
        background: hover ? 'var(--hub-bg-3)' : 'var(--hub-bg-2)',
        border: `1px solid ${hover ? 'var(--hub-amber-dim)' : 'var(--hub-line)'}`,
        color: hover ? 'var(--hub-amber)' : 'var(--hub-cream)',
        padding: '7px 8px', marginBottom: 4,
        fontFamily: 'var(--hub-font-mono)',
        fontSize: 10, letterSpacing: '0.08em', textAlign: 'left',
        display: 'grid', gridTemplateColumns: '18px 1fr auto', gap: 7, alignItems: 'center',
        transition: 'all 0.12s', cursor: 'pointer',
      }}
    >
      <span style={{ fontSize: 13, color: hover ? def.color : `${def.color}aa`, textShadow: hover ? `0 0 6px ${def.color}` : 'none', textAlign: 'center' }}>{def.glyph}</span>
      <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}>
        <span style={{ fontWeight: 500 }}>{def.label}</span>
        {def.subtitle && (
          <span style={{ fontSize: 7.5, color: hover ? 'var(--hub-amber-dim)' : 'var(--hub-cream-faint)', letterSpacing: '0.15em' }}>
            {def.subtitle}
          </span>
        )}
      </span>
      <Led color={ledColor} size="sm" steady={!remote} />
    </button>
  );
}

function SystemButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1, padding: '6px 8px',
        background: 'var(--hub-bg-0)', border: '1px solid var(--hub-line)',
        color: 'var(--hub-cream-dim)',
        fontFamily: 'var(--hub-font-mono)', fontSize: 8, letterSpacing: '0.18em',
        cursor: 'pointer', transition: 'all 0.12s',
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLElement).style.borderColor = 'var(--hub-red-dim)';
        (e.currentTarget as HTMLElement).style.color = 'var(--hub-red)';
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLElement).style.borderColor = 'var(--hub-line)';
        (e.currentTarget as HTMLElement).style.color = 'var(--hub-cream-dim)';
      }}
    >{label}</button>
  );
}
