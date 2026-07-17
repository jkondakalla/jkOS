/**
 * weave/connector.ts — the CONNECTOR primitive (Layer D / F2 + G2).
 *
 * The second new brick: wrap an EXTERNAL API or device as a first-class suite peer.
 * Today every integration (Google / Outlook / iCloud / LazurOS) is bespoke backend
 * code, and a non-technical user can connect nothing. A ConnectorDef declares — as
 * pure data — an upstream base URL, how to authenticate to it, and a mapping from its
 * endpoints to the SAME capability/dataset contract a native app serves. Then
 * `defineConnector` produces (a) clean Layer-A discovery docs, so the connected thing
 * is discoverable/bindable EXACTLY like a native app — a GUI/AI can't tell the
 * difference, which is the whole lego property — and (b) a router that translates
 * each call into the upstream request server-side, keeping the upstream secret off
 * the browser. "Connect third-party software and devices" becomes a spec, not a fork.
 *
 * Design-time shapes (the twin of capability.ts / dataset.ts); the runtime factory
 * lives in ./server/connector.js (subpath `@jkos/weave/connector`). Reuses BodyField /
 * FilterField so a connector field shares the suite's one field vocabulary, and the
 * `ref` FieldType (F4) lets a connector row be a typed stud another lego snaps onto.
 */

import type { BodyField } from './capability';
import type { CapabilityDef } from './capability';
import type { FilterField, DatasetDef } from './dataset';

/** How the connector authenticates to the UPSTREAM (resolved server-side, never sent
 *  to the browser). The secret is read from `env` (or an explicit override at mount). */
export interface ConnectorAuth {
  kind: 'none' | 'bearer' | 'header' | 'query';
  env?: string;            // env var holding the token/key
  header?: string;         // when kind==='header': the header name, e.g. 'X-API-Key'
  param?: string;          // when kind==='query': the query-param name, e.g. 'apikey'
}

/** One upstream read → a suite DatasetDef. */
export interface ConnectorRead {
  id: string;              // dataset id + local path segment, e.g. 'events'
  label: string;
  upstream: { path: string; method?: 'GET'; query?: Record<string, string> };
  collection?: string;     // dotted path to the array in the upstream JSON (default: the body)
  item: BodyField[];       // the declared row shape consumers see (typed; may carry `ref`)
  map?: Record<string, string>;   // wireField → dotted upstream path (omitted fields map by name)
  filters?: FilterField[]; // params passed through to the upstream query (by name)
  scopes?: string[];
}

/** One upstream write → a suite CapabilityDef. */
export interface ConnectorAction {
  id: string;              // capability id, e.g. 'createEvent'
  label: string;
  method: 'POST' | 'PATCH' | 'DELETE';
  path?: string;           // local path RELATIVE to the connector apiBase (default '/'+id)
  upstream: { path: string; method?: string };   // may contain :params from the body
  body?: BodyField[];
  returns?: BodyField[];
  map?: Record<string, string>;   // wireField → upstream body key (omitted fields map by name)
  invalidates?: string[];
  scopes?: string[];
}

/** A connected external API/device, declared as data. */
export interface ConnectorDef {
  app: string;             // owning suite app id (namespaces scope + resource keys)
  id: string;              // connector id
  label: string;
  base: string;            // upstream base URL, e.g. 'https://api.example.com/v1'
  auth?: ConnectorAuth;
  reads?: ConnectorRead[];
  actions?: ConnectorAction[];
}

/** What `defineConnector(def)` resolves to: the clean Layer-A contract (served like a
 *  native app) + the mount that proxies each call to the upstream. */
export interface Connector {
  app: string;
  id: string;
  capabilities: CapabilityDef[];   // from actions, stripped of upstream/map (discoverable)
  datasets: DatasetDef[];          // from reads, stripped of upstream/map
  /**
   * Wire the connector's routes onto an Express router/app: each read → a GET that
   * fetches + maps the upstream collection; each action → its method, mapping the
   * request body to the upstream call. `opts.fetch` is injectable (tests/mocks);
   * `opts.token`/`opts.headers` override the env-resolved upstream auth.
   */
  mount(router: unknown, opts?: {
    fetch?: typeof fetch; token?: string; headers?: Record<string, string>; basePath?: string;
  }): void;
  /**
   * The in-process callable surface (17.6): run one declared read — the SAME
   * query-building + field-mapping code `mount()`'s GET route runs — with no HTTP hop.
   * `params` is matched against that read's declared `filters` by name (mirrors
   * `req.query`); `opts` mirrors `mount()`'s (`fetch`/`base`/`token`/`headers`).
   *
   * Lets a route handler in the connector's OWN app reuse the connector's upstream call
   * in-process instead of hand-rolling a second copy of it (the trap papyros's
   * src/routes/match.js used to fall into for META's `metadataSearch`). Throws — never
   * resolves null/undefined — on an unknown read id, a missing fetch, or an upstream
   * failure; turning that into an HTTP response stays `mount()`'s job.
   */
  call(readId: string, params?: Record<string, unknown>, opts?: {
    fetch?: typeof fetch; base?: string; token?: string; headers?: Record<string, string>;
  }): Promise<Array<Record<string, unknown>>>;
}
