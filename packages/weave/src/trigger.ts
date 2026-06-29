/**
 * weave/trigger.ts — the TRIGGER / automation primitive (Layer D / F1 + G1) and the
 * landing site for F4 (reference types + flow).
 *
 * The keystone for apps that *cleanly work together*: "WHEN x happens → DO y",
 * expressible as pure data. A TriggerDef names a source event (a capability firing on
 * some app — its typed `returns` IS the event payload) and a target action (another
 * app's capability), and WIRES them: each DO body field is a literal OR a Binding that
 * pulls a field from the event payload. That binding is F4 in the concrete — one lego's
 * typed OUTPUT stud snapped into the next lego's typed INPUT stud — and
 * `validateTriggerTypes` (server/trigger.js) checks the studs actually fit.
 *
 * Cross-app per-user DOs run under the triggering user's authority via the G1
 * on-behalf-of delegation seam (a delegation-enrolled service client). The runtime —
 * the engine that evaluates triggers, resolves bindings, and dispatches — lives in
 * server/trigger.js. These are the design-time shapes a Workshop GUI / an AI emits.
 */

/** A DO-body value that pulls from the WHEN event's payload (the source capability's
 *  typed `returns`). `from` is a field name, dotted for nested payloads. */
export interface Binding {
  from: string;
}

/** One slot of a DO body: a literal, or a Binding to the event payload. */
export type TriggerValue = string | number | boolean | null | Binding;

/** The source event: a capability firing on an app. Its `returns` shape is the payload. */
export interface TriggerWhen {
  app: string;          // the app whose capability is the event source, e.g. 'beigeboard'
  capability: string;   // the capability id, e.g. 'createItem'
}

/** The action to perform: invoke a (possibly different) app's capability. */
export interface TriggerDo {
  app: string;          // the target app
  capability: string;   // the capability id to invoke
  body?: Record<string, TriggerValue>;   // literals + bindings → the resolved request body
  actingUser?: 'event' | string;         // whose authority the DO runs under: 'event' (default)
                                          // = the user who caused the WHEN; or a fixed user id.
                                          // A per-user CROSS-app DO needs G1 delegation.
}

/** "WHEN when → DO do", as pure data. */
export interface TriggerDef {
  id: string;
  label: string;
  when: TriggerWhen;
  do: TriggerDo;
  enabled?: boolean;    // default true
}

/** One problem found by validateTriggerTypes (the F4 stud-fit check). */
export interface TriggerTypeIssue {
  field: string;
  msg: string;
}
