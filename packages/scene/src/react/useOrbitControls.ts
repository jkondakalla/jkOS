import { useRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { usePointerDrag, DRAG_THRESHOLD_PX } from '@jkos/ui';
import { clamp } from '../math/motion';
import { orbitDrag, type OrbitDragLimits, type OrbitRig } from '../math/rig';

/**
 * useOrbitControls — drag to look around a scene, let go and it springs home.
 *
 *   const rig = useRef(createRig(home, { omega: { yaw: 7, pitch: 7 } })).current;
 *   const orbit = useOrbitControls(rig, scene.kick, { ...limits, keyYaw: 12 * DEG, keyPitch: 6 * DEG });
 *   <canvas ref={scene.canvasRef} data-owns-pointer="" tabIndex={0} {...orbit} />
 *
 * A drag orbits the rig from the angles it started at (`orbitDrag`, clamped); while it
 * lasts the rig is HELD and its yaw and pitch are the hand's. On release the rig lets
 * go, and its springs carry it back to its goals — the home pose. Arrow keys step the
 * orbit and HOLD it there (a keyboard has no "release"); Escape lets go.
 *
 * ⚠️ **ONE GESTURE ENGINE.** Pointer handling is @jkos/ui's `usePointerDrag`, as every
 * gesture surface in the suite is (check:drag lists this file as a consumer). A 3-D
 * view does not grow its own pointer code.
 *
 * ⚠️ **A CANVAS INSIDE A GESTURE-OWNING SURFACE MUST SAY IT OWNS ITS POINTER** —
 * `data-owns-pointer` on the element, the guard KourOS's rune layer and scrubber rely
 * on. Two engines armed on one pointer fight over one drag, and the symptom looks like
 * a bug in whichever one loses.
 */

export interface OrbitControlOptions extends OrbitDragLimits {
  /** Yaw per arrow-key press, radians. */
  keyYaw: number;
  /** Pitch per arrow-key press, radians. */
  keyPitch: number;
  /** CSS px a press travels before it is a drag (default: the suite's threshold). */
  threshold?: number;
}

export interface OrbitControls {
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
}

export function useOrbitControls(rig: OrbitRig, kick: () => void, options: OrbitControlOptions): OrbitControls {
  const drag = usePointerDrag();
  const opts = useRef(options);
  opts.current = options;
  const st = useRef({ dragging: false, keyHeld: false, start: { yaw: 0, pitch: 0 } });

  const hold = () => { rig.held = st.current.dragging || st.current.keyHeld; };

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    drag.begin(e, {
      activation: { kind: 'distance', threshold: opts.current.threshold ?? DRAG_THRESHOLD_PX },
      onActivate: () => {
        const s = st.current;
        s.dragging = true;
        s.keyHeld = false;
        s.start = { yaw: rig.yaw.x, pitch: rig.pitch.x };
        hold();
        kick();
      },
      onMove: (ctx) => {
        const o = orbitDrag(st.current.start, ctx.dx, ctx.dy, opts.current);
        rig.yaw = { x: o.yaw, v: 0 };
        rig.pitch = { x: o.pitch, v: 0 };
        kick();
      },
      onEnd: () => { st.current.dragging = false; hold(); kick(); },
      onCancel: () => { st.current.dragging = false; hold(); kick(); },
    });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const o = opts.current;
    const step = ({
      ArrowLeft: [-o.keyYaw, 0], ArrowRight: [o.keyYaw, 0], ArrowUp: [0, -o.keyPitch], ArrowDown: [0, o.keyPitch],
    } as Record<string, [number, number]>)[e.key];
    if (step) {
      e.preventDefault();
      st.current.keyHeld = true;
      hold();
      const yaw = rig.yaw.x + step[0];
      rig.yaw = { x: o.maxYaw != null ? clamp(yaw, -o.maxYaw, o.maxYaw) : yaw, v: 0 };
      rig.pitch = { x: clamp(rig.pitch.x + step[1], o.minPitch, o.maxPitch), v: 0 };
      kick();
    } else if (e.key === 'Escape' && st.current.keyHeld) {
      e.preventDefault();
      st.current.keyHeld = false;
      hold();
      kick();
    }
  };

  return { onPointerDown, onKeyDown };
}
