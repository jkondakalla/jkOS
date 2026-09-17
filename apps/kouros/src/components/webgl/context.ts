// context.ts — the DOM half both WebGL views share: feature detection, program
// compile/link with the log surfaced, device-pixel sizing, context loss, colour
// tokens read off the element, and the motion preference.
//
// ⚠️ **A LOST CONTEXT IS A NORMAL EVENT ON A PHONE, NOT A CRASH.** Backgrounding the
// PWA, a GPU reset, or another tab hogging memory can all take the context away,
// and every GL object made before it is gone. `watchContext` calls
// `preventDefault()` on the loss (without it the browser never offers a restore)
// and hands both edges to the caller, which rebuilds from its own data.
//
// ⚠️ **COLOURS COME FROM THE DESIGN FACTORY, RESOLVED BY THE BROWSER.** A custom
// property's computed value is its token text — `color-mix(...)`, `var(...)`
// already substituted, whatever the face declares — not an rgb triple. So a probe
// element is given the token as its `color` and the browser resolves it; the parse
// below accepts both `rgb()` and `color(srgb …)`, which is what Chromium reports for
// a `color-mix`. Copying hex values here would fork the palette the moment a face
// changed.

let webgl2: boolean | null = null;

/** Whether this browser can make a WebGL2 context at all. Cached: creating a probe
 *  context per mount costs a GPU allocation and counts toward the context limit. */
export function hasWebGL2(): boolean {
  if (webgl2 !== null) return webgl2;
  try {
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl2');
    webgl2 = !!gl;
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    webgl2 = false;
  }
  return webgl2;
}

export function compileProgram(gl: WebGL2RenderingContext, vertex: string, fragment: string): WebGLProgram {
  const shader = (type: number, src: string) => {
    const s = gl.createShader(type);
    if (!s) throw new Error('webgl: createShader failed');
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) {
      const log = gl.getShaderInfoLog(s);
      gl.deleteShader(s);
      throw new Error(`webgl: ${type === gl.VERTEX_SHADER ? 'vertex' : 'fragment'} shader: ${log}`);
    }
    return s;
  };
  const vs = shader(gl.VERTEX_SHADER, vertex);
  const fs = shader(gl.FRAGMENT_SHADER, fragment);
  const program = gl.createProgram();
  if (!program) throw new Error('webgl: createProgram failed');
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) {
    throw new Error(`webgl: link: ${gl.getProgramInfoLog(program)}`);
  }
  return program;
}

/** Uniform locations by name, looked up once. A name the compiler optimised away
 *  maps to null, and `gl.uniform*` on null is a harmless no-op. */
export function uniforms<T extends string>(gl: WebGL2RenderingContext, program: WebGLProgram,
                                           names: readonly T[]): Record<T, WebGLUniformLocation | null> {
  const out = {} as Record<T, WebGLUniformLocation | null>;
  for (const n of names) out[n] = gl.getUniformLocation(program, n);
  return out;
}

/** Device pixels per CSS pixel, capped at 2: a DPR-3 phone rendering at 3× draws
 *  2.25× the fragments of 2× for a difference nobody sees on a 400-px-wide view. */
export function devicePixelRatioCapped(cap = 2): number {
  return Math.min(cap, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
}

/** Size the drawing buffer to the canvas's CSS box × DPR × `scale`. Returns true
 *  when the buffer changed (and therefore every framebuffer sized from it). */
export function sizeCanvas(canvas: HTMLCanvasElement, scale = 1): boolean {
  const dpr = devicePixelRatioCapped();
  const w = Math.max(1, Math.round((canvas.clientWidth || 1) * dpr * scale));
  const h = Math.max(1, Math.round((canvas.clientHeight || 1) * dpr * scale));
  if (canvas.width === w && canvas.height === h) return false;
  canvas.width = w;
  canvas.height = h;
  return true;
}

export function watchContext(canvas: HTMLCanvasElement, onLost: () => void, onRestored: () => void): () => void {
  const lost = (e: Event) => { e.preventDefault(); onLost(); };
  const restored = () => onRestored();
  canvas.addEventListener('webglcontextlost', lost);
  canvas.addEventListener('webglcontextrestored', restored);
  return () => {
    canvas.removeEventListener('webglcontextlost', lost);
    canvas.removeEventListener('webglcontextrestored', restored);
  };
}

export type RGB = [number, number, number];

/** Parse what `getComputedStyle(el).color` reports into 0–1 channels. */
export function parseColor(text: string): RGB | null {
  const t = text.trim();
  let m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(t);
  if (m) return [Number(m[1]) / 255, Number(m[2]) / 255, Number(m[3]) / 255];
  m = /^color\(\s*srgb\s+([\d.e+-]+)\s+([\d.e+-]+)\s+([\d.e+-]+)/i.exec(t);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])].map((v) => Math.min(1, Math.max(0, v))) as RGB;
  m = /^#([0-9a-f]{6})$/i.exec(t);
  if (m) return [0, 2, 4].map((i) => parseInt(m![1].slice(i, i + 2), 16) / 255) as RGB;
  return null;
}

/** Resolve a CSS custom property on `el` to an RGB triple, through the browser. */
export function tokenColor(el: HTMLElement, name: string, fallback: RGB): RGB {
  const probe = document.createElement('span');
  probe.style.display = 'none';
  probe.style.color = `var(${name})`;
  el.appendChild(probe);
  const resolved = parseColor(getComputedStyle(probe).color);
  probe.remove();
  return resolved ?? fallback;
}

/** The OS setting OR the suite's `[data-motion="static"]` — either one means no
 *  coasting, no idle drift, and cuts instead of flights. */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  if (document.documentElement.dataset.motion === 'static') return true;
  return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/** Calls `onChange(visible)` when the element scrolls in or out of view or the page
 *  is hidden — so a render loop can stop drawing what nobody can see. */
export function watchVisibility(el: Element, onChange: (visible: boolean) => void): () => void {
  let inView = true;
  const emit = () => onChange(inView && !document.hidden);
  const io = typeof IntersectionObserver !== 'undefined'
    ? new IntersectionObserver((entries) => { inView = entries.some((e) => e.isIntersecting); emit(); })
    : null;
  io?.observe(el);
  document.addEventListener('visibilitychange', emit);
  return () => {
    io?.disconnect();
    document.removeEventListener('visibilitychange', emit);
  };
}
