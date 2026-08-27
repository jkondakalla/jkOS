// ESM twin of collection.js — so `@jkos/weave/collection` resolves for both
// `require` (the CJS discovery doc) and `import` (ESM tooling like the prober).
// Mirrors the server/index.mjs pattern; the gate test asserts they don't drift.
import mod from './collection.js'

export const defineCollection = mod.defineCollection
export const backfillWireTime = mod.backfillWireTime
export default mod
