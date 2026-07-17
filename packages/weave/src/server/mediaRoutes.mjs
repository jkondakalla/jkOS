// ESM twin of mediaRoutes.js — so `@jkos/weave/mediaRoutes` resolves for both `require`
// and `import`. Mirrors server/index.mjs / collection.mjs / connector.mjs; the gate test
// asserts they don't drift.
import mod from './mediaRoutes.js'

export const defineMediaRoutes = mod.defineMediaRoutes
export const decidePlayback = mod.decidePlayback
export const sanitizeFilenameStem = mod.sanitizeFilenameStem
export const attachmentHeader = mod.attachmentHeader
export default mod
