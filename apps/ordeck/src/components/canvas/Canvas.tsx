import { ComponentType, CSSProperties } from 'react';
import { WidgetInstance } from '@jkos/types';
import Widget from './Widget';
import { WidgetMeta } from './WidgetHeaders';
import RemoteWidget from '../../widgets/core/RemoteWidget';
import { Grille, DymoTape } from '../hardware';

export interface CanvasRegistryEntry extends WidgetMeta {
  component: ComponentType<{ widgetId: number }> | null;
  remote?: boolean;
  w: number;
  h: number;
}

interface CanvasProps {
  widgets: WidgetInstance[];
  registry: Record<string, CanvasRegistryEntry>;
  onUpdateWidget: (id: number, patch: Partial<WidgetInstance>) => void;
  onCloseWidget: (id: number) => void;
  onFocusWidget?: (id: number) => void;
  onContextWidget?: (id: number, x: number, y: number) => void;
}

export default function Canvas({
  widgets,
  registry,
  onUpdateWidget,
  onCloseWidget,
  onFocusWidget,
  onContextWidget,
}: CanvasProps) {
  return (
    <main style={{
      flex: 1,
      position: 'relative',
      overflow: 'hidden',
      backgroundColor: 'var(--hub-bg-0)',
      backgroundImage: `
        linear-gradient(rgba(255,176,0,calc(0.03 * var(--canvas-grid-opacity, 1))) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255,176,0,calc(0.03 * var(--canvas-grid-opacity, 1))) 1px, transparent 1px)
      `,
      backgroundSize: '40px 40px',
    }}>
      <CanvasMarks />

      {widgets.length === 0 && <EmptyState />}

      {widgets.map(w => {
        const entry = registry[w.type];
        if (!entry) return null;
        return (
          <Widget
            key={w.id}
            data={w}
            meta={entry}
            onUpdate={patch => onUpdateWidget(w.id, patch)}
            onClose={() => onCloseWidget(w.id)}
            onFocus={() => onFocusWidget?.(w.id)}
            onContext={(x, y) => onContextWidget?.(w.id, x, y)}
          >
            {entry.remote
              ? <RemoteWidget type={w.type} />
              : entry.component && <entry.component widgetId={w.id} />
            }
          </Widget>
        );
      })}
    </main>
  );
}

// ─── Corner marks ─────────────────────────────────────────────────────────────

function CanvasMarks() {
  const corner = (style: CSSProperties) => (
    <div style={{
      position: 'absolute', width: 14, height: 14,
      borderColor: 'var(--hub-amber-dim)', borderStyle: 'solid',
      ...style,
    }} />
  );
  return (
    <div style={{ position: 'absolute', inset: 8, pointerEvents: 'none', zIndex: 1 }}>
      {corner({ top: 0, left: 0, borderWidth: '1.5px 0 0 1.5px' })}
      {corner({ top: 0, right: 0, borderWidth: '1.5px 1.5px 0 0' })}
      {corner({ bottom: 0, left: 0, borderWidth: '0 0 1.5px 1.5px' })}
      {corner({ bottom: 0, right: 0, borderWidth: '0 1.5px 1.5px 0' })}
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div style={{
      position: 'absolute', inset: 0,
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      gap: 16, pointerEvents: 'none',
    }}>
      <Grille cols={14} rows={8} dotSize={3} gap={4} style={{ opacity: 0.4 }} />
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
        <DymoTape style={{ fontSize: 10, letterSpacing: '0.3em' }}>NO MODULES LOADED</DymoTape>
        <span style={{ fontSize: 9, color: 'var(--hub-cream-faint)', letterSpacing: '0.22em' }}>
          SELECT A MODULE FROM THE RACK
        </span>
      </div>
    </div>
  );
}
