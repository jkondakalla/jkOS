// ESM twin of activity.js — so `@jkos/weave/activity` resolves for both `require`
// (the CJS discovery docs) and `import` (ESM tooling like the prober). Mirrors the
// collection.mjs / server/index.mjs pattern; the gate test asserts they don't drift.
import mod from './activity.js'

export const defineActivity = mod.defineActivity
export const canonicalTime = mod.canonicalTime
export const extRef = mod.extRef
export const checkActivityDoc = mod.checkActivityDoc
export const isValidActivityDoc = mod.isValidActivityDoc
export const checkExtRefDoc = mod.checkExtRefDoc
export const extRefFieldDoc = mod.extRefFieldDoc
export const pageLimit = mod.pageLimit
export const PAGE_DEFAULT = mod.PAGE_DEFAULT
export const PAGE_MAX = mod.PAGE_MAX
export const CURSOR_PARAM = mod.CURSOR_PARAM
export const idempotencyBodyField = mod.idempotencyBodyField
export default mod
