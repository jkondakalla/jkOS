// gl.ts — the 3-D pulsarmap's four draws, hand-rolled WebGL2.
//
// There are no vertex buffers at all: every vertex is derived in the shader from
// `gl_InstanceID` (which line and segment) and `gl_VertexID` (which corner of the
// quad), its height ONE read from a ring of row curves (stage.ts `RING`, `rowCurve`) —
// each row splined once, in TypeScript, when it enters the window. A seek refills the
// ring; nothing else about a frame depends on the last one.
//
// The lines, back to front: the snapshot rows of the window, then the LIVE line (always
// the last — stage.ts `LiveWindow`), the two rows around it blended. Every line is a
// Catmull-Rom curve through the bands' own values, `u_sub` segments to a gap —
// and because the spline is linear in the bytes, the blend of two curves IS the curve
// of the blend: a snapshot leaves the front exactly the shape the live line had.
//
//   0. SURFACE — per (line, segment), the quad joining a line to the next one, lit by
//      its own facet normal. Written to depth and pushed back with POLYGON_OFFSET_FILL:
//      with the depth test this IS the hidden-line removal, and it is what makes the
//      history a terrain rather than a stack of separate curves (Jag, 2026-10-14).
//   1. FRONT — per segment, the live line down to the floor: the terrain's front face.
//      (A detail with no surface draws 4. CURTAINS instead: every line down to the floor
//      in the background colour — unseen, they hide the lines behind: Unknown Pleasures.)
//   2. LINES — per (line, segment), a quad extruded perpendicular to the segment IN
//      SCREEN SPACE, a fixed CSS width at any distance and any DPR; the live line
//      heavier. Depth-tested against the surface, never written.
//   3. GRID — per (line, column), the same screen-space quad running back in time from
//      one line to the next along every `columnEvery`-th vertex: the mesh's other axis.
//
// What the lines and vertices ARE is the detail's (stage.ts DETAIL): every stored band
// and row, splined, for the smooth terrain; a few pooled cells with straight edges for
// the low-poly one. The four draws are the same.

import { compileProgram, uniforms } from '@jkos/scene/gl';
import type { CoverPalette } from './coverPalette';
import type { RGB } from '@jkos/scene/math';
import {
  AMPLITUDE, FLOOR_Y, HALF_WIDTH, RING, fadeOf,
  columnsOf, liveAt, lineValues, rowCurve, rowsNeeded, segmentsOf, slotOf, type LiveWindow, type Shaped,
} from './stage';

/* ⚠️ The (line, segment) arithmetic below is mirrored by `cellOf` / `lineOf` in
   stage.ts, the ring slot by `slotOf` and the blend by `liveValue`; test/pulsarmap.mjs
   scans this source for these exact expressions. Change one side and a gate says so. */
export const RIDGE_VERTEX = `#version 300 es
precision highp float;
precision highp int;

uniform sampler2D u_curves;     // the ring: one row's curve per texel row
uniform int u_ring;
uniform int u_rowStart;        // the first snapshot row drawn
uniform int u_lines;           // snapshot rows + the live line, which is LAST
uniform int u_liveRow;         // floor(live)
uniform float u_liveFrac;      // live - floor(live)
uniform float u_liveZ;
uniform int u_per;             // instances per line in this pass: segments, or grid columns
uniform int u_bands;
uniform int u_rows;
uniform int u_pass;            // 0 surface, 1 front, 2 lines, 3 grid, 4 curtains, 5 background
uniform mat4 u_viewProj;
uniform vec2 u_viewport;       // device pixels
uniform float u_lineWidth;     // device pixels
uniform float u_liveWidth;     // device pixels
uniform float u_focusZ;
// The detail (stage.ts DETAIL, shapeMesh): one shader draws the smooth terrain and the
// low-poly one — the same arithmetic over a finer or a coarser mesh.
uniform int u_sub;             // segments per gap between two vertices
uniform int u_columnEvery;     // the grid's spacing, in vertices
uniform float u_warp;          // pulsarmap.ts X_WARP, or 1 when the columns are pre-warped
uniform float u_pitch;         // depth between lines
uniform int u_liveOwn;         // 1: the live line is its own texel row, u_ring (stage.ts liveAt)
uniform float u_rise;          // a line's lift per unit it has receded (stage.ts Detail.rise)
uniform vec2 u_fade;           // where the history fades, distance behind the live line (stage.ts fadeOf)
uniform float u_crestFrom;     // the line height its colour starts toward the crest at …
uniform float u_crestSpan;     // … and how far above that it is all crest (palette: 'cover')

out float v_ramp;
out float v_u;                 // across the line, 0 (lowest band) … 1
out float v_crest;             // how far toward its crest a line stands here, 0 … 1
out float v_fog;
out vec3 v_world;
flat out int v_live;

const float AMPLITUDE = ${AMPLITUDE.toFixed(6)};
const float HALF_WIDTH = ${HALF_WIDTH.toFixed(6)};
const float FLOOR_Y = ${FLOOR_Y.toFixed(6)};

float heightAt(int row, int seg) {
  ivec2 texel = ivec2(seg, row % u_ring);
  // The row's curve over the fixed 0…255 span — NEVER rescaled per track.
  return texelFetch(u_curves, texel, 0).r * AMPLITUDE;
}

// One line's height at a segment. The live line is the rows either side of it,
// blended (stage.ts liveValue); a snapshot is its own row.
float lineHeight(int line, int seg) {
  if (line == u_lines - 1) {
    // With a motion the live line is computed every frame (stage.ts liveAt) into the row
    // after the ring — the same fixed span × AMPLITUDE as every other curve.
    if (u_liveOwn == 1) return texelFetch(u_curves, ivec2(seg, u_ring), 0).r * AMPLITUDE;
    int next = min(u_liveRow + 1, u_rows - 1);
    return mix(heightAt(u_liveRow, seg), heightAt(next, seg), u_liveFrac);
  }
  return heightAt(u_rowStart + line, seg);
}

float lineZ(int line) {
  return line == u_lines - 1 ? u_liveZ : float(u_rowStart + line) * u_pitch;
}

vec3 vertexAt(int line, int seg) {
  // pulsarmap.ts bandFraction: the warped band axis both renderers share — warped
  // here, or (u_warp = 1) already, by where shapeMesh placed the columns.
  float u = float(seg) / float((u_bands - 1) * u_sub);
  float x = -HALF_WIDTH + 2.0 * HALF_WIDTH * pow(u, u_warp);
  // The history climbs as it recedes (the plate's stacked lines); the live line, at
  // u_liveZ, never moves.
  float z = lineZ(line);
  return vec3(x, lineHeight(line, seg) + u_rise * (u_liveZ - z), z);
}

void emit(vec3 p, int line) {
  v_world = p;
  v_u = (p.x + HALF_WIDTH) / (2.0 * HALF_WIDTH);
  // The line's own height — the climb (u_rise) taken back out, so a colour reads the music.
  v_crest = clamp((p.y - u_rise * (u_liveZ - p.z) - u_crestFrom) / u_crestSpan, 0.0, 1.0);
  v_ramp = u_rows > 1 ? (p.z / u_pitch) / float(u_rows - 1) : 1.0;
  v_fog = smoothstep(u_fade.x, u_fade.y, u_focusZ - p.z);
  v_live = line == u_lines - 1 ? 1 : 0;
}

void main() {
  int line = gl_InstanceID / u_per;
  int seg = gl_InstanceID % u_per;
  int corner = gl_VertexID;
  int end = corner / 2;
  int side = corner & 1;

  if (u_pass == 5) {
    // The background: one full-screen quad at the far plane, behind everything.
    v_world = vec3(0.0); v_ramp = 0.0; v_fog = 0.0; v_live = 0; v_u = 0.0; v_crest = 0.0;
    gl_Position = vec4(float(side) * 2.0 - 1.0, float(end) * 2.0 - 1.0, 1.0, 1.0);
    return;
  }
  if (u_pass == 0) {
    int l = line + side;
    vec3 p = vertexAt(l, seg + end);
    emit(p, l);
    gl_Position = u_viewProj * vec4(p, 1.0);
    return;
  }
  if (u_pass == 1 || u_pass == 4) {
    int l = u_pass == 1 ? u_lines - 1 : line;
    vec3 p = vertexAt(l, seg + end);
    if (side == 1) p.y = FLOOR_Y;
    emit(p, l);
    gl_Position = u_viewProj * vec4(p, 1.0);
    return;
  }

  vec3 a;
  vec3 b;
  if (u_pass == 2) {
    a = vertexAt(line, seg);
    b = vertexAt(line, seg + 1);
  } else {
    int column = seg * u_columnEvery * u_sub;
    a = vertexAt(line, column);
    b = vertexAt(line + 1, column);
  }
  emit(end == 0 ? a : b, line);
  float width = u_pass == 2 && line == u_lines - 1 ? u_liveWidth : u_lineWidth;

  vec4 ca = u_viewProj * vec4(a, 1.0);
  vec4 cb = u_viewProj * vec4(b, 1.0);
  vec2 sa = ca.xy / ca.w * 0.5 * u_viewport;
  vec2 sb = cb.xy / cb.w * 0.5 * u_viewport;
  vec2 dir = sb - sa;
  float len = length(dir);
  dir = len > 1e-6 ? dir / len : vec2(1.0, 0.0);
  vec2 normal = vec2(-dir.y, dir.x);
  float across = side == 1 ? 1.0 : -1.0;
  float along = end == 0 ? -1.0 : 1.0;
  vec4 c = end == 0 ? ca : cb;
  // Half a width of overlap along the segment, so neighbouring quads close the
  // joint instead of leaving a notch on every bend.
  vec2 offset = (normal * across + dir * along * 0.5) * (width * 0.5);
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
uniform float u_relief;        // stage.ts Detail.relief
uniform vec3 u_light;          // stage.ts Detail.light, unit length
// palette: 'cover' — every colour from the playing sleeve (coverPalette.ts).
uniform int u_cover;
uniform vec2 u_viewport;       // device pixels
uniform vec3 u_ground0;        // the background, bottom …
uniform vec3 u_ground1;        // … to top
uniform vec3 u_stops[4];       // the line's gradient across the spectrum
uniform int u_stopCount;
uniform vec3 u_crest;          // the lightest: peaks and the live line lean to it

in float v_ramp;
in float v_u;
in float v_crest;
in float v_fog;
in vec3 v_world;
flat in int v_live;
out vec4 color;

// The background at this pixel. The curtains and the fade use it too, so a curtain is
// unseen against it and a line fades into exactly what is behind it.
vec3 groundAt() {
  return mix(u_ground0, u_ground1, clamp(gl_FragCoord.y / u_viewport.y, 0.0, 1.0));
}

vec3 stopsAt(float u) {
  float x = clamp(u, 0.0, 1.0) * float(u_stopCount - 1);
  int i = min(int(floor(x)), u_stopCount - 2);
  return mix(u_stops[i], u_stops[i + 1], x - float(i));
}

void main() {
  if (u_cover == 1) {
    vec3 ground = groundAt();
    vec3 hue = stopsAt(v_u);
    vec3 k;
    if (u_pass == 5 || u_pass == 4) {
      k = ground;
    } else if (u_pass == 2) {
      // A line takes the spectrum's gradient, and turns toward the crest as it peaks;
      // the live line leans to the crest even at rest.
      k = mix(hue, u_crest, v_live == 1 ? 0.3 + 0.7 * v_crest : 0.85 * v_crest);
    } else if (u_pass == 0) {
      vec3 n = normalize(cross(dFdx(v_world), dFdy(v_world)));
      if (n.y < 0.0) n = -n;
      float lit = clamp(dot(n, u_light), 0.0, 1.0);
      k = mix(ground, hue, 0.04 + u_relief * lit * lit);
    } else {
      k = mix(ground, hue, u_pass == 1 ? 0.05 : 0.5);
    }
    color = vec4(mix(k, ground, v_fog), 1.0);
    return;
  }
  vec3 ink = mix(u_far, u_line, v_ramp);
  vec3 c;
  if (u_pass == 0) {
    // The relief: each facet's own normal, from the screen-space derivatives of its
    // position, tints the surface a little toward the ink — so the terrain reads as a
    // shape, and the lines on it stay the brightest thing in the frame.
    vec3 n = normalize(cross(dFdx(v_world), dFdy(v_world)));
    if (n.y < 0.0) n = -n;
    float lit = clamp(dot(n, u_light), 0.0, 1.0);
    c = mix(u_surface, ink, 0.04 + u_relief * lit * lit);
  } else if (u_pass == 1) {
    c = mix(u_surface, ink, 0.05);
  } else if (u_pass == 2) {
    c = v_live == 1 ? u_line : ink;
  } else if (u_pass == 4) {
    // A curtain is the background itself: unseen, it only hides what is behind it.
    c = u_surface;
  } else {
    c = mix(u_surface, ink, 0.5);
  }
  color = vec4(mix(c, u_surface, v_fog), 1.0);
}
`;

const UNIFORMS = [
  'u_curves', 'u_ring', 'u_rowStart', 'u_lines', 'u_liveRow', 'u_liveFrac', 'u_liveZ', 'u_per', 'u_bands',
  'u_rows', 'u_pass', 'u_viewProj', 'u_viewport', 'u_lineWidth', 'u_liveWidth',
  'u_focusZ', 'u_surface', 'u_line', 'u_far', 'u_sub', 'u_columnEvery', 'u_warp', 'u_pitch', 'u_relief', 'u_light', 'u_liveOwn', 'u_rise', 'u_fade',
  'u_crestFrom', 'u_crestSpan', 'u_cover', 'u_ground0', 'u_ground1', 'u_stops', 'u_stopCount', 'u_crest',
] as const;

export interface RidgeColors {
  surface: RGB;
  line: RGB;
  far: RGB;
  /** The playing sleeve's palette, for a detail with `palette: 'cover'`; until it has
   *  loaded (or when it cannot), the three tokens above draw. */
  cover?: CoverPalette;
}

/** What RidgeStage drives: this file's renderer, or the vaporwave one (vapor.ts). */
export interface PulsarRenderer {
  setMesh(mesh: Shaped): void;
  draw(frame: RidgeFrame, colors: RidgeColors): void;
  dispose(): void;
}

export interface RidgeFrame {
  viewProj: Float32Array;
  window: LiveWindow;
  focusZ: number;
  /** Drawing-buffer size, device pixels. */
  width: number;
  height: number;
  dpr: number;
}

export class RidgeRenderer implements PulsarRenderer {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private u: Record<(typeof UNIFORMS)[number], WebGLUniformLocation | null>;
  private vao: WebGLVertexArrayObject | null;
  private texture: WebGLTexture | null = null;
  private mesh: Shaped | null = null;
  /** Which row each ring slot holds; −1 = empty. */
  private held = new Int32Array(RING).fill(-1);
  private scratch = new Float32Array(0);
  /** The live line's values (`liveAt`), before they are curved into `scratch`. */
  private liveLine = new Float32Array(0);

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.program = compileProgram(gl, RIDGE_VERTEX, RIDGE_FRAGMENT);
    this.u = uniforms(gl, this.program, UNIFORMS);
    // No attributes at all — but a bound VAO keeps every driver honest about that.
    this.vao = gl.createVertexArray();
  }

  /** A new track, or a new detail: an empty ring the width of its curves. Throws on a
   *  malformed length — a short buffer read against a remembered row count is a picture
   *  of the wrong rows. */
  setMesh(mesh: Shaped): void {
    // A live-sampled mesh holds its source rows, not its lines (stage.ts lineValues).
    const { rows, bands } = mesh;
    const values = mesh.live ? mesh.live.raw : mesh.values;
    const declared = mesh.live ? mesh.live.rows : rows;
    if (!(rows > 0) || !(bands > 1) || values.length !== declared * bands) {
      throw new Error(`pulsarmap: ${values.length} values for a declared ${declared}x${bands}`);
    }
    const { gl } = this;
    const width = segmentsOf(bands, mesh.detail.subdivisions) + 1;
    if (!this.texture) this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    // RING rows of snapshots, and one more for a live line of its own (`liveAt`).
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, width, RING + 1, 0, gl.RED, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.mesh = mesh;
    this.held.fill(-1);
    this.scratch = new Float32Array(width);
    this.liveLine = new Float32Array(bands);
  }

  /** Spline every row this frame reads into its ring slot, unless the slot holds it. */
  private fill(w: LiveWindow): void {
    const { gl, mesh } = this;
    if (!mesh) return;
    const { from, to } = rowsNeeded(w, mesh.rows);
    for (let row = from; row < to; row++) {
      const slot = slotOf(row);
      if (this.held[slot] === row) continue;
      lineValues(mesh, row, this.liveLine);
      rowCurve(this.liveLine, 0, mesh.bands, this.scratch, 0, mesh.detail.subdivisions);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, slot, this.scratch.length, 1, gl.RED, gl.FLOAT, this.scratch);
      this.held[slot] = row;
    }
  }

  draw(frame: RidgeFrame, colors: RidgeColors): void {
    const { gl, u, mesh } = this;
    const w = frame.window;
    gl.viewport(0, 0, frame.width, frame.height);
    gl.clearColor(colors.surface[0], colors.surface[1], colors.surface[2], 1);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (!mesh || w.lines < 1) return;

    const { subdivisions, columnEvery, relief } = mesh.detail;
    const segments = segmentsOf(mesh.bands, subdivisions);
    const columns = columnsOf(mesh.bands, columnEvery);
    const liveRow = Math.floor(w.live);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    this.fill(w);
    if (mesh.live) {
      // The live line, now: at the time its position stands for (stage.ts lineTime), so it
      // is EXACTLY the snapshot it becomes as it reaches each line.
      liveAt(mesh.live, mesh.bands, (w.live + 0.5) * mesh.rowSeconds, this.liveLine);
      rowCurve(this.liveLine, 0, mesh.bands, this.scratch, 0, subdivisions);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, RING, this.scratch.length, 1, gl.RED, gl.FLOAT, this.scratch);
    }
    gl.uniform1i(u.u_liveOwn, mesh.live ? 1 : 0);
    gl.uniform1f(u.u_rise, mesh.detail.rise ?? 0);
    const fade = fadeOf(mesh.detail);
    gl.uniform2f(u.u_fade, fade.near, fade.far);
    const bal = mesh.detail.balance;
    gl.uniform1f(u.u_crestFrom, ((bal ? bal.rest : 0) / 255) * AMPLITUDE);
    gl.uniform1f(u.u_crestSpan, ((bal ? bal.swing : 255) / 255) * AMPLITUDE);
    const cover = mesh.detail.palette === 'cover' ? colors.cover : undefined;
    gl.uniform1i(u.u_cover, cover ? 1 : 0);
    if (cover) {
      const stops = cover.stops.slice(0, 4);
      const flat = new Float32Array(12);
      stops.forEach((c, i) => flat.set(c, i * 3));
      gl.uniform3fv(u.u_stops, flat);
      gl.uniform1i(u.u_stopCount, Math.max(2, stops.length));
      gl.uniform3fv(u.u_ground0, cover.ground[0]);
      gl.uniform3fv(u.u_ground1, cover.ground[1]);
      gl.uniform3fv(u.u_crest, cover.crest);
    }
    gl.uniform1i(u.u_curves, 0);
    gl.uniform1i(u.u_ring, RING);
    gl.uniform1i(u.u_rowStart, w.start);
    gl.uniform1i(u.u_lines, w.lines);
    gl.uniform1i(u.u_liveRow, liveRow);
    gl.uniform1f(u.u_liveFrac, w.live - liveRow);
    gl.uniform1f(u.u_liveZ, w.live * mesh.pitch);
    gl.uniform1i(u.u_sub, subdivisions);
    gl.uniform1i(u.u_columnEvery, columnEvery);
    gl.uniform1f(u.u_warp, mesh.warp);
    gl.uniform1f(u.u_pitch, mesh.pitch);
    gl.uniform1f(u.u_relief, relief);
    gl.uniform3fv(u.u_light, mesh.detail.light);
    gl.uniform1i(u.u_bands, mesh.bands);
    gl.uniform1i(u.u_rows, mesh.rows);
    gl.uniformMatrix4fv(u.u_viewProj, false, frame.viewProj);
    gl.uniform2f(u.u_viewport, frame.width, frame.height);
    gl.uniform1f(u.u_lineWidth, mesh.detail.linePx * frame.dpr);
    gl.uniform1f(u.u_liveWidth, mesh.detail.livePx * frame.dpr);
    gl.uniform1f(u.u_focusZ, frame.focusZ);
    gl.uniform3fv(u.u_surface, colors.surface);
    gl.uniform3fv(u.u_line, colors.line);
    gl.uniform3fv(u.u_far, colors.far);

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);

    const pass = (n: number, per: number, count: number) => {
      if (count <= 0) return;
      gl.uniform1i(u.u_pass, n);
      gl.uniform1i(u.u_per, per);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    };

    // 0–1. the surface and its front face — or, with no surface, every line's curtain —
    //      written to depth and pushed back so a line lying on its own body wins
    // The sleeve's background, behind everything.
    if (cover) {
      gl.depthMask(false);
      pass(5, 1, 1);
    }

    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(2, 2);
    gl.depthMask(true);
    if (mesh.detail.surface) {
      pass(0, segments, (w.lines - 1) * segments);
      pass(1, segments, segments);
    } else {
      pass(4, segments, w.lines * segments);
    }
    gl.disable(gl.POLYGON_OFFSET_FILL);

    // 2–3. the lines and the grid, tested against the surface, never written
    gl.depthMask(false);
    pass(2, segments, w.lines * segments);
    pass(3, columns, (w.lines - 1) * columns);
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
