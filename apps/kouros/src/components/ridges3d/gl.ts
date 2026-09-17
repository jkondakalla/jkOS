// gl.ts — the 3-D pulsarmap's two draws, hand-rolled WebGL2.
//
// The mesh is ONE R8 texture (see stage.ts `textureLayout`) and there are no vertex
// buffers at all: every vertex is derived in the shader from `gl_InstanceID` (which
// row and band) and `gl_VertexID` (which corner of the quad). A new track is one
// `texImage2D`; a seek changes a uniform.
//
//   1. CURTAINS — per segment, a quad from the ridge down to the floor, in the
//      surface colour, pushed back with POLYGON_OFFSET_FILL. With the depth test
//      this IS the hidden-line removal the 2-D renderer fakes by filling before it
//      strokes. ⚠️ Not optional: without it the stack is a transparent tangle.
//   2. LINES — per segment, a quad extruded perpendicular to the segment IN SCREEN
//      SPACE, LINE_WIDTH_PX wide at any distance and any DPR. Depth-tested against
//      the curtains, never written.

import { compileProgram, uniforms, type RGB } from '../webgl/context';
import {
  AMPLITUDE, FLOOR_Y, FOG_FAR, FOG_NEAR, HALF_WIDTH, LINE_WIDTH_PX, PITCH,
  packTexture, textureLayout, type RowWindow, type TextureLayout,
} from './stage';

/* ⚠️ The (row, band) and texel arithmetic below is mirrored by `cellOf` and
   `texelOf` in stage.ts, and test/pulsarmap.mjs scans this source for these exact
   expressions. Change one side and the gate says so. */
export const RIDGE_VERTEX = `#version 300 es
precision highp float;
precision highp int;

uniform sampler2D u_mesh;
uniform int u_rowStart;
uniform int u_segments;
uniform int u_bands;
uniform int u_rowsPerColumn;
uniform int u_rows;
uniform int u_pass;            // 0 = curtain, 1 = line
uniform mat4 u_viewProj;
uniform vec2 u_viewport;       // device pixels
uniform float u_lineWidth;     // device pixels
uniform float u_focusZ;

out float v_ramp;
out float v_fog;

const float AMPLITUDE = ${AMPLITUDE.toFixed(6)};
const float PITCH = ${PITCH.toFixed(6)};
const float HALF_WIDTH = ${HALF_WIDTH.toFixed(6)};
const float FLOOR_Y = ${FLOOR_Y.toFixed(6)};
const float FOG_NEAR = ${FOG_NEAR.toFixed(6)};
const float FOG_FAR = ${FOG_FAR.toFixed(6)};

float heightAt(int row, int band) {
  int column = row / u_rowsPerColumn;
  ivec2 texel = ivec2(band + column * u_bands, row - column * u_rowsPerColumn);
  // Bytes over the fixed 0…255 span — NEVER rescaled per track.
  return texelFetch(u_mesh, texel, 0).r * AMPLITUDE;
}

vec3 cell(int row, int band) {
  float x = -HALF_WIDTH + 2.0 * HALF_WIDTH * float(band) / float(u_bands - 1);
  return vec3(x, heightAt(row, band), float(row) * PITCH);
}

void main() {
  int row = u_rowStart + gl_InstanceID / u_segments;
  int band = gl_InstanceID % u_segments;
  int corner = gl_VertexID;
  int end = corner / 2;
  vec3 a = cell(row, band);
  vec3 b = cell(row, band + 1);

  v_ramp = u_rows > 1 ? float(row) / float(u_rows - 1) : 1.0;
  v_fog = smoothstep(FOG_NEAR, FOG_FAR, u_focusZ - a.z);

  if (u_pass == 0) {
    vec3 p = end == 0 ? a : b;
    if ((corner & 1) == 1) p.y = FLOOR_Y;
    gl_Position = u_viewProj * vec4(p, 1.0);
    return;
  }

  vec4 ca = u_viewProj * vec4(a, 1.0);
  vec4 cb = u_viewProj * vec4(b, 1.0);
  vec2 sa = ca.xy / ca.w * 0.5 * u_viewport;
  vec2 sb = cb.xy / cb.w * 0.5 * u_viewport;
  vec2 dir = sb - sa;
  float len = length(dir);
  dir = len > 1e-6 ? dir / len : vec2(1.0, 0.0);
  vec2 normal = vec2(-dir.y, dir.x);
  float side = (corner & 1) == 1 ? 1.0 : -1.0;
  float along = end == 0 ? -1.0 : 1.0;
  vec4 c = end == 0 ? ca : cb;
  // Half a width of overlap along the segment, so neighbouring quads close the
  // joint instead of leaving a notch on every bend.
  vec2 offset = (normal * side + dir * along * 0.5) * (u_lineWidth * 0.5);
  c.xy += offset / (0.5 * u_viewport) * c.w;
  gl_Position = c;
}
`;

export const RIDGE_FRAGMENT = `#version 300 es
precision highp float;
// ⚠️ Declared, not defaulted: u_pass is shared with the vertex stage, which is
// highp int, and a uniform whose precision differs between stages FAILS TO LINK
// (seen in headless Chromium; the 2-D fallback then drew, as designed).
precision highp int;

uniform int u_pass;
uniform vec3 u_surface;
uniform vec3 u_line;
uniform vec3 u_far;

in float v_ramp;
in float v_fog;
out vec4 color;

void main() {
  vec3 ink = u_pass == 0 ? u_surface : mix(u_far, u_line, v_ramp);
  color = vec4(mix(ink, u_surface, v_fog), 1.0);
}
`;

const UNIFORMS = [
  'u_mesh', 'u_rowStart', 'u_segments', 'u_bands', 'u_rowsPerColumn', 'u_rows', 'u_pass',
  'u_viewProj', 'u_viewport', 'u_lineWidth', 'u_focusZ', 'u_surface', 'u_line', 'u_far',
] as const;

export interface RidgeColors {
  surface: RGB;
  line: RGB;
  far: RGB;
}

export interface RidgeFrame {
  viewProj: Float32Array;
  window: RowWindow;
  focusZ: number;
  /** Drawing-buffer size, device pixels. */
  width: number;
  height: number;
  dpr: number;
}

export class RidgeRenderer {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private u: Record<(typeof UNIFORMS)[number], WebGLUniformLocation | null>;
  private vao: WebGLVertexArrayObject | null;
  private texture: WebGLTexture | null = null;
  private layout: TextureLayout | null = null;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.program = compileProgram(gl, RIDGE_VERTEX, RIDGE_FRAGMENT);
    this.u = uniforms(gl, this.program, UNIFORMS);
    // No attributes at all — but a bound VAO keeps every driver honest about that.
    this.vao = gl.createVertexArray();
  }

  /** Upload a whole track's mesh. Throws on a malformed length (packTexture). */
  setMesh(bytes: Uint8Array, rows: number, bands: number): void {
    const { gl } = this;
    const max = Math.min(4096, gl.getParameter(gl.MAX_TEXTURE_SIZE) as number);
    const layout = textureLayout(rows, bands, max);
    const texels = packTexture(bytes, layout);
    if (!this.texture) this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, layout.width, layout.height, 0, gl.RED, gl.UNSIGNED_BYTE, texels);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.layout = layout;
  }

  draw(frame: RidgeFrame, colors: RidgeColors): void {
    const { gl, u, layout } = this;
    gl.viewport(0, 0, frame.width, frame.height);
    gl.clearColor(colors.surface[0], colors.surface[1], colors.surface[2], 1);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (!layout || frame.window.end <= frame.window.start) return;

    const segments = layout.bands - 1;
    const count = (frame.window.end - frame.window.start) * segments;
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.uniform1i(u.u_mesh, 0);
    gl.uniform1i(u.u_rowStart, frame.window.start);
    gl.uniform1i(u.u_segments, segments);
    gl.uniform1i(u.u_bands, layout.bands);
    gl.uniform1i(u.u_rowsPerColumn, layout.rowsPerColumn);
    gl.uniform1i(u.u_rows, layout.rows);
    gl.uniformMatrix4fv(u.u_viewProj, false, frame.viewProj);
    gl.uniform2f(u.u_viewport, frame.width, frame.height);
    gl.uniform1f(u.u_lineWidth, LINE_WIDTH_PX * frame.dpr);
    gl.uniform1f(u.u_focusZ, frame.focusZ);
    gl.uniform3fv(u.u_surface, colors.surface);
    gl.uniform3fv(u.u_line, colors.line);
    gl.uniform3fv(u.u_far, colors.far);

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);

    // 1. curtains, written to depth and pushed back so a line on its own ridge wins
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(1, 1);
    gl.depthMask(true);
    gl.uniform1i(u.u_pass, 0);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    gl.disable(gl.POLYGON_OFFSET_FILL);

    // 2. lines, tested against the curtains, never written
    gl.depthMask(false);
    gl.uniform1i(u.u_pass, 1);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    gl.depthMask(true);
  }

  dispose(): void {
    const { gl } = this;
    if (gl.isContextLost()) return;
    if (this.texture) gl.deleteTexture(this.texture);
    if (this.vao) gl.deleteVertexArray(this.vao);
    gl.deleteProgram(this.program);
  }
}
