import { useCallback, useEffect, useState } from 'react';
import { getProfile, patchProfile } from './client';
import type { HudFocus, HudPin, HudRefInput } from './types';

/**
 * Read + mutate the ORDECK "HUD shelf" — the user's pins (a heterogeneous,
 * suite-wide collection) and focus (a suite-wide singleton). Both live in jkAuth
 * prefs, so ANY app can surface its own items on the HUD by {app,id} with no
 * ORDECK-specific columns or endpoints: drop this hook into a detail view and
 * wire two buttons.
 *
 * Optimistic — local state updates first, then PATCH. Refetches when the tab
 * regains focus so a change made elsewhere shows without a reload.
 */
export function useHudShelf() {
  const [pins, setPins] = useState<HudPin[]>([]);
  const [focus, setFocus] = useState<HudFocus | null>(null);

  useEffect(() => {
    let dead = false;
    const load = () => getProfile()
      .then((p) => {
        if (dead || !p) return;
        setPins(p.preferences.hudPins ?? []);
        setFocus(p.preferences.hudFocus ?? null);
      })
      .catch(() => {});
    load();
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { dead = true; document.removeEventListener('visibilitychange', onVisible); };
  }, []);

  const key = (app: string, id: string | number) => `${app}:${id}`;
  const norm = (ref: HudRefInput) => ({ ...ref, id: String(ref.id) });

  const isPinned = useCallback(
    (app: string, id: string | number) => pins.some((p) => key(p.app, p.id) === key(app, id)),
    [pins],
  );
  const togglePin = useCallback(async (ref: HudRefInput) => {
    const r = norm(ref);
    const next = isPinned(r.app, r.id)
      ? pins.filter((p) => key(p.app, p.id) !== key(r.app, r.id))
      : [...pins, { ...r, ts: Date.now() }];
    setPins(next);
    await patchProfile({ hudPins: next });
  }, [pins, isPinned]);

  const isFocused = useCallback(
    (app: string, id: string | number) => !!focus && key(focus.app, focus.id) === key(app, id),
    [focus],
  );
  const toggleFocus = useCallback(async (ref: HudRefInput) => {
    const r = norm(ref);
    const next: HudFocus | null = isFocused(r.app, r.id) ? null : r;
    setFocus(next);
    await patchProfile({ hudFocus: next });
  }, [focus, isFocused]);

  const clearFocus = useCallback(async () => {
    setFocus(null);
    await patchProfile({ hudFocus: null });
  }, []);

  return { pins, focus, isPinned, togglePin, isFocused, toggleFocus, clearFocus };
}
