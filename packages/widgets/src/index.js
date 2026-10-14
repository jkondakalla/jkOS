// @jkos/widgets — the ORDECK widget vocabulary as data. See manifest.js.
export { NODES, FRAME, SOURCES, ACTIONS, STATE_TYPES, MAX_USE_DEPTH, KINDS, TONES, ICON_NAMES, RETIRED_COMPONENTS, TIER_COLS, LIMITS, childProps } from './manifest.js'
export { validateWidget } from './validate.js'
// checkBindings (the second tier) is `@jkos/widgets/semantic`, not re-exported here: it is
// dev-time only, and this index is bundled into ORDECK — an index that gains an import of
// a new file breaks every consumer's injected copy until a reinstall (TRAPS.md).
export { walkNodes, sourcesOf, appsOf, actionsOf, partsOf, bodiesOf } from './walk.js'
export { safeHref } from './href.js'
export { routeProblem, routeParams, matchRoute, fillRoute, routeTable, pageFor } from './routes.js'
