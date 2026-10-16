import { useEffect, useMemo, useRef } from 'react';
import { rendererName, tokenColor } from '@jkos/scene/gl';
import { DEG, createRig, cutRig, isSoftwareRenderer, rigView, stepRig } from '@jkos/scene/math';
import { useOrbitControls, useScene } from '@jkos/scene/react';
import { RidgeRenderer, type PulsarRenderer, type RidgeColors } from './gl';
import { VaporRenderer } from './vapor';
import { paletteFromPixels } from './coverPalette';
import { coverPixels } from '../../player/accent';
import {
  DETAIL, FOV, ORBIT, PITCH, RETURN_OMEGA, SOFTWARE_MAX_TRIANGLES, followPose, liveWindow, shapeMesh, trianglesOf, type DetailName,
} from './stage';

/**
 * The pulsarmap in 3-D (ALGORITHMS.md §9): a LIVE line held still at the front,
 * moving every frame; behind it a snapshot of that line every ~93 ms row, streaming
 * back at the track's own rate, joined into a lit terrain — a visualizer of the music
 * from the music's own analysis. A drag orbits it and a release springs home.
 *
 * ⚠️ **THE REVEAL IS STILL `currentTime`, NEVER A TIMER — READ EVERY FRAME.** While
 * the track plays, each frame reads the media element's own time through
 * `livePosition` (@jkos/player); the ~4 Hz `position` prop alone would move the
 * picture in 250 ms jumps, three rows at a time. rAF's clock (@jkos/scene's
 * `useScene`) drives only the orbit's springs — presentation, never which rows exist
 * or where the stack stands. Paused, the time does not move, and once the springs
 * settle no frame is drawn at all.
 *
 * ⚠️ **IT OWNS ITS POINTER.** `data-owns-pointer` tells Now Playing's rune layer that
 * a stroke starting here is an orbit, not a transport gesture — the same guard the
 * scrubber relies on, for the same reason: two engines armed on one pointer fight
 * over one drag, and the symptom looks like a bug in whichever one loses.
 *
 * The canvas's life, the camera rig and the orbit gesture are @jkos/scene's; the
 * geometry and the follow framing are `./stage.ts`, pure and gated.
 */

const COLOR_FALLBACK: RidgeColors = {
  surface: [0.067, 0.063, 0.051],
  line: [0.937, 0.902, 0.788],
  far: [0.369, 0.29, 0.149],
};

const LENS = { fov: FOV, near: 0.05, far: 30 };

/** The face's three colours, read off the element. A sleeve's palette, when a detail
 *  takes one, is drawn instead once it has loaded (`cover`, below). */
function readColors(el: HTMLElement): RidgeColors {
  return {
    surface: tokenColor(el, '--kr-pulsar-surface', COLOR_FALLBACK.surface),
    line: tokenColor(el, '--kr-pulsar-line', COLOR_FALLBACK.line),
    far: tokenColor(el, '--kr-pulsar-far', COLOR_FALLBACK.far),
  };
}

export interface RidgeStageProps {
  trackId: number;
  bytes: Uint8Array;
  rows: number;
  bands: number;
  /** From the mesh, never a constant — see pulsarmap.ts `revealIndex`. */
  rowSeconds: number;
  /** The player's published position (~4 Hz) — the fallback clock, and the kick. */
  position: number;
  /** The media element's time, read at call time — what every frame of a PLAYING
   *  track is positioned by. */
  livePosition?: () => number;
  playing?: boolean;
  /** The playing cover — a `palette: 'cover'` detail takes every colour from it. */
  coverUrl?: string;
  /** `low` (the default): the Unknown Pleasures plate, live — separate lines climbing back
   *  and fading, coloured from the sleeve. `high`: every stored band and row, splined —
   *  the smooth lit terrain. stage.ts `DETAIL`. */
  detail?: DetailName;
  /** WebGL2 is not available, or the context could not be made: draw in 2-D. */
  onUnsupported: () => void;
}

export default function RidgeStage({
  trackId, bytes, rows, bands, rowSeconds, position, livePosition, playing, detail = 'low', coverUrl, onUnsupported,
}: RidgeStageProps) {
  const colorsRef = useRef<RidgeColors>(COLOR_FALLBACK);

  // What the loop reads — refs, so a new position is one assignment, not a re-render
  // of anything but this component's props.
  // The mesh in its detail — pooled once per track, never per frame.
  const shaped = useMemo(() => shapeMesh(bytes, rows, bands, rowSeconds, DETAIL[detail]),
                         [bytes, rows, bands, rowSeconds, detail]);
  const liveRef = useRef({ position, livePosition, playing, trackId, shaped });
  liveRef.current = { position, livePosition, playing, trackId, shaped };

  // The follow pose is the rig's HOME. Its target rides the playhead EXACTLY (cut
  // every frame — a spring would only lag the music), and yaw and pitch spring back to
  // it whenever no hand holds them.
  // A detail may frame it its own way (stage.ts Detail.view); the rig starts there.
  const rig = useRef(createRig(
    (({ target, yaw, pitch, distance }) => ({ target, yaw, pitch, distance }))(
      followPose(0, PITCH, DETAIL[detail].view)),
    { omega: { yaw: RETURN_OMEGA, pitch: RETURN_OMEGA } },
  )).current;

  // ⚠️ The renderer is chosen ONCE, at mount: Pulsarmap keys this component on it, so a
  // switch to or from `vapor` remounts rather than swapping programs inside one context.
  const vapor = useRef(detail === 'vapor').current;
  const scene = useScene<PulsarRenderer>({
    name: 'kouros pulsarmap',
    attributes: { antialias: true, alpha: false, depth: true, powerPreference: 'low-power' },
    create: (gl) => {
      // ⚠️ A CPU rasteriser is a WebGL2 context like any other, and pays per triangle:
      // the smooth terrain is ~190k a frame, 60 fps on any GPU and ~2 on SwiftShader.
      // Over the budget (stage.ts SOFTWARE_MAX_TRIANGLES) it is refused here, and
      // `onUnsupported` mounts the 2-D strip, which a CPU draws easily.
      const m = liveRef.current.shaped;
      const name = rendererName(gl);
      if (trianglesOf(m) > SOFTWARE_MAX_TRIANGLES && isSoftwareRenderer(name)) {
        throw new Error(`a software rasteriser (${name}) — the 2-D strip draws instead`);
      }
      const renderer: PulsarRenderer = vapor ? new VaporRenderer(gl) : new RidgeRenderer(gl);
      renderer.setMesh(m);
      return renderer;
    },
    // A face change (paper ↔ tube, or a sleeve accent) re-resolves the tokens.
    onTheme: (el) => {
      colorsRef.current = { ...readColors(el), cover: colorsRef.current.cover };
    },
    onUnsupported,
    frame: ({ renderer, canvas, dt, reduced, aspect, dpr }) => {
      const live = liveRef.current;
      const t = live.livePosition ? live.livePosition() : live.position;
      const m = live.shaped;
      const win = liveWindow(t, m.rowSeconds, m.rows, m.visible);
      const pose = followPose(win.live, m.pitch, m.detail.view);
      rig.targetGoal = pose.target;
      rig.pitchGoal = pose.pitch;
      rig.distanceGoal = pose.distance;
      cutRig(rig, 'target');
      const moving = stepRig(rig, dt, reduced);
      const view = rigView(rig, aspect, LENS);
      renderer.draw({ viewProj: view.viewProj, window: win, focusZ: pose.focusZ,
                      width: canvas.width, height: canvas.height, dpr }, colorsRef.current);
      // A playing track flows every frame; paused, only a spring can still move.
      return moving || (!!live.playing && !!live.livePosition);
    },
  });

  // ── The sleeve's colours follow the sleeve ───────────────────────────────────────
  // Every colour of a `palette: 'cover'` detail is the playing cover's (coverPalette.ts),
  // read from the same downsampled draw the app's accent is (player/accent.ts). A late
  // answer for the previous cover is dropped; a cover that cannot be read leaves the
  // face's tokens drawing.
  useEffect(() => {
    if (shaped.detail.palette !== 'cover' || !coverUrl) {
      colorsRef.current = { ...colorsRef.current, cover: undefined };
      scene.kick();
      return;
    }
    let current = true;
    coverPixels(coverUrl)
      .then((px) => {
        if (!current) return;
        colorsRef.current = { ...colorsRef.current, cover: px ? paletteFromPixels(px) : undefined };
        scene.kick();
      })
      .catch(() => {
        if (!current) return;
        colorsRef.current = { ...colorsRef.current, cover: undefined };
        scene.kick();
      });
    return () => { current = false; };
  }, [coverUrl, shaped.detail.palette, scene]);

  // ── A new track or detail: one texture upload ───────────────────────────────────
  const firstMesh = useRef(true);
  useEffect(() => {
    if (firstMesh.current) { firstMesh.current = false; return; }
    const renderer = scene.renderer();
    if (!renderer) return;
    try {
      renderer.setMesh(shaped);
    } catch (err) {
      console.warn(`[kouros pulsarmap] mesh refused: ${(err as Error).message}`);
    }
    scene.kick();
  }, [shaped, scene]);

  // ── Time moved, or play began (a pause moves nothing and draws nothing) ───────
  useEffect(() => { scene.kick(); }, [position, playing, shaped, trackId, scene]);

  const orbit = useOrbitControls(rig, scene.kick, { ...ORBIT, keyYaw: 12 * DEG, keyPitch: 6 * DEG });

  return (
    <canvas
      ref={scene.canvasRef}
      className="kr-pulsar-canvas kr-pulsar-3d"
      data-owns-pointer=""
      tabIndex={0}
      role="application"
      aria-roledescription="3-D spectrogram"
      aria-label={`Spectrogram of this track, flowing as it plays — ${shaped.rows} slices of ` +
                  `${Math.round(shaped.rowSeconds * 1000)} ms each. ` +
                  'Drag, or use the arrow keys, to look around; Escape returns to following the music.'}
      onPointerDown={orbit.onPointerDown}
      onKeyDown={orbit.onKeyDown}
    />
  );
}
