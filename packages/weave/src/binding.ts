/**
 * weave/binding.ts — THE binding model, for the frontend.
 *
 * One model, two directions: a WidgetSpec binds a dataset into a tree of primitives
 * (read); a TriggerDef binds a capability's typed output into another's body (write).
 * The prose and the runtime live in ./shared/binding.js so the CJS backends (the
 * trigger engine) and the browser (the widget renderer) share one implementation
 * rather than one idea spelled twice.
 */
export type { Binding, SourceBinding, LiteralBinding, EventBinding, ConditionBinding, Bindable, Format } from './shared/binding.js';
export {
  EVENT_SOURCE, FORMATS, CONDITIONS, isBinding, isCondition, truthy, normalizeBinding, sourceBindings,
  dig, resolveBinding, resolveBody, format,
} from './shared/binding.js';
