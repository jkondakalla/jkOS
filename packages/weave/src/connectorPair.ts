/**
 * weave/connectorPair.ts — the frontend binding for "a generic UI driven by a
 * connector + capability pair" (git history: Wave 20 item 20.4).
 *
 * A `defineConnector` read (search candidates) declares a clean Layer-A dataset
 * exactly like a native app's `defineCollection` read does; a write capability
 * (apply one candidate) is a plain CapabilityDef — so ANY peer's connector-backed
 * search+apply flow is already reachable the same way every other cross-app read/
 * write is: `weaveClient(appId).list(readName, filters)` +
 * `weaveClient(appId).command(capabilityName, body)`. `connectorPair` is the thin
 * helper that packages that pair into the `{search, apply}` shape @jkos/ui's
 * <MatchPanel> (packages/ui/src/MatchPanel.tsx) is fed, so a cross-app consumer
 * wires one line instead of hand-rolling both calls.
 *
 * Deliberately NOT in @jkos/ui: it imports weaveClient (discovery + edge-proxied
 * fetch + the invalidation bus), and @jkos/ui stays transport-agnostic — the same
 * decoupling rule <AppShell> established at 20.1 (a UI package never imports
 * @jkos/weave or @jkos/auth-client).
 *
 * PapyrOS's OWN "Fix metadata" binding (apps/papyros/src/views/book-detail/
 * MatchPanel.tsx) does NOT route through this: its searchMetadata/matchBook calls
 * are same-app direct fetches that THROW on a non-2xx response (apiJson), which is
 * what lets that panel tell "search failed" apart from "no results" — swapping to
 * weaveClient.list's silent-[]-on-any-miss contract would change that behavior.
 * `connectorPair` is for a genuinely cross-app consumer (e.g. a future peer
 * binding to another app's connector from outside it).
 */
import { weaveClient } from './weaveClient';
import type { AppId } from './manifest';
import type { CommandResult } from './dispatch';

export interface ConnectorPairOptions<C = Record<string, unknown>> {
  /** Name of the read's search filter (defaults to 'term' — the convention every
   *  connector read in the suite uses today, e.g. papyros's META.metadataSearch). */
  termParam?: string;
  /** Builds the capability's request body from the chosen candidate row. Defaults
   *  to `{ candidate }` — a write capability fed the whole connector-read row
   *  under that one key (the `matchBook` precedent, apps/papyros/backend/
   *  discovery.js). Override to merge in extra context the capability's body
   *  also needs (e.g. which record the candidate applies to). */
  buildBody?: (candidate: C) => Record<string, unknown>;
}

/**
 * Binds one peer's declared read (`readName` — a dataset, including a
 * connector's cleaned `ConnectorRead`) + one declared write capability
 * (`capabilityName`) into the `{search, apply}` pair a generic match/pick UI is
 * fed.
 *
 * `search` resolves the read's rows (or `[]` on any discovery/network miss — the
 * documented `weaveClient.list` behaviour). `apply` resolves with the
 * capability's returned `data` on success and THROWS on failure (`!result.ok`),
 * matching the contract a direct fetch-based `apply` already has (e.g. papyros's
 * own `matchBook`) — so a `<MatchPanel>` fed either implementation behaves the
 * same.
 */
export function connectorPair<C extends Record<string, unknown> = Record<string, unknown>>(
  appId: AppId,
  readName: string,
  capabilityName: string,
  opts?: ConnectorPairOptions<C>,
): { search: (term: string) => Promise<C[]>; apply: (candidate: C) => Promise<unknown> } {
  const termParam = opts?.termParam ?? 'term';
  const buildBody = opts?.buildBody ?? ((candidate: C) => ({ candidate }));
  const client = weaveClient(appId);
  return {
    search: (term: string) => client.list<C>(readName, { [termParam]: term }),
    apply: async (candidate: C) => {
      const result: CommandResult = await client.command(capabilityName, buildBody(candidate));
      if (!result.ok) throw new Error(result.error || `weave: ${appId}.${capabilityName} failed`);
      return result.data;
    },
  };
}
