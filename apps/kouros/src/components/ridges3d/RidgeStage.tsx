import { useEffect, useRef } from 'react';
import { tokenColor } from '@jkos/scene/gl';
import { DEG, createRig, cutRig, rigView, stepRig } from '@jkos/scene/math';
import { useOrbitControls, useScene } from '@jkos/scene/react';
import { scrollRow } from '../pulsarmap';
import { RidgeRenderer, type RidgeColors } from './gl';
import {
  FOLLOW_DISTANCE, FOLLOW_PITCH, FOV, LOOK_BEHIND, ORBIT, RETURN_OMEGA, TARGET_Y, followPose, visibleWindow,
} from './stage';

/**
 * The pulsarmap in 3-D (ALGORITHMS.md §9, TODO.md §2): the same ridgelines, stood up
 * in space, FLOWING — ~10.8 rows a second arrive at the front and the stack streams
 * back at the track's own rate, a visualizer of the music from the music's own
 * analysis. A drag orbits it and a release springs home.
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
  /** WebGL2 is not available, or the context could not be made: draw in 2-D. */
  onUnsupported: () => void;
}

export default function RidgeStage({
  trackId, bytes, rows, bands, rowSeconds, position, livePosition, playing, onUnsupported,
}: RidgeStageProps) {
  const colorsRef = useRef<RidgeColors>(COLOR_FALLBACK);

  // What the loop reads — refs, so a new position is one assignment, not a re-render
  // of anything but this component's props.
  const liveRef = useRef({ position, livePosition, playing, rowSeconds, rows, trackId });
  liveRef.current = { position, livePosition, playing, rowSeconds, rows, trackId };
  const meshRef = useRef({ bytes, rows, bands });
  meshRef.current = { bytes, rows, bands };

  // The follow pose is the rig's HOME. Its target rides the playhead EXACTLY (cut
  // every frame — a spring would only lag the music), and yaw and pitch spring back to
  // it whenever no hand holds them.
  const rig = useRef(createRig(
    { target: [0, TARGET_Y, -LOOK_BEHIND], yaw: 0, pitch: FOLLOW_PITCH, distance: FOLLOW_DISTANCE },
    { omega: { yaw: RETURN_OMEGA, pitch: RETURN_OMEGA } },
  )).current;

  const scene = useScene<RidgeRenderer>({
    name: 'kouros pulsarmap',
    attributes: { antialias: true, alpha: false, depth: true, powerPreference: 'low-power' },
    create: (gl) => {
      const renderer = new RidgeRenderer(gl);
      const m = meshRef.current;
      renderer.setMesh(m.bytes, m.rows, m.bands);
      return renderer;
    },
    // A face change (paper ↔ tube, or a sleeve accent) re-resolves the tokens.
    onTheme: (el) => {
      colorsRef.current = {
        surface: tokenColor(el, '--kr-pulsar-surface', COLOR_FALLBACK.surface),
        line: tokenColor(el, '--kr-pulsar-line', COLOR_FALLBACK.line),
        far: tokenColor(el, '--kr-pulsar-far', COLOR_FALLBACK.far),
      };
    },
    onUnsupported,
    frame: ({ renderer, canvas, dt, reduced, aspect, dpr }) => {
      const live = liveRef.current;
      const t = live.livePosition ? live.livePosition() : live.position;
      const win = visibleWindow(t, live.rowSeconds, live.rows);
      const pose = followPose(scrollRow(t, live.rowSeconds, live.rows));
      rig.targetGoal = pose.target;
      cutRig(rig, 'target');
      const moving = stepRig(rig, dt, reduced);
      const view = rigView(rig, aspect, LENS);
      renderer.draw({ viewProj: view.viewProj, window: win, focusZ: pose.focusZ,
                      width: canvas.width, height: canvas.height, dpr }, colorsRef.current);
      // A playing track flows every frame; paused, only a spring can still move.
      return moving || (!!live.playing && !!live.livePosition);
    },
  });

  // ── A new track: one texture upload ─────────────────────────────────────────────
  const firstMesh = useRef(true);
  useEffect(() => {
    if (firstMesh.current) { firstMesh.current = false; return; }
    const renderer = scene.renderer();
    if (!renderer) return;
    try {
      renderer.setMesh(bytes, rows, bands);
    } catch (err) {
      console.warn(`[kouros pulsarmap] mesh refused: ${(err as Error).message}`);
    }
    scene.kick();
  }, [bytes, rows, bands, scene]);

  // ── Time moved, or play began (a pause moves nothing and draws nothing) ───────
  useEffect(() => { scene.kick(); }, [position, playing, rowSeconds, trackId, scene]);

  const orbit = useOrbitControls(rig, scene.kick, { ...ORBIT, keyYaw: 12 * DEG, keyPitch: 6 * DEG });

  return (
    <canvas
      ref={scene.canvasRef}
      className="kr-pulsar-canvas kr-pulsar-3d"
      data-owns-pointer=""
      tabIndex={0}
      role="application"
      aria-roledescription="3-D spectrogram"
      aria-label={`Spectrogram of this track, flowing as it plays — ${rows} slices of ` +
                  `${Math.round(rowSeconds * 1000)} ms each. ` +
                  'Drag, or use the arrow keys, to look around; Escape returns to following the music.'}
      onPointerDown={orbit.onPointerDown}
      onKeyDown={orbit.onKeyDown}
    />
  );
}
