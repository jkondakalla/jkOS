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
  | 'enum'     // one of `enum`
  | 'json'     // a structured document (nested tree / arbitrary object), not a flat
               // form field — the typed ESCAPE HATCH. A primitive that uses this for
               // an input/output is NOT fully lego-ready (a GUI/AI can't snap a stud
               // onto an opaque blob); the capability-completeness probe flags it.
  | 'ref';     // a reference to another primitive's row — a typed STUD. The target
               // collection is named by `ref` ('<app>.<dataset>'), so a GUI/AI knows
               // this field IS "a task" / "an event" / "a device", not just a string.

/** One field in a capability's request body, or one column of a returned row. The
 *  server still validates; this drives the GUI mapper and client-side required/shape
 *  hints, plus AI composition (a self-describing stud). */
export interface BodyField {
  name: string;          // wire key, e.g. 'title'
  type: FieldType;
  label?: string;        // human label for the workshop mapper
  required?: boolean;
  enum?: string[];       // when type === 'enum'
  ref?: string;          // when type === 'ref': the referenced dataset, '<app>.<dataset>'
                         // (e.g. 'beigeboard.items') — the typed stud another lego snaps onto
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
  returns?: BodyField[];            // the shape THE CALL ANSWERS WITH — the immediate HTTP
                                    // response. For a synchronous capability this is also the
                                    // result, and it is the primitive's OUTPUT stud (mirror of
                                    // DatasetDef.item), so a GUI/AI can wire one lego's result
                                    // into the next's input. Omit only for a pure side-effect
                                    // (e.g. DELETE) whose body echo is the request.

  /**
   * ⭐ ASYNC ONLY (WV-5). What the WORK eventually produces, as distinct from what the
   * CALL answers with.
   *
   * ⚠️ THE BUG THIS EXISTS TO CLOSE. Every LazurOS capability declares
   * `returns: [{ name:'job_id', type:'string' }]`. That is CORRECT for the HTTP response
   * — you get a job handle — and useless for composition, because a binding engine
   * reading `returns` sees a `string` where the real result lives, and will cheerfully
   * type-check a job UUID into a task title. It would not error. It would create a task
   * called `a3f1c8e2-…`, and the only symptom is a nonsense row.
   *
   * ⚠️ THE PRESENCE OF THIS FIELD IS THE DECLARATION THAT THE CAPABILITY IS ASYNC.
   * There is deliberately no separate `async: true` — two fields that must agree are two
   * fields that can disagree, and this suite has paid for that shape before.
   *
   * A binder must therefore use `resolves` when it is present and NEVER `returns`, and
   * the trigger that consumes an async capability fires on the job's COMPLETION, not on
   * the call. See server/trigger.js's validateTriggerTypes, and `pnpm check:async` which
   * fails any capability that returns a bare handle without saying what it resolves to.
   */
  resolves?: BodyField[];
  invalidates?: string[];           // resource keys to refetch after success: ['beigeboard.items']
  roles?: string[];                 // coarse gate (defaults to the app's allowed_roles)
  scopes?: string[];                // fine gate, enforced by the resource app
  ai?: boolean;
  doc?: string;                     // long-form description (a non-flat body or AI hint) — markdown ok
}

/** What an app returns from its capabilitiesPath. */
export interface CapabilityDoc {
  app: string;                      // must match the manifest id
  version: number;                  // bump on breaking body changes
  capabilities: CapabilityDef[];
}
