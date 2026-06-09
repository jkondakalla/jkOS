import { useEffect, useState, useCallback } from 'react';
import { WidgetManifest } from '@jkos/types';

export default function usePlugins(pollMs = 10000) {
  const [plugins, setPlugins] = useState<WidgetManifest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPlugins = useCallback(async () => {
    try {
      const res = await fetch('/api/plugins');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: WidgetManifest[] = await res.json();
      setPlugins(data);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPlugins();
    const iv = setInterval(fetchPlugins, pollMs);
    return () => clearInterval(iv);
  }, [fetchPlugins, pollMs]);

  return { plugins, loading, error, refetch: fetchPlugins };
}
