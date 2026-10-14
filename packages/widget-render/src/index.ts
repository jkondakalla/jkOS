// @jkos/widget-render — draw a widget file in whichever app hosts it. See render.tsx.
export {
  renderWidget, renderNode, resolve, truthy, CardHead, vars, HostKindsProvider, useWidgetActions,
  type WidgetHost, type HostKinds, type HostKindComponent, type Scope, type NodeOf,
  type HostActionDecl, type HostActionFn, type HostActions, type DeclField,
} from './render';
export {
  useDataSources, cardState, SourceReaderProvider, liveReader, readExternal, refusedUrl, resolveParams, suiteOrigins,
  type CardState, type SourceRead, type SourceReader,
} from './sources';
export { TONE_COLOR, TONE_RANK } from './tone';
export { usesAi } from './ai';
export { WidgetBoundary } from './boundary';
export type {
  Binding, ToneBinding, CommandRef, WidgetFrame, WidgetSpec, WidgetSizing, WidgetDef, WidgetInput, StateVar,
  WidgetNode, Tone, IconName, HostKind, HostKindsOf, ActionChain, DataSource, SourceState, SourceStatus,
} from './types';
