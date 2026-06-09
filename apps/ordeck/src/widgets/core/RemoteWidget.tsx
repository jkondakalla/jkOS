import { lazy, Suspense } from 'react';
import ErrorBoundary from '../../components/ErrorBoundary';

const REMOTE_LOADERS: Record<string, () => Promise<{ default: React.ComponentType }>> = {
  plex:       () => import('plex-plugin/Widget'),
  lazuros:    () => import('lazuros-plugin/Widget'),
  beigeboard: () => import('beigeboard-plugin/Widget'),
  recipe:     () => import('recipe-plugin/Widget'),
};

const REMOTE_CACHE: Record<string, React.ComponentType> = {};

interface RemoteWidgetProps {
  type: string;
}

function LoadingState() {
  return (
    <div style={{
      height: '100%',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      gap: 8,
    }}>
      <div style={{
        fontSize: 10, letterSpacing: '0.2em',
        color: 'var(--hub-amber)',
        animation: 'led-pulse 1s ease-in-out infinite',
      }}>
        CONNECTING...
      </div>
    </div>
  );
}

export default function RemoteWidget({ type }: RemoteWidgetProps) {
  const loader = REMOTE_LOADERS[type];

  if (!loader) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ color: 'var(--hub-cream-dim)', fontSize: 10, letterSpacing: '0.15em' }}>
          UNKNOWN MODULE: {type.toUpperCase()}
        </span>
      </div>
    );
  }

  if (!REMOTE_CACHE[type]) {
    REMOTE_CACHE[type] = lazy(loader);
  }

  const Remote = REMOTE_CACHE[type];

  return (
    <ErrorBoundary widgetName={type}>
      <Suspense fallback={<LoadingState />}>
        <Remote />
      </Suspense>
    </ErrorBoundary>
  );
}
