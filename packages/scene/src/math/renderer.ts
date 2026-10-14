// renderer.ts — what is drawing: a GPU, or a CPU pretending to be one. PURE: the name
// comes from ../gl `rendererName`, the verdict is here, where a node gate can drive it.
//
// ⚠️ **A SOFTWARE RASTERISER IS A WEBGL2 CONTEXT LIKE ANY OTHER.** Chrome on a
// blocklisted GPU, a VM, or a headless run hands out SwiftShader; Linux without a
// driver hands out llvmpipe. Both pass every feature test and then pay per triangle on
// the CPU. Measured 2026-10-14 on the 3-D pulsarmap at phone size: 60 fps on a GPU,
// 1.9 fps on SwiftShader — a view that is cheap on any GPU can be unusable here, and
// only the name says so.

/** Whether a WebGL renderer name is a CPU rasteriser. An unknown or masked name is
 *  NOT software — the browser chose not to say, and a GPU is by far the common case. */
export function isSoftwareRenderer(name: string | null | undefined): boolean {
  return !!name && /swiftshader|llvmpipe|softpipe|lavapipe|software rasterizer|microsoft basic render/i.test(name);
}
