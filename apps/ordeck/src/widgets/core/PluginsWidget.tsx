import { useState, ReactNode } from 'react';
import { WidgetManifest } from '@jkos/types';
import usePlugins from '../../hooks/usePlugins';

const ICONS: Record<string, string> = {
  grid: '◈', terminal: '⎔', chart: '▣', cloud: '◉',
  code: '⌬', auto: '⬡', monitor: '◐', default: '✦',
};

export default function PluginsWidget() {
  const { plugins, loading, error } = usePlugins(15000);
  const [active, setActive] = useState<string | null>(null);

  if (loading) return <StatusMsg>SCANNING PLUGIN REGISTRY...</StatusMsg>;
  if (error) return <StatusMsg warn>REGISTRY UNREACHABLE — {error.toUpperCase()}</StatusMsg>;
  if (plugins.length === 0) return <StatusMsg>NO PLUGINS INSTALLED — ADD A FOLDER TO /plugins</StatusMsg>;

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))',
      gap: 8,
      alignContent: 'start',
    }}>
      {plugins.map((p: WidgetManifest) => (
        <Tile
          key={p.id}
          plugin={p}
          isActive={active === p.id}
          onTap={() => {
            setActive(p.id);
            if (p.launch?.target) window.open(p.launch.target, '_blank');
          }}
        />
      ))}
    </div>
  );
}

function Tile({ plugin, isActive, onTap }: { plugin: WidgetManifest; isActive: boolean; onTap: () => void }) {
  const icon = ICONS[plugin.icon ?? ''] ?? ICONS.default;
  const color = plugin.color || 'var(--hub-amber)';

  return (
    <button
      onClick={onTap}
      style={{
        aspectRatio: '1',
        background: isActive ? 'var(--hub-bg-3)' : 'var(--hub-bg-2)',
        border: `1px solid ${isActive ? color : 'var(--hub-line)'}`,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        gap: 4, padding: 6,
        transition: 'all 0.12s ease',
        cursor: 'pointer',
        WebkitTapHighlightColor: 'transparent',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = color;
        e.currentTarget.style.background = 'var(--hub-bg-3)';
      }}
      onMouseLeave={e => {
        if (!isActive) {
          e.currentTarget.style.borderColor = 'var(--hub-line)';
          e.currentTarget.style.background = 'var(--hub-bg-2)';
        }
      }}
    >
      <div style={{
        width: 28, height: 28,
        color, fontSize: 18,
        display: 'grid', placeItems: 'center',
        border: `1px solid ${color}44`,
        textShadow: `0 0 8px ${color}66`,
      }}>
        {icon}
      </div>
      <div style={{
        fontSize: 8, letterSpacing: '0.08em',
        color: 'var(--hub-cream)', textAlign: 'center',
        lineHeight: 1.2,
        overflow: 'hidden', textOverflow: 'ellipsis',
        whiteSpace: 'nowrap', maxWidth: '100%',
      }}>
        {plugin.name.toUpperCase()}
      </div>
    </button>
  );
}

function StatusMsg({ children, warn }: { children: ReactNode; warn?: boolean }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: '100%', padding: 12, textAlign: 'center',
      fontSize: 10, letterSpacing: '0.1em',
      color: warn ? 'var(--hub-red)' : 'var(--hub-cream-dim)',
    }}>
      {children}
    </div>
  );
}
