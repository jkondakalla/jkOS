/**
 * weave/dispatch.ts — run a declared command.
 *
 * The single write path: given an app (from the manifest) and one of its declared
 * capabilities plus an already-resolved body, issue the edge-proxied request
 * (cookies flow) and, on success, invalidate the resource keys the capability
 * declares so every polled view reconciles from the owning app. The owning app
 * stays the single source of truth — the portal never stores its data.
 *
 * Body bindings (form fields, literals, live slices) are resolved by the widget
 * engine BEFORE this is called, so the fabric stays free of widget-engine types.
 */

import { authFetch } from '@jkos/auth-client';
import { invalidate } from './resource';
import type { SuiteApp } from './manifest';
import type { CapabilityDef } from './capability';

export interface CommandResult {
  ok: boolean;
  status: number;       // 0 on a network error
  data?: unknown;
  error?: string;
}

export async function runCommand(
  app: SuiteApp,
  cap: CapabilityDef,
  body: Record<string, unknown>,
): Promise<CommandResult> {
  const base = app.apiBase ?? '';
  // Substitute :params from the body (e.g. /items/:id), leaving the rest as JSON.
  const path = cap.path.replace(/:(\w+)/g, (_, k) => encodeURIComponent(String(body[k] ?? '')));
  const isWrite = cap.method !== 'DELETE';
  try {
    // authFetch silently refreshes an expired access token + retries, so a write
    // issued just past the 15-min mark commits instead of failing as a 401.
    const r = await authFetch(`${base}${path}`, {
      method: cap.method,
      headers: isWrite ? { 'Content-Type': 'application/json' } : undefined,
      body: isWrite ? JSON.stringify(body) : undefined,
    });
    let data: unknown = null;
    try { data = await r.json(); } catch { /* empty / non-JSON body is fine */ }
    if (r.ok) invalidate(...(cap.invalidates ?? []));
    return {
      ok: r.ok,
      status: r.status,
      data: r.ok ? data : undefined,
      error: r.ok ? undefined : ((data as { error?: string })?.error || `HTTP ${r.status}`),
    };
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error ? e.message : String(e) };
  }
}
