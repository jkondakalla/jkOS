// vapor.ts — the vaporwave pulsarmap, `detail: 'vapor'` (ALGORITHMS.md §9). An EXPLORATION
// (Jag, 2026-10-15: "a way more vaporwave version … go insane … keep it tied to the music.
// This is an exploration rather than a throwaway"), opt-in beside the default plate.
//
// The data, the timing and the motion are the default's exactly — stage.ts `shapeMesh`,
// `liveWindow`, `lineValues`, `liveAt`: the same balanced lines at 60 a second, snapping on
// their own rows. What is new is everything you SEE, and every bit of it moves by the music
// (vaporSignals.ts), never by a clock:
//
//   the sky      a dusk gradient that brightens with the loudness; stars that twinkle with
//                the treble; a striped retro sun that swells on the bass, its stripes
//                scrolled by the mids
//   the floor    a magenta grid that scrolls with the track (it is laid in the lines' own
//                z) and glows on the beat, over the lines' reflections
//   the lines    neon across the spectrum (cyan → violet → pink → yellow → mint), turning
//                with how bright and how loud the sound is, whitening as they peak
//   the camera   the follow pose, low, swaying as far as the track is loud and punching in
//                on a hit (a drag does not orbit this one — it is a performance, not a map)
//   the screen   bloom, an RGB split on onsets, a VHS tear on the biggest, grain with the
//                treble, scanlines, a CRT curve and a vignette
//
// Its own WebGL: geometry is built per frame on the CPU (the window is ~80 lines × 128
// points), lines are quads expanded in screen space, and the scene goes through a bloom and
// a composite pass. Heavier than the plate by design; a software rasteriser gets the 2-D
// strip (stage.ts SOFTWARE_MAX_TRIANGLES).

import { compileProgram } from '@jkos/scene/gl';
import { createRig, rigView } from '@jkos/scene/math';
import {
  AMPLITUDE, FLOOR_Y, FOV, bandX, fadeOf, followPose, liveAt, lineValues, type Shaped,
} from './stage';
import { stepVapor, vaporState, type VaporState } from './vaporSignals';
import type { PulsarRenderer, RidgeColors, RidgeFrame } from './gl';

/** The neon the lines walk through across the spectrum (and round again as it turns). */
export const VAPOR_NEON = ['#01cdfe', '#b967ff', '#ff71ce', '#fffb96', '#05ffa1', '#01cdfe'];

const NEON = VAPOR_NEON.map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255));
function neon(u: number): number[] {
  const x = (((u % 1) + 1) % 1) * (NEON.length - 1);
  const i = Math.floor(x), f = x - i;
  return NEON[i].map((c, k) => c + (NEON[i + 1][k] - c) * f);
}

const QUAD_VS = `#version 300 es
out vec2 v_uv;
void main() { vec2 p = vec2((gl_VertexID & 1) * 2 - 1, (gl_VertexID >> 1) * 2 - 1); v_uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;

const SKY_FS = `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 o;
uniform float u_horizon, u_seed, u_aspect, u_bass, u_highs, u_loud, u_stripe;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  float y = v_uv.y, hz = u_horizon;
  // The sky breathes with the loudness.
  vec3 top = vec3(0.04, 0.0, 0.14), mid = vec3(0.32, 0.02, 0.5) * (0.7 + 0.5 * u_loud);
  vec3 low = vec3(1.0, 0.16, 0.48) * (0.75 + 0.4 * u_loud), rim = vec3(1.0, 0.55, 0.2);
  float k = clamp((y - hz) / (1.0 - hz), 0.0, 1.0);
  vec3 c = mix(rim, low, smoothstep(0.0, 0.08, k));
  c = mix(c, mid, smoothstep(0.08, 0.45, k));
  c = mix(c, top, smoothstep(0.45, 1.0, k));
  // Stars twinkle with the highs: each on its own seed, as bright as the treble.
  vec2 g = floor(v_uv * vec2(320.0, 140.0));
  float s = hash(g);
  if (s > 0.992 && k > 0.35) c += vec3(0.9, 0.8, 1.0) * (0.15 + 1.2 * u_highs * hash(g + u_seed)) * k;
  // The sun swells on the bass; its stripes are scrolled by the mids.
  float r0 = min(0.24, (1.0 - hz) * 0.42);
  float r = r0 * (1.0 + 0.16 * u_bass);
  vec2 p = vec2((v_uv.x - 0.5) * u_aspect, y - (hz + r0 * 0.55));
  float d = length(p);
  float band = (p.y + r) / (2.0 * r);
  float stripes = step(0.5, fract(band * 9.0 - u_stripe)) + step(0.55, band);
  vec3 sun = mix(vec3(1.0, 0.1, 0.55), vec3(1.0, 0.92, 0.3), smoothstep(0.0, 1.0, band));
  if (d < r && stripes > 0.5) c = mix(c, sun, smoothstep(r, r - 0.004, d));
  c += vec3(1.0, 0.25, 0.6) * exp(-max(0.0, d - r) * 9.0) * (0.25 + 0.9 * u_bass);
  if (y < hz) c = vec3(0.03, 0.0, 0.07);
  o = vec4(c, 1.0);
}`;

const GEO_VS = `#version 300 es
layout(location = 0) in vec3 a_p;
layout(location = 1) in vec3 a_q;      // a line segment's other end; a fill's own point
layout(location = 2) in vec2 a_corner; // end (0|1), side (-1|0|1) — side 0 is a fill vertex
layout(location = 3) in vec4 a_c;
uniform mat4 u_vp; uniform vec2 u_view; uniform float u_width;
out vec4 v_c;
void main() {
  vec4 pa = u_vp * vec4(a_p, 1.0);
  v_c = a_c;
  if (a_corner.y == 0.0) { gl_Position = pa; return; }
  vec4 pb = u_vp * vec4(a_q, 1.0);
  vec2 sa = pa.xy / pa.w * 0.5 * u_view, sb = pb.xy / pb.w * 0.5 * u_view;
  vec2 dir = normalize(sb - sa + 1e-6);
  vec2 n = vec2(-dir.y, dir.x);
  vec4 c = a_corner.x < 0.5 ? pa : pb;
  c.xy += (n * a_corner.y * 0.5 * u_width + dir * (a_corner.x - 0.5) * u_width) / (0.5 * u_view) * c.w;
  gl_Position = c;
}`;
const GEO_FS = `#version 300 es
precision highp float;
in vec4 v_c; out vec4 o;
void main() { o = v_c; }`;

const BRIGHT_FS = `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 o; uniform sampler2D u_t;
void main() { vec3 c = texture(u_t, v_uv).rgb; float l = max(c.r, max(c.g, c.b)); o = vec4(c * smoothstep(0.45, 0.9, l), 1.0); }`;
const BLUR_FS = `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 o; uniform sampler2D u_t; uniform vec2 u_dir;
void main() {
  float w[5] = float[](0.227, 0.194, 0.121, 0.054, 0.016);
  vec3 c = texture(u_t, v_uv).rgb * w[0];
  for (int i = 1; i < 5; i++) { c += texture(u_t, v_uv + u_dir * float(i)).rgb * w[i]; c += texture(u_t, v_uv - u_dir * float(i)).rgb * w[i]; }
  o = vec4(c, 1.0);
}`;
const POST_FS = `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 o;
uniform sampler2D u_scene, u_bloom;
uniform float u_seed, u_beat, u_shift, u_tear, u_tearY, u_highs, u_hit, u_lines;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec2 uv = v_uv - 0.5;
  uv *= 1.0 + 0.09 * dot(uv, uv);                                        // CRT curve
  vec2 q = uv + 0.5;
  if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0) { o = vec4(0.0, 0.0, 0.0, 1.0); return; }
  // A VHS tear only on a big onset, where it landed, decaying with it.
  float inBand = u_tear * smoothstep(0.05, 0.0, abs(q.y - u_tearY));
  q.x += inBand * (hash(vec2(floor(q.y * 140.0), u_seed)) - 0.5) * 0.06;
  q.x += (hash(vec2(floor(q.y * 300.0), u_seed)) - 0.5) * 0.0012 * (0.3 + u_hit);
  vec2 ab = uv * (0.004 + 0.03 * u_hit) + vec2(u_shift, 0.0);              // RGB split on onsets
  vec3 c = vec3(texture(u_scene, q + ab).r, texture(u_scene, q).g, texture(u_scene, q - ab).b);
  vec3 b = vec3(texture(u_bloom, q + ab * 1.5).r, texture(u_bloom, q).g, texture(u_bloom, q - ab * 1.5).b);
  c += b * (1.5 + 1.2 * u_beat);
  c = mix(c, c * vec3(1.05, 0.9, 1.15), 0.5);
  c *= 0.82 + 0.18 * sin(q.y * u_lines * 3.14159);                         // scanlines
  c += (hash(q * 900.0 + u_seed) - 0.5) * (0.03 + 0.08 * u_highs);        // grain, with the treble
  c += inBand * 0.12 * vec3(0.8, 0.9, 1.0);
  c *= 0.35 + 0.65 * smoothstep(0.85, 0.25, length(uv * vec2(1.0, 1.3)));  // vignette
  o = vec4(c, 1.0);
}`;

interface Target { tex: WebGLTexture; fb: WebGLFramebuffer; depth: WebGLRenderbuffer | null; w: number; h: number }

export class VaporRenderer implements PulsarRenderer {
  private gl: WebGL2RenderingContext;
  private sky: WebGLProgram; private geo: WebGLProgram; private bright: WebGLProgram;
  private blur: WebGLProgram; private post: WebGLProgram;
  private vao: WebGLVertexArrayObject; private quadVao: WebGLVertexArrayObject; private buf: WebGLBuffer;
  private scene: Target | null = null; private bloomA: Target | null = null; private bloomB: Target | null = null;
  private mesh: Shaped | null = null;
  private signals: VaporState = vaporState();
  private v: number[] = [];

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.sky = compileProgram(gl, QUAD_VS, SKY_FS);
    this.geo = compileProgram(gl, GEO_VS, GEO_FS);
    this.bright = compileProgram(gl, QUAD_VS, BRIGHT_FS);
    this.blur = compileProgram(gl, QUAD_VS, BLUR_FS);
    this.post = compileProgram(gl, QUAD_VS, POST_FS);
    this.quadVao = gl.createVertexArray()!;
    this.vao = gl.createVertexArray()!;
    this.buf = gl.createBuffer()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    const S = 12 * 4;
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, S, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, S, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, S, 24);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 4, gl.FLOAT, false, S, 32);
    gl.bindVertexArray(null);
  }

  /** A new track: the default's shaped mesh — it must carry a live line (a `motion`). */
  setMesh(mesh: Shaped): void {
    if (!mesh.live || !mesh.detail.balance) throw new Error('pulsarmap: the vapor picture needs a live, balanced mesh');
    this.mesh = mesh;
    this.signals = vaporState();
  }

  private target(old: Target | null, w: number, h: number, depth: boolean): Target {
    const { gl } = this;
    if (old && old.w === w && old.h === h) return old;
    if (old) { gl.deleteTexture(old.tex); gl.deleteFramebuffer(old.fb); if (old.depth) gl.deleteRenderbuffer(old.depth); }
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    let rb: WebGLRenderbuffer | null = null;
    if (depth) {
      rb = gl.createRenderbuffer()!;
      gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);
    }
    return { tex, fb, depth: rb, w, h };
  }

  private fill(a: number[], b: number[], c: number[], ca: number[], cb: number[], cc: number[]): void {
    for (const [p, k] of [[a, ca], [b, cb], [c, cc]] as const) this.v.push(p[0], p[1], p[2], p[0], p[1], p[2], 0, 0, k[0], k[1], k[2], k[3]);
  }

  private seg(a: number[], b: number[], ca: number[], cb: number[]): void {
    const corners: Array<[number, number, number[]]> = [[0, -1, ca], [0, 1, ca], [1, -1, cb], [0, 1, ca], [1, 1, cb], [1, -1, cb]];
    for (const [e, s, k] of corners) this.v.push(a[0], a[1], a[2], b[0], b[1], b[2], e, s, k[0], k[1], k[2], k[3]);
  }

  draw(frame: RidgeFrame, _colors: RidgeColors): void {
    const { gl, mesh } = this;
    const W = frame.width, H = frame.height, dpr = frame.dpr;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const w = frame.window;
    if (!mesh?.live || !mesh.detail.balance || w.lines < 1 || W < 2 || H < 2) return;
    const live = mesh.live, bal = mesh.detail.balance, bands = mesh.bands;
    const t = (w.live + 0.5) * mesh.rowSeconds;            // the time the live line stands for
    const liveZ = w.live * mesh.pitch;
    const fade = fadeOf(mesh.detail);

    const cur = new Float32Array(bands);
    liveAt(live, bands, t, cur);
    const s = stepVapor(this.signals, cur, t, bal);
    const seed = Math.floor(t * 30) % 977;

    // The camera: the follow pose, swaying as far as it is loud, punched in on a hit.
    const pose = followPose(w.live, mesh.pitch, mesh.detail.view);
    const rig = createRig({ target: pose.target, yaw: Math.sin(s.sway) * (0.12 + 0.3 * s.loud),
                            pitch: pose.pitch + Math.sin(s.sway * 0.7) * 0.03,
                            distance: pose.distance - 0.22 * Math.max(s.beat, s.hit) }, {});
    const vp = rigView(rig, W / H, { fov: FOV, near: 0.05, far: 60 }).viewProj as Float32Array;
    const far = [0, FLOOR_Y, liveZ - 55];
    const hy = (vp[1] * far[0] + vp[5] * far[1] + vp[9] * far[2] + vp[13]) / (vp[3] * far[0] + vp[7] * far[1] + vp[11] * far[2] + vp[15]);
    const horizon = hy * 0.5 + 0.5;

    // ── geometry ──
    this.v = [];
    const lines: Array<{ z: number; v: Float32Array; live: boolean }> = [];
    for (let l = w.start; l <= w.newest; l++) {
      const vals = new Float32Array(bands);
      lineValues(mesh, l, vals);
      lines.push({ z: l * mesh.pitch, v: vals, live: false });
    }
    lines.push({ z: liveZ, v: cur, live: true });
    const rise = mesh.detail.rise ?? 0;
    const pt = (L: { z: number; v: Float32Array }, b: number, mirror: boolean) => {
      const y = (L.v[b] / 255) * AMPLITUDE + rise * (liveZ - L.z);
      return [bandX(b, bands) * 1.25, mirror ? 2 * FLOOR_Y - y : y, L.z];
    };
    const turn = s.hue + (s.centroid - 0.35) * 0.6;          // brighter sound → further round
    const colourAt = (b: number, L: { v: Float32Array; live: boolean }, alpha: number) => {
      const c = neon((b / (bands - 1)) * 0.85 + turn);
      const crest = Math.min(1, Math.max(0, (L.v[b] - bal.rest) / bal.swing));
      const white = L.live ? 0.35 + 0.65 * crest : 0.45 * crest * crest;
      const k = (L.live ? 1.4 : 0.85) * (1 + 0.3 * s.beat);
      return [(c[0] + (1 - c[0]) * white) * k, (c[1] + (1 - c[1]) * white) * k, (c[2] + (1 - c[2]) * white) * k, alpha];
    };
    const alphaOf = (z: number) => 1 - Math.min(1, Math.max(0, (liveZ - z - fade.near) / (fade.far - fade.near)));

    const marks = [0];
    for (const L of lines) {                                   // 1. reflections
      const a = alphaOf(L.z) * (0.15 + 0.35 * s.loud);
      if (a > 0.01) for (let b = 0; b < bands - 1; b++) this.seg(pt(L, b, true), pt(L, b + 1, true), colourAt(b, L, a), colourAt(b + 1, L, a));
    }
    marks.push(this.v.length);
    {                                                          // 2. the floor, over them
      const y = FLOOR_Y - 0.0005, z0 = liveZ + 4, z1 = liveZ - 60, c = [0.05, 0.0, 0.1, 0.72];
      this.fill([-30, y, z0], [30, y, z0], [-30, y, z1], c, c, c);
      this.fill([30, y, z0], [30, y, z1], [-30, y, z1], c, c, c);
    }
    marks.push(this.v.length);
    {                                                          // 3. the grid: in the lines' own z, so it scrolls with the track
      const y = FLOOR_Y, step = 0.22;
      const g = (z: number) => {
        const f = Math.max(0, 1 - (liveZ - z) / 22);
        return [0.6 + 0.6 * s.beat, 0.15, 0.85 * (0.7 + 0.5 * s.beat), f * 0.9];
      };
      for (let i = -60; i <= 60; i++) this.seg([i * step, y, liveZ + 4], [i * step, y, liveZ - 40], g(liveZ + 4), g(liveZ - 40));
      const off = liveZ % step;
      for (let n = -18; n < 160; n++) {
        const z = liveZ - n * step + off - step;
        if (z <= liveZ + 4) this.seg([-14, y, z], [14, y, z], g(z), g(z));
      }
    }
    marks.push(this.v.length);
    for (const L of lines) {                                   // 4. curtains
      const a = alphaOf(L.z);
      if (a <= 0.01) continue;
      const top = [0.07, 0.0, 0.13, a], bot = [0.0, 0.0, 0.02, a];
      for (let b = 0; b < bands - 1; b++) {
        const p = pt(L, b, false), q = pt(L, b + 1, false);
        this.fill(p, q, [p[0], FLOOR_Y, p[2]], top, top, bot);
        this.fill(q, [q[0], FLOOR_Y, q[2]], [p[0], FLOOR_Y, p[2]], top, bot, bot);
      }
    }
    marks.push(this.v.length);
    for (const L of lines) {                                   // 5. the neon lines
      const a = alphaOf(L.z);
      if (a > 0.01) for (let b = 0; b < bands - 1; b++) this.seg(pt(L, b, false), pt(L, b + 1, false), colourAt(b, L, a), colourAt(b + 1, L, a));
    }
    marks.push(this.v.length);

    // ── the scene ──
    this.scene = this.target(this.scene, W, H, true);
    this.bloomA = this.target(this.bloomA, Math.max(1, W >> 1), Math.max(1, H >> 1), false);
    this.bloomB = this.target(this.bloomB, Math.max(1, W >> 1), Math.max(1, H >> 1), false);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.scene.fb);
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 1); gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
    const u = (p: WebGLProgram, n: string) => gl.getUniformLocation(p, n);
    gl.useProgram(this.sky); gl.bindVertexArray(this.quadVao);
    gl.uniform1f(u(this.sky, 'u_horizon'), horizon); gl.uniform1f(u(this.sky, 'u_seed'), seed);
    gl.uniform1f(u(this.sky, 'u_aspect'), W / H); gl.uniform1f(u(this.sky, 'u_bass'), Math.min(1.2, s.bass));
    gl.uniform1f(u(this.sky, 'u_highs'), Math.min(1, s.highs)); gl.uniform1f(u(this.sky, 'u_loud'), s.loud);
    gl.uniform1f(u(this.sky, 'u_stripe'), s.stripe);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    gl.useProgram(this.geo); gl.bindVertexArray(this.vao); gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(this.v), gl.STREAM_DRAW);
    gl.uniformMatrix4fv(u(this.geo, 'u_vp'), false, vp); gl.uniform2f(u(this.geo, 'u_view'), W, H);
    const range = (i: number): [number, number] => [marks[i] / 12, (marks[i + 1] - marks[i]) / 12];
    const width = (px: number) => gl.uniform1f(u(this.geo, 'u_width'), px * dpr);
    gl.enable(gl.BLEND);
    // CSS px: thin, because the bloom makes the glow (measured against a 390-px strip).
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE); width(0.5); gl.drawArrays(gl.TRIANGLES, ...range(0));
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); width(0); gl.drawArrays(gl.TRIANGLES, ...range(1));
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE); width(0.45); gl.drawArrays(gl.TRIANGLES, ...range(2));
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(2, 2);
    width(0); gl.drawArrays(gl.TRIANGLES, ...range(3));
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.depthMask(false); gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    width(0.7); gl.drawArrays(gl.TRIANGLES, ...range(4));
    gl.depthMask(true); gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);

    // ── bloom, then the composite to the screen ──
    gl.bindVertexArray(this.quadVao);
    const pass = (p: WebGLProgram, dst: Target | null, src: WebGLTexture, dir?: [number, number]) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst ? dst.fb : null);
      gl.viewport(0, 0, dst ? dst.w : W, dst ? dst.h : H);
      gl.useProgram(p);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src);
      gl.uniform1i(u(p, 'u_t'), 0);
      if (dir) gl.uniform2f(u(p, 'u_dir'), dir[0], dir[1]);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };
    pass(this.bright, this.bloomA, this.scene.tex);
    for (let i = 0; i < 3; i++) {
      const k = 1 + i * 1.5;
      pass(this.blur, this.bloomB, this.bloomA.tex, [k / this.bloomA.w, 0]);
      pass(this.blur, this.bloomA, this.bloomB.tex, [0, k / this.bloomA.h]);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.useProgram(this.post);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.scene.tex); gl.uniform1i(u(this.post, 'u_scene'), 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.bloomA.tex); gl.uniform1i(u(this.post, 'u_bloom'), 1);
    gl.uniform1f(u(this.post, 'u_seed'), seed); gl.uniform1f(u(this.post, 'u_beat'), s.beat);
    gl.uniform1f(u(this.post, 'u_shift'), s.hit > 0.4 ? 0.005 * s.hit * (seed % 2 ? 1 : -1) : 0);
    gl.uniform1f(u(this.post, 'u_tear'), s.tear); gl.uniform1f(u(this.post, 'u_tearY'), s.tearY);
    gl.uniform1f(u(this.post, 'u_highs'), Math.min(1, s.highs)); gl.uniform1f(u(this.post, 'u_hit'), s.hit);
    gl.uniform1f(u(this.post, 'u_lines'), H / Math.max(1, dpr));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.activeTexture(gl.TEXTURE0);
  }

  dispose(): void {
    const { gl } = this;
    if (gl.isContextLost()) return;
    for (const t of [this.scene, this.bloomA, this.bloomB]) {
      if (!t) continue;
      gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fb);
      if (t.depth) gl.deleteRenderbuffer(t.depth);
    }
    gl.deleteBuffer(this.buf); gl.deleteVertexArray(this.vao); gl.deleteVertexArray(this.quadVao);
    for (const p of [this.sky, this.geo, this.bright, this.blur, this.post]) gl.deleteProgram(p);
  }
}
