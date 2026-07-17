// ESM twin of connector.js — so `@jkos/weave/connector` resolves for both `require`
// and `import`. Mirrors server/index.mjs; the gate test asserts they don't drift.
import mod from './connector.js'

export const defineConnector = mod.defineConnector
export default mod
