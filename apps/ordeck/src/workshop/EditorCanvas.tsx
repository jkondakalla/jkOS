/**
 * workshop/EditorCanvas.tsx — the direct-manipulation widget canvas.
 *
 * Renders the widget-under-construction as a real card (same .hud-card chrome,
 * same primitive renderers, live ctx data) with every node wrapped in a hit
 * target. The gesture grammar, all through @jkos/ui's usePointerDrag:
 *
 *   tap                → select (inspector shows its properties)
 *   right-click        → context menu (add compatible primitives here, node ops)
 *   touch long-hold    → same menu (the touch "right-click")
 *   hold-then-move /
 *   mouse drag         → move the node; drop lines show where it lands
 *   edge/corner drag   → resize the widget footprint in grid units (per tier)
 *
 * Node content is inert while editing (.wc-leaf kills pointer-events) so taps
 * always hit the wrapper, and wrappers set touch-action:none so a touch drag
 * never fights page scroll (the HudGrid edit-mode pattern). Containers render
 * with light editor chrome: stacks/rows/forms are labeled boxes, a list shows
 * its item template bound to the first real array element, a when shows BOTH
 * branches with the live one marked — you can't edit what's hidden.
 *
 * The tree is rendered through plain function recursion (not nested component
 * definitions), so per-pointermove state changes reconcile in place instead of
 * remounting the whole card.
 */

import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { usePointerDrag, DRAG_THRESHOLD_PX, HOLD_MS, HOLD_CANCEL_PX } from '@jkos/ui';
import { renderNode, resolve, truthy, type Scope } from '../hud/registry';
import {
  bindingLabel, canInsert, catalogEntry, enToNode, findEn, findPlace, isInside, isKidContainer, newNode,
  type ENode, type NodeT,
} from './model';

/* ── canvas grid metrics ──────────────────────────────────────────────────
 * The HUD resolves grid units against the live container width; the canvas
 * previews at a fixed nominal column width per tier so resize math is stable.
 * Row height and gap are the HudGrid constants. */
export const TIERS = {
  desktop: { cols: 12, colW: 88 },
  mobile: { cols: 2, colW: 150 },
} as const;
export type TierName = keyof typeof TIERS;
export const ROW_H = 44;
export const GAP = 18;
export const unitsToPx = (units: number, unitPx: number): number => units * unitPx + (units - 1) * GAP;

const MAX_H = 40;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const cx = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(' ');

export interface GhostAdd { t: NodeT; parentId: string; index: number }
interface DropTarget { parentId: string; index: number }
interface DragState { id: string; label: string; x: number; y: number }

export interface EditorCanvasProps {
  root: ENode;
  scope: Scope;
  /** Card chrome captions; null renders frameless (lone molecule). */
  frame: { eyebrow: string; source: string } | null;
  tier: TierName;
  size: { w: number; h: number };
  /** Selected node id (the root id = the widget itself). */
  selection: string | null;
  ghost: GhostAdd | null;
  onSelect: (id: string) => void;
  /** Open the context menu at stage-relative coords, targeting a node. */
  onOpenMenu: (pt: { x: number; y: number }, targetId: string) => void;
  onMoveNode: (id: string, parentId: string, index: number) => void;
  /** Live while an edge handle drags; commit=true on release (one undo step). */
  onResize: (w: number, h: number, commit: boolean) => void;
}

export function EditorCanvas({
  root, scope, frame, tier, size, selection, ghost,
  onSelect, onOpenMenu, onMoveNode, onResize,
}: EditorCanvasProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const { begin } = usePointerDrag();

  const [drag, setDragState] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const setDrag = (d: DragState | null) => { dragRef.current = d; setDragState(d); };
  const [drop, setDropState] = useState<DropTarget | null>(null);
  const dropRef = useRef<DropTarget | null>(null);
  const setDrop = (d: DropTarget | null) => { dropRef.current = d; setDropState(d); };
  /** Touch hold fired but not yet moved — lifted, menu-vs-drag undecided. */
  const [lift, setLift] = useState<string | null>(null);
  const [resizing, setResizing] = useState(false);

  const ghostEn = useMemo(() => (ghost ? newNode(ghost.t) : null), [ghost?.t]);

  const stagePoint = (x: number, y: number) => {
    const r = stageRef.current?.getBoundingClientRect();
    return { x: r ? x - r.left : x, y: r ? y - r.top : y };
  };

  /* ── drop resolution: DOM hit test over the flow tree ──────────────────
   * The canvas is flow DOM (not an arithmetic grid), so the drop target comes
   * from elementsFromPoint + data-en, innermost first: over a container's own
   * chrome → insert into it at the pointer's index; over a node → before/after
   * it in its parent (x-midpoint in rows, y-midpoint in stacks). */
  function indexWithin(en: ENode, x: number, y: number): number {
    const kids = en.kids ?? [];
    const horizontal = en.node.t === 'row';
    for (let i = 0; i < kids.length; i++) {
      const el = stageRef.current?.querySelector(`[data-en="${kids[i].id}"]`);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (horizontal ? x < r.left + r.width / 2 : y < r.top + r.height / 2) return i;
    }
    return kids.length;
  }

  function resolveDrop(x: number, y: number, dragId: string, dragT: NodeT): DropTarget | null {
    const finish = (t: DropTarget): DropTarget | null => {
      // Dropping back onto its own slot is a no-op — hide the indicator.
      const cur = findPlace(root, dragId);
      if (cur && cur.key.kind === 'kid' && cur.parent.id === t.parentId
        && (t.index === cur.key.index || t.index === cur.key.index + 1)) return null;
      return t;
    };
    for (const raw of document.elementsFromPoint(x, y)) {
      const el = raw as HTMLElement;
      const id = el.dataset?.en;
      if (!id || id === dragId || isInside(root, dragId, id)) continue;
      const en = findEn(root, id);
      if (!en) continue;
      if (isKidContainer(en.node.t) && canInsert(root, en, dragT)) {
        return finish({ parentId: en.id, index: indexWithin(en, x, y) });
      }
      const place = findPlace(root, id);
      if (!place || place.key.kind !== 'kid') continue;
      if (!canInsert(root, place.parent, dragT)) continue;
      const r = el.getBoundingClientRect();
      const after = place.parent.node.t === 'row' ? x > r.left + r.width / 2 : y > r.top + r.height / 2;
      return finish({ parentId: place.parent.id, index: place.key.index + (after ? 1 : 0) });
    }
    return null;
  }

  /* ── node gestures ─────────────────────────────────────────────────────── */

  function onNodePointerDown(e: ReactPointerEvent, en: ENode) {
    e.stopPropagation();
    const touch = e.pointerType === 'touch';
    const label = catalogEntry(en.node.t).label;
    let moved = false;

    const startDrag = (x: number, y: number) => { moved = true; setDrag({ id: en.id, label, x, y }); };
    const track = (x: number, y: number) => {
      const d = dragRef.current;
      if (!d) return;
      setDrag({ ...d, x, y });
      setDrop(resolveDrop(x, y, en.id, en.node.t));
    };
    const clear = () => { setDrag(null); setDrop(null); setLift(null); };

    begin(e, {
      // Touch: hold to lift (release-in-place = menu, move = drag) — a plain
      // swipe scrolls. Mouse/pen: travel = drag; right-click is the menu.
      activation: touch
        ? { kind: 'hold', delay: HOLD_MS, cancelDistance: HOLD_CANCEL_PX }
        : { kind: 'distance', threshold: DRAG_THRESHOLD_PX },
      onActivate: (c) => {
        if (touch) setLift(en.id);
        else { startDrag(c.x, c.y); track(c.x, c.y); }
      },
      onMove: (c) => {
        if (!moved && touch && Math.hypot(c.dx, c.dy) > DRAG_THRESHOLD_PX) startDrag(c.x, c.y);
        if (moved) track(c.x, c.y);
      },
      onEnd: (c, activated) => {
        if (!activated) { clear(); onSelect(en.id); return; }
        if (touch && !moved) { clear(); onOpenMenu(stagePoint(c.x, c.y), en.id); return; }
        const d = dropRef.current;
        clear();
        if (d) onMoveNode(en.id, d.parentId, d.index);
      },
      onCancel: clear,
    });
  }

  /* ── frame resize (net-new: drag the card's edges in grid units) ───────── */

  function onHandleDown(e: ReactPointerEvent, edge: 'e' | 's' | 'se') {
    e.stopPropagation();
    const startW = size.w, startH = size.h;
    const stepX = TIERS[tier].colW + GAP;
    const stepY = ROW_H + GAP;
    const compute = (dx: number, dy: number) => ({
      w: edge === 's' ? startW : clamp(startW + Math.round(dx / stepX), 1, TIERS[tier].cols),
      h: edge === 'e' ? startH : clamp(startH + Math.round(dy / stepY), 1, MAX_H),
    });
    begin(e, {
      activation: { kind: 'immediate' },
      onActivate: () => setResizing(true),
      onMove: (c) => { const { w, h } = compute(c.dx, c.dy); onResize(w, h, false); },
      onEnd: (c, activated) => {
        setResizing(false);
        if (activated) { const { w, h } = compute(c.dx, c.dy); onResize(w, h, true); }
      },
      onCancel: () => { setResizing(false); onResize(startW, startH, false); },
    });
  }

  /* ── recursive rendering (plain functions — no per-render component types) ── */

  function flowChildren(parent: ENode, childScope: Scope): ReactNode[] {
    const kids = parent.kids ?? [];
    const out: ReactNode[] = [];
    const dropIdx = drop?.parentId === parent.id ? drop.index : -1;
    const ghostIdx = ghost && ghostEn && ghost.parentId === parent.id ? ghost.index : -1;
    const horizontal = parent.node.t === 'row';
    for (let i = 0; i <= kids.length; i++) {
      if (i === dropIdx) out.push(<span key={`dl-${i}`} className={cx('wc-dropline', horizontal && 'is-v')} />);
      if (i === ghostIdx) {
        out.push(
          <div key="ghost" className="wc-node wc-ghost">
            {nodeContent(ghostEn!, childScope)}
          </div>,
        );
      }
      if (i < kids.length) out.push(nodeView(kids[i], childScope));
    }
    if (kids.length === 0 && ghostIdx < 0 && dropIdx < 0) {
      out.push(
        <button
          key="empty"
          className="wc-empty"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            onOpenMenu(stagePoint(r.left + r.width / 2, r.bottom), parent.id);
          }}
        >
          ＋ add
        </button>,
      );
    }
    return out;
  }

  /** Editor chrome + content for one node (shared by real nodes and the ghost). */
  function nodeContent(en: ENode, s: Scope): ReactNode {
    const n = en.node;
    if (n.t === 'stack' || n.t === 'row' || n.t === 'form') {
      const cmdBadge = n.t === 'form'
        ? (n.cmd.app ? `${n.cmd.app} · ${n.cmd.capability || '?'}` : 'pick an action')
        : null;
      return (
        <div className="wc-box">
          <span className="wc-chip">{n.t}{cmdBadge ? ` → ${cmdBadge}` : ''}</span>
          <div
            className="wc-flow"
            style={{
              display: 'flex',
              flexDirection: n.t === 'row' ? 'row' : 'column',
              gap: n.t === 'form' ? 8 : n.gap ?? 8,
              alignItems: n.t === 'row' ? n.align ?? 'center' : undefined,
              justifyContent: n.t !== 'form' ? n.justify ?? 'flex-start' : undefined,
            }}
          >
            {flowChildren(en, s)}
          </div>
          {n.t === 'form' && (
            <span className="wc-fakesubmit">{bindingLabel(n.submit) || 'SUBMIT'}</span>
          )}
        </div>
      );
    }
    if (n.t === 'list') {
      const arr = resolve(n.from, s);
      const items = Array.isArray(arr) ? arr : [];
      const itemScope: Scope = { ...s, $: items[0] ?? {} };
      return (
        <div className="wc-box">
          <span className="wc-chip">list · {bindingLabel(n.from)}{items.length ? ` ×${items.length}` : ' · empty'}</span>
          <div className="wc-slot is-live">
            <span className="wc-slotlabel">EACH ITEM</span>
            {en.slots?.item && nodeView(en.slots.item, itemScope)}
          </div>
        </div>
      );
    }
    if (n.t === 'when') {
      const live = truthy(resolve(n.cond, s));
      return (
        <div className="wc-box">
          <span className="wc-chip">if · {bindingLabel(n.cond)}</span>
          <div className={cx('wc-slot', live && 'is-live')}>
            <span className="wc-slotlabel">THEN{live ? ' · SHOWING' : ''}</span>
            {en.slots?.then && nodeView(en.slots.then, s)}
          </div>
          {en.slots?.else && (
            <div className={cx('wc-slot', !live && 'is-live')}>
              <span className="wc-slotlabel">ELSE{!live ? ' · SHOWING' : ''}</span>
              {nodeView(en.slots.else, s)}
            </div>
          )}
        </div>
      );
    }
    // Leaves render through the REAL primitive renderers against live scope;
    // .wc-leaf kills pointer-events so every tap lands on the wrapper.
    return <div className="wc-leaf">{renderNode(enToNode(en), s)}</div>;
  }

  function nodeView(en: ENode, s: Scope): ReactNode {
    const n = en.node;
    const grow = 'grow' in n && n.grow;
    return (
      <div
        key={en.id}
        data-en={en.id}
        className={cx(
          'wc-node',
          selection === en.id && 'is-selected',
          (lift === en.id || drag?.id === en.id) && 'is-lifted',
        )}
        style={grow ? { flex: 1, minWidth: 0, minHeight: 0 } : undefined}
        onPointerDown={(e) => onNodePointerDown(e, en)}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onOpenMenu(stagePoint(e.clientX, e.clientY), en.id);
        }}
      >
        {nodeContent(en, s)}
      </div>
    );
  }

  /* ── the stage ─────────────────────────────────────────────────────────── */

  const { colW } = TIERS[tier];
  const cardW = unitsToPx(size.w, colW);
  const cardH = unitsToPx(size.h, ROW_H);
  const rootGap = root.node.t === 'stack' ? root.node.gap ?? 10 : 10;
  const chip = drag ? stagePoint(drag.x, drag.y) : null;

  return (
    <div ref={stageRef} className={cx('wc-stage', drag && 'is-dragging')}>
      <div
        data-en={root.id}
        className={cx(frame ? 'hud-card' : 'hud-spec-raw', 'wc-card', selection === root.id && 'is-selected')}
        style={{ width: cardW, height: cardH }}
        onClick={(e) => {
          const t = (e.target as HTMLElement).closest('[data-en]') as HTMLElement | null;
          if (t?.dataset.en === root.id) onSelect(root.id);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          onOpenMenu(stagePoint(e.clientX, e.clientY), root.id);
        }}
      >
        {frame && (frame.eyebrow || frame.source) && (
          <div className="wc-framehead">
            {frame.eyebrow && <span className="hud-eyebrow">{frame.eyebrow}</span>}
            {frame.source && <span className="hud-eyebrow-src" style={{ marginLeft: 'auto' }}>{frame.source}</span>}
          </div>
        )}
        <div className="wc-flow wc-rootflow" style={{ display: 'flex', flexDirection: 'column', gap: rootGap }}>
          {flowChildren(root, scope)}
        </div>

        <span className="wc-handle wc-handle-e" onPointerDown={(e) => onHandleDown(e, 'e')} />
        <span className="wc-handle wc-handle-s" onPointerDown={(e) => onHandleDown(e, 's')} />
        <span className="wc-handle wc-handle-se" onPointerDown={(e) => onHandleDown(e, 'se')} />
        {resizing && <span className="wc-badge">{size.w} × {size.h}</span>}
      </div>

      {drag && chip && (
        <span className="wc-dragchip" style={{ left: chip.x + 14, top: chip.y + 14 }}>{drag.label}</span>
      )}
    </div>
  );
}
