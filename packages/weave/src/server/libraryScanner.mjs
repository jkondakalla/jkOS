// ESM twin of libraryScanner.js — so `@jkos/weave/libraryScanner` resolves for both
// `require` (a plain-CJS backend like papyros) and `import`. Mirrors server/index.mjs /
// collection.mjs / connector.mjs; the gate test asserts they don't drift.
import mod from './libraryScanner.js'

export const defineLibraryScanner = mod.defineLibraryScanner
export const parseProbe = mod.parseProbe
export const probeFile = mod.probeFile
export const normalizeTags = mod.normalizeTags
export const parseTrackNumber = mod.parseTrackNumber
export const naturalCompare = mod.naturalCompare
export default mod
