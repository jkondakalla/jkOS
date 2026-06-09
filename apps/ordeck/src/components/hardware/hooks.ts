import { useState, useEffect, useCallback } from 'react';

export type OsMode = 'paper' | 'dark';

export function isDark(): boolean {
  return document.documentElement.getAttribute('data-mode') === 'dark';
}

export function useMode(): OsMode {
  const read = useCallback(
    (): OsMode => (document.documentElement.getAttribute('data-mode') === 'dark' ? 'dark' : 'paper'),
    [],
  );
  const [mode, setMode] = useState<OsMode>(read);

  useEffect(() => {
    const observer = new MutationObserver(() => setMode(read()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-mode'] });

    const handler = () => setMode(read());
    window.addEventListener('ordeck-mode', handler);

    return () => {
      observer.disconnect();
      window.removeEventListener('ordeck-mode', handler);
    };
  }, [read]);

  return mode;
}

export function useTick(ms = 1000): number {
  const [t, setT] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => setT(x => x + 1), ms);
    return () => clearInterval(iv);
  }, [ms]);
  return t;
}

export function useWaveform(length = 60, ms = 200): number[] {
  const [data, setData] = useState<number[]>(() =>
    Array.from({ length }, () => Math.random() * 0.5 + 0.25)
  );
  useEffect(() => {
    const iv = setInterval(() => {
      setData(d => [
        ...d.slice(1),
        Math.max(0.05, Math.min(0.95, d[d.length - 1] + (Math.random() - 0.5) * 0.4)),
      ]);
    }, ms);
    return () => clearInterval(iv);
  }, [ms, length]);
  return data;
}
