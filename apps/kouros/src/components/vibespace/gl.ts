// gl.ts — the vibe space's three passes, hand-rolled WebGL2 (no library; see motion.ts).
//
//   1. VOLUME — a full-screen triangle into an offscreen buffer at a reduced render
//      scale. Each pixel's ray is clipped to the cube and marched front to back (≤ 64
//      steps, out at α > 0.97), sampling the TWO density slices either side of the
//      swipe position and mixing them by `u_mix` (geometry.ts `sliceMix`). Emission
//      takes its colour from the brightness ramp. A slow domain warp (≤ 1 voxel) makes
//      the cloud breathe; it moves no particle and changes no answer, and it is off
//      under reduced motion.
//   2. COMPOSITE — that buffer, premultiplied, over the surface colour, upscaled.
//   3. PARTICLES — every track as a point whose size and alpha are its GLINT
//      (exp(−(Δw/0.04)²)), inferred rows dimmer; then the pin and the now-playing
//      track as rings. Additive on the dark tube, ordinary "over" on paper — light
//      added to paper is invisible.
//
// ⚠️ A swipe writes uniforms, not buffers: the points are uploaded once, the two slice
// textures are re-uploaded only when the swipe crosses a slice centre (48³ × 2 bytes,
// ~0.2 MB), and nothing here allocates per frame.

import { compileProgram, uniforms } from '@jkos/scene/gl';
import type { RGB } from '@jkos/scene/math';
import { FLAG_INFERRED, FLAG_NO_TONE, sliceMix, type DecodedMap } from './geometry';

const TRIANGLE = `#version 300 es
precision highp float;
out vec2 v_uv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  v_uv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

/** How far in from each face of the display cube the volume fades out, in half-widths.
 *  ⚠️ THE CUBE IS NOT THE CLOUD'S EDGE. Display units are xyz / R (the p98 radius),
 *  clamped to the cube, so the outermost ~2% of a library piles onto its faces — and a
 *  dense cluster that reaches a face was sliced flat by the ray's clip, a straight edge
 *  across the real library at mid energy (seen 2026-09-23). Fading opacity over the
 *  last ~4 voxels dissolves the cloud into the dark instead. Presentation only: the
 *  particles, a pin, and every "near" answer keep the server's coordinates. */
export const EDGE_FADE = 0.16;

export const VOLUME_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler3D;

uniform sampler3D u_lo;
uniform sampler3D u_hi;
uniform sampler2D u_ramp;
uniform float u_mix;
uniform mat4 u_inverse;
uniform float u_time;
uniform float u_warp;       // 0 = frozen
uniform float u_opacity;
uniform int u_steps;

in vec2 v_uv;
out vec4 color;

vec3 unproject(vec2 ndc, float z) {
  vec4 p = u_inverse * vec4(ndc, z, 1.0);
  return p.xyz / p.w;
}

// A fixed per-pixel jitter on the ray start — no time term, so a still frame is
// reproducible — which trades step banding for fine grain.
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void main() {
  vec2 ndc = v_uv * 2.0 - 1.0;
  vec3 near = unproject(ndc, -1.0);
  vec3 far = unproject(ndc, 1.0);
  vec3 dir = normalize(far - near);
  vec3 inv = 1.0 / dir;
  vec3 ta = (vec3(-1.0) - near) * inv;
  vec3 tb = (vec3(1.0) - near) * inv;
  vec3 tmin = min(ta, tb), tmax = max(ta, tb);
  float t0 = max(max(tmin.x, tmin.y), max(tmin.z, 0.0));
  float t1 = min(min(tmax.x, tmax.y), tmax.z);
  if (t1 <= t0) { color = vec4(0.0); return; }

  float dt = (t1 - t0) / float(u_steps);
  // Opacity per step is corrected to the step's length relative to one voxel, so the
  // cloud is equally dense seen through a corner or a face.
  float voxel = 2.0 / 48.0;
  float t = t0 + dt * hash(gl_FragCoord.xy);
  vec3 acc = vec3(0.0);
  float alpha = 0.0;
  for (int i = 0; i < 64; i++) {
    if (i >= u_steps || alpha > 0.97) break;
    vec3 p = near + dir * t;
    vec3 uvw = p * 0.5 + 0.5;
    if (u_warp > 0.0) {
      uvw += (u_warp / 48.0) * vec3(sin(p.y * 3.1 + u_time * 0.21),
                                    sin(p.z * 2.7 + u_time * 0.17),
                                    sin(p.x * 3.3 + u_time * 0.19));
    }
    vec2 s = mix(texture(u_lo, uvw).rg, texture(u_hi, uvw).rg, u_mix);
    // Opacity follows density SQUARED: the haze between clusters thins and the cores
    // keep their weight, so a library that fills the cube still shows its structure
    // instead of a silhouette. (Linear, a 47,000-track cloud was an opaque slab.)
    float a = 1.0 - exp(-u_opacity * s.r * s.r * dt / voxel);
    // Dissolve toward the cube's faces rather than end at them (EDGE_FADE).
    float face = 1.0 - max(max(abs(p.x), abs(p.y)), abs(p.z));
    a *= smoothstep(0.0, ${EDGE_FADE.toFixed(3)}, face);
    vec3 ink = texture(u_ramp, vec2(s.g, 0.5)).rgb;
    acc += (1.0 - alpha) * a * ink;
    alpha += (1.0 - alpha) * a;
    t += dt;
  }
  color = vec4(acc, alpha);
}
`;

const COMPOSITE_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D u_volume;
uniform float u_cloud;
in vec2 v_uv;
out vec4 color;
void main() { color = texture(u_volume, v_uv) * u_cloud; }
`;

const POINT_VERTEX = `#version 300 es
precision highp float;
layout(location = 0) in vec3 a_xyz;
layout(location = 1) in vec3 a_wtf;   // w, tone, flags
uniform mat4 u_viewProj;
uniform float u_w0;
uniform float u_dpr;
uniform float u_height;               // drawing-buffer px
uniform float u_gain;                 // glint gain for this library's size
out float v_alpha;
out float v_tone;
out float v_ring;
void main() {
  float flags = a_wtf.z;
  float ring = mod(floor(flags / 4.0), 2.0);          // bit 2: a marker ring
  float inferred = mod(flags, 2.0);                   // bit 0
  float dw = a_wtf.x - u_w0;
  float glint = exp(-(dw / 0.04) * (dw / 0.04));
  float label = exp(-(dw / 0.1) * (dw / 0.1));
  vec4 clip = u_viewProj * vec4(a_xyz, 1.0);
  v_ring = ring;
  v_tone = a_wtf.y;
  if (ring > 0.5) {
    v_alpha = max(0.35, label);
    gl_PointSize = 18.0 * u_dpr;
    gl_Position = clip;
    return;
  }
  if (glint < 0.02 || clip.w <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; v_alpha = 0.0; return; }
  float perspective = clamp(4.0 / clip.w, 0.5, 2.5);
  gl_PointSize = mix(1.2, 5.0, glint) * mix(0.7, 1.0, u_gain) * u_dpr * perspective;
  v_alpha = glint * u_gain * (inferred > 0.5 ? 0.45 : 1.0);
  gl_Position = clip;
}
`;

const POINT_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D u_ramp;
uniform vec3 u_ringInk;
in float v_alpha;
in float v_tone;
in float v_ring;
out vec4 color;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r = length(c);
  if (v_ring > 0.5) {
    float band = smoothstep(0.62, 0.72, r) * (1.0 - smoothstep(0.86, 0.98, r));
    color = vec4(u_ringInk, 1.0) * band * v_alpha;
    return;
  }
  float disc = 1.0 - smoothstep(0.35, 1.0, r);
  vec3 ink = texture(u_ramp, vec2(v_tone, 0.5)).rgb;
  float a = disc * v_alpha;
  color = vec4(ink * a, a);            // premultiplied
}
`;

/** Volume opacity per voxel of path, applied to density squared (see the shader). */
export const VOLUME_OPACITY = 1.1;

/** How bright one glint is, given how many tracks share a slice. About an eighth of a
 *  library glints at any swipe position; ~600 at full brightness reads as stars, and
 *  thousands at full brightness ADD to white on the tube and erase the colour. So the
 *  gain falls with the square root of the crowd, floored so a glint never vanishes. */
export function glintGain(n: number): number {
  return Math.min(1, Math.max(0.16, Math.sqrt(600 / Math.max(1, n * 0.12))));
}

export interface VibeFrame {
  viewProj: Float32Array;
  inverse: Float32Array;
  w0: number;
  width: number;
  height: number;
  dpr: number;
  renderScale: number;
  time: number;
  warp: number;
  cloud: number;
  surface: RGB;
  ringInk: RGB;
  face: 'dark' | 'paper';
  markers: Array<{ xyz: [number, number, number]; w: number }>;
}

export interface SliceSource {
  grid: number;
  slices: number;
  textures: Uint8Array[];
}

export class VibeRenderer {
  private gl: WebGL2RenderingContext;
  private volume: WebGLProgram;
  private composite: WebGLProgram;
  private points: WebGLProgram;
  private uv: Record<string, WebGLUniformLocation | null>;
  private uc: Record<string, WebGLUniformLocation | null>;
  private up: Record<string, WebGLUniformLocation | null>;
  private gain = 1;
  private empty: WebGLVertexArrayObject | null;
  private pointVao: WebGLVertexArrayObject | null;
  private pointBuf: WebGLBuffer | null;
  private markerVao: WebGLVertexArrayObject | null;
  private markerBuf: WebGLBuffer | null;
  private markerData = new Float32Array(6 * 4);
  private count = 0;
  private ramp: WebGLTexture | null;
  private slices: [WebGLTexture | null, WebGLTexture | null];
  private loaded: [number, number] = [-1, -1];
  private source: SliceSource | null = null;
  private fbo: WebGLFramebuffer | null;
  private fboTex: WebGLTexture | null;
  private fboSize: [number, number] = [0, 0];

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.volume = compileProgram(gl, TRIANGLE, VOLUME_FRAGMENT);
    this.composite = compileProgram(gl, TRIANGLE, COMPOSITE_FRAGMENT);
    this.points = compileProgram(gl, POINT_VERTEX, POINT_FRAGMENT);
    this.uv = uniforms(gl, this.volume, ['u_lo', 'u_hi', 'u_ramp', 'u_mix', 'u_inverse', 'u_time', 'u_warp', 'u_opacity', 'u_steps'] as const);
    this.uc = uniforms(gl, this.composite, ['u_volume', 'u_cloud'] as const);
    this.up = uniforms(gl, this.points, ['u_viewProj', 'u_w0', 'u_dpr', 'u_height', 'u_ramp', 'u_ringInk', 'u_gain'] as const);
    this.empty = gl.createVertexArray();

    const vertexArray = (buf: WebGLBuffer | null) => {
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
      gl.bindVertexArray(null);
      return vao;
    };
    this.pointBuf = gl.createBuffer();
    this.pointVao = vertexArray(this.pointBuf);
    this.markerBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.markerBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.markerData.byteLength, gl.DYNAMIC_DRAW);
    this.markerVao = vertexArray(this.markerBuf);

    this.ramp = gl.createTexture();
    const slice = () => {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_3D, t);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      for (const w of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, w, gl.CLAMP_TO_EDGE);
      return t;
    };
    this.slices = [slice(), slice()];
    this.fbo = gl.createFramebuffer();
    this.fboTex = gl.createTexture();
  }

  /** Upload every track once: xyz, then (w, tone, flags). */
  setPoints(map: DecodedMap): void {
    const { gl } = this;
    const data = new Float32Array(map.n * 6);
    for (let i = 0; i < map.n; i++) {
      data[i * 6] = map.xyz[i * 3];
      data[i * 6 + 1] = map.xyz[i * 3 + 1];
      data[i * 6 + 2] = map.xyz[i * 3 + 2];
      data[i * 6 + 3] = map.w[i];
      data[i * 6 + 4] = map.flags[i] & FLAG_NO_TONE ? 0.5 : map.tone[i];
      data[i * 6 + 5] = map.flags[i] & FLAG_INFERRED ? 1 : 0;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.pointBuf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    this.count = map.n;
    this.gain = glintGain(map.n);
  }

  setRamp(rgb: Uint8Array): void {
    const { gl } = this;
    gl.bindTexture(gl.TEXTURE_2D, this.ramp);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB8, rgb.length / 3, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, rgb);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  setField(source: SliceSource | null): void {
    this.source = source;
    this.loaded = [-1, -1];
  }

  get hasField(): boolean { return !!this.source; }

  /** Make the two slice textures hold `lo` and `hi`, re-uploading only what changed. */
  private ensureSlices(lo: number, hi: number): void {
    const { gl, source } = this;
    if (!source) return;
    const want: [number, number] = [lo, hi];
    // A swipe that crosses one slice centre shifts the pair by one: swap the two
    // textures so the slice that survives is not uploaded again.
    const moved = (this.loaded[0] !== lo && this.loaded[1] === lo) || (this.loaded[1] !== hi && this.loaded[0] === hi);
    if (moved) {
      this.slices = [this.slices[1], this.slices[0]];
      this.loaded = [this.loaded[1], this.loaded[0]];
    }
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    for (const k of [0, 1] as const) {
      if (this.loaded[k] === want[k]) continue;
      gl.bindTexture(gl.TEXTURE_3D, this.slices[k]);
      gl.texImage3D(gl.TEXTURE_3D, 0, gl.RG8, source.grid, source.grid, source.grid, 0, gl.RG, gl.UNSIGNED_BYTE,
                    source.textures[want[k]]);
      this.loaded[k] = want[k];
    }
  }

  private ensureFbo(w: number, h: number): void {
    const { gl } = this;
    if (this.fboSize[0] === w && this.fboSize[1] === h) return;
    gl.bindTexture(gl.TEXTURE_2D, this.fboTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.fboTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.fboSize = [w, h];
  }

  draw(f: VibeFrame): void {
    const { gl } = this;
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);

    const drawVolume = !!this.source && f.cloud > 0.001;
    if (drawVolume && this.source) {
      const vw = Math.max(1, Math.round(f.width * f.renderScale));
      const vh = Math.max(1, Math.round(f.height * f.renderScale));
      this.ensureFbo(vw, vh);
      const { lo, hi, f: mixF } = sliceMix(f.w0, this.source.slices);
      this.ensureSlices(lo, hi);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
      gl.viewport(0, 0, vw, vh);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.disable(gl.BLEND);
      gl.useProgram(this.volume);
      gl.bindVertexArray(this.empty);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_3D, this.slices[0]);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_3D, this.slices[1]);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.ramp);
      gl.uniform1i(this.uv.u_lo, 0);
      gl.uniform1i(this.uv.u_hi, 1);
      gl.uniform1i(this.uv.u_ramp, 2);
      gl.uniform1f(this.uv.u_mix, mixF);
      gl.uniformMatrix4fv(this.uv.u_inverse, false, f.inverse);
      gl.uniform1f(this.uv.u_time, f.time);
      gl.uniform1f(this.uv.u_warp, f.warp);
      gl.uniform1f(this.uv.u_opacity, VOLUME_OPACITY);
      gl.uniform1i(this.uv.u_steps, 64);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    gl.viewport(0, 0, f.width, f.height);
    gl.clearColor(f.surface[0], f.surface[1], f.surface[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    if (drawVolume) {
      gl.useProgram(this.composite);
      gl.bindVertexArray(this.empty);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.fboTex);
      gl.uniform1i(this.uc.u_volume, 0);
      gl.uniform1f(this.uc.u_cloud, f.cloud);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    gl.useProgram(this.points);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.ramp);
    gl.uniform1i(this.up.u_ramp, 0);
    gl.uniformMatrix4fv(this.up.u_viewProj, false, f.viewProj);
    gl.uniform1f(this.up.u_w0, f.w0);
    gl.uniform1f(this.up.u_dpr, f.dpr);
    gl.uniform1f(this.up.u_height, f.height);
    gl.uniform3fv(this.up.u_ringInk, f.ringInk);
    gl.uniform1f(this.up.u_gain, this.gain);
    // Light added to paper is invisible, so glints ADD on the tube and sit OVER on paper.
    if (f.face === 'dark') gl.blendFunc(gl.ONE, gl.ONE);
    if (this.count) {
      gl.bindVertexArray(this.pointVao);
      gl.drawArrays(gl.POINTS, 0, this.count);
    }
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const markers = f.markers.slice(0, 4);
    if (markers.length) {
      markers.forEach((m, i) => {
        this.markerData.set([m.xyz[0], m.xyz[1], m.xyz[2], m.w, 0.5, 4], i * 6);
      });
      gl.bindBuffer(gl.ARRAY_BUFFER, this.markerBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.markerData, 0, markers.length * 6);
      gl.bindVertexArray(this.markerVao);
      gl.drawArrays(gl.POINTS, 0, markers.length);
    }
    gl.bindVertexArray(null);
  }

  dispose(): void {
    const { gl } = this;
    if (gl.isContextLost()) return;
    for (const t of [this.ramp, this.fboTex, ...this.slices]) if (t) gl.deleteTexture(t);
    for (const b of [this.pointBuf, this.markerBuf]) if (b) gl.deleteBuffer(b);
    for (const v of [this.empty, this.pointVao, this.markerVao]) if (v) gl.deleteVertexArray(v);
    if (this.fbo) gl.deleteFramebuffer(this.fbo);
    for (const p of [this.volume, this.composite, this.points]) gl.deleteProgram(p);
  }
}
