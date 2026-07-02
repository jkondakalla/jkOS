/**
 * weave/fetchCapabilities.ts — discover what an app can DO.
 *
 * Fetches an app's CapabilityDoc from its manifest `capabilitiesPath` (the
 * edge-proxied, same-origin GET so cookies flow), cached per app id. The portal's
 * workshop lists these to build write widgets; the renderer resolves a command's
 * capability before rendering its form/button.
 */

import { suiteApp, type AppId } from './manifest';
import type { CapabilityDoc, CapabilityDef } from './capability';
import { isValidDoc } from './shared/docShape.js';

const cache = new Map<string, Promise<CapabilityDoc | null>>();

/** The app's CapabilityDoc, or null if it declares none / is unreachable. Cached;
 *  pass force to re-fetch (e.g. the workshop's refresh). */
export function fetchCapabilities(appId: AppId, force = false): Promise<CapabilityDoc | null> {
  if (!force && cache.has(appId)) return cache.get(appId)!;
  const p = (async (): Promise<CapabilityDoc | null> => {
    const path = suiteApp(appId)?.capabilitiesPath;
    if (!path) return null;
    try {
      const r = await fetch(path, { credentials: 'include' });
      if (!r.ok) return null;
      const doc = (await r.json()) as CapabilityDoc;
      // Validate the PEER's doc with the same rule the producer is held to at boot
      // (shared/docShape), not just "has an array" — a malformed peer disables
      // itself here instead of breaking the workshop/renderer downstream.
      return isValidDoc(doc, 'capabilities') ? doc : null;
    } catch {
      return null;
    }
  })();
  cache.set(appId, p);
  // Don't let a transient failure (app briefly down, network blip) poison the
  // cache: evict once it settles to null so the NEXT caller retries instead of
  // being stuck "unavailable" until a full reload. Concurrent callers still share
  // the one in-flight promise; only a successful doc stays cached. The identity
  // guard avoids clobbering a newer force-refetch.
  void p.then((doc) => { if (!doc && cache.get(appId) === p) cache.delete(appId); });
  return p;
}

/** Find one capability by id within a doc. */
export function getCapability(doc: CapabilityDoc | null, id: string): CapabilityDef | null {
  return doc?.capabilities.find((c) => c.id === id) ?? null;
}
