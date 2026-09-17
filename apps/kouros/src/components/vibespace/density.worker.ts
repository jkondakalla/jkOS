// density.worker.ts — builds the vibe space's density slices off the main thread.
//
// ~48 slices × 48³ voxels, a splat and three blur passes each: about a second and a
// half on a desktop and several on a phone, which on the main thread would freeze
// every gesture while the cloud assembled. The particles are interactive the moment
// the map arrives; the cloud fades in when this posts.
//
// ⚠️ ALL the slices are built before ANY is posted, because the tone map's ρ_ref is the
// p99 over every slice (geometry.ts): a slice posted early would have to be mapped
// against a reference that does not exist yet, and re-mapping it later is the
// per-slice normalisation the whole field is built to refuse.

import { DENSITY, densitySlices, type DecodedMap } from './geometry';

self.onmessage = (event: MessageEvent<{ token: number; map: DecodedMap }>) => {
  const { token, map } = event.data;
  try {
    const field = densitySlices(map, DENSITY);
    const message = { token, grid: field.grid, slices: field.slices, rhoRef: field.rhoRef, textures: field.textures };
    (self as unknown as { postMessage: (m: unknown, t: Transferable[]) => void })
      .postMessage(message, field.textures.map((t) => t.buffer));
  } catch (err) {
    (self as unknown as { postMessage: (m: unknown) => void }).postMessage({ token, error: String(err) });
  }
};
