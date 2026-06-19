/**
 * weave/capability.ts — the capability contract.
 *
 * An app declares what can be DONE to it by serving a CapabilityDoc at its
 * `capabilitiesPath` (GET /api/<app>/capabilities). This is the write-side mirror
 * of jkAuth's read-side `app_registry`: app-owned data, served by the app about
 * itself. jkAuth stores only WHERE to find it (capabilities_path), never the
 * capabilities themselves — so adding an app's write surface needs no central
 * edit, and the blast radius of a malformed capability stays inside that app.
 *
 * These are pure data shapes. How a widget BINDS form fields to a capability's
 * body (CommandRef + Bindings) lives in the widget engine; the dispatcher here
 * takes an already-resolved plain body.
 */

export type FieldType =
  | 'string'   // single-line text
  | 'text'     // multi-line text
  | 'number'
  | 'boolean'
  | 'date'     // YYYY-MM-DD
  | 'time'     // HH:MM (24h)
  | 'enum';    // one of `enum`

/** One field in a capability's request body. The server still validates; this
 *  drives the GUI mapper and client-side required/shape hints only. */
export interface BodyField {
  name: string;          // wire key, e.g. 'title'
  type: FieldType;
  label?: string;        // human label for the workshop mapper
  required?: boolean;
  enum?: string[];       // when type === 'enum'
  default?: unknown;     // literal default if the form omits it
  max?: number;          // length cap (string/text)
}

/** One action an app can perform on behalf of the caller. */
export interface CapabilityDef {
  id: string;                       // stable within the app, e.g. 'createItem'
  label: string;                    // 'Add a task'
  method: 'POST' | 'PATCH' | 'DELETE';
  path: string;                     // RELATIVE to the app's apiBase: '/items' or '/items/:id'
  body?: BodyField[];               // omit for DELETE
  invalidates?: string[];           // resource keys to refetch after success: ['bb.items']
  roles?: string[];                 // coarse gate (defaults to the app's allowed_roles)
  scopes?: string[];                // fine gate, enforced by the resource app
  ai?: boolean;
}

/** What an app returns from its capabilitiesPath. */
export interface CapabilityDoc {
  app: string;                      // must match the manifest id
  version: number;                  // bump on breaking body changes
  capabilities: CapabilityDef[];
}
