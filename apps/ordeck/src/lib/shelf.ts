/**
 * lib/shelf.ts — ORDECK-side writes to the suite-wide HUD shelf (jkAuth prefs).
 *
 * Pinning/focusing happens in the SOURCE app (e.g. BeigeBoard's detail panel via
 * the shared useHudShelf hook). ORDECK only needs to clear focus from its own
 * Focus card, so that one mutation lives here — it patches the same prefs the
 * source apps write and invalidates the shelf so useShelfRefs refetches at once.
 */

import { patchProfile } from '@jkos/auth-client';
import { invalidate } from '@jkos/weave';

/** Clear the suite-wide HUD focus (the "END FOCUS" action on the Focus card). */
export async function clearHudFocus(): Promise<void> {
  try {
    await patchProfile({ hudFocus: null });
  } finally {
    invalidate('hud.shelf');
  }
}
