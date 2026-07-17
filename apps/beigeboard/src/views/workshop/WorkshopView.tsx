import React, { useEffect, useState } from 'react'
import { FONT_BODY, weekStart } from '../../lib/theme'
import { useBreakpoint } from '@jkos/ui'
import { ShopFloor } from './ShopFloor'
import { NodePage } from './NodePage'
import { Bench } from './Bench'

/*
 * The Workshop — the Breakdown Method, embodied (Documentation/PLANNING_METHOD.md).
 * Unlimited-depth drill-down (one node + its children per screen, breadcrumb zoom)
 * beside a weekly bench. Root shows the shop floor of goals; drilling in shows a
 * node's ladder + next actions. Planning is manual by design — no AI in this view.
 */
export function WorkshopView({
  items, today, onSelect, onToggle, onAddItem, onDelete, onUpdateItem,
  selectedId, focusedNodeId, setFocusedNodeId, setView, readonly,
}: any) {
  const [nodeId, setNodeId] = useState<number | null>(null)
  const [benchOpen, setBenchOpen] = useState(false)

  // Deep-link from a DetailPanel ("Open in workshop →") drills straight to the node.
  useEffect(() => {
    if (focusedNodeId != null) { setNodeId(focusedNodeId); setFocusedNodeId?.(null) }
  }, [focusedNodeId, setFocusedNodeId])

  const node = nodeId != null ? items.find((i: any) => i.id === nodeId) : null
  // A drilled node deleted out from under us (cascade) drops us back to the floor.
  useEffect(() => { if (nodeId != null && !node) setNodeId(null) }, [nodeId, node])

  const weekIso   = weekStart(today)
  const isDesktop = useBreakpoint() === 'desktop'
  const drill = (id: number | null) => setNodeId(id)

  const surface = node ? (
    <NodePage
      node={node} items={items} today={today} weekIso={weekIso} drill={drill}
      onSelect={onSelect} onToggle={onToggle} onAddItem={onAddItem} onDelete={onDelete} onUpdateItem={onUpdateItem}
      selectedId={selectedId} readonly={readonly}
    />
  ) : (
    <ShopFloor
      items={items} today={today} weekIso={weekIso} drill={drill}
      onSelect={onSelect} onAddItem={onAddItem} onUpdateItem={onUpdateItem} readonly={readonly}
    />
  )

  const bench = (
    <Bench
      items={items} today={today} weekIso={weekIso} drill={drill} setView={setView}
      onToggle={onToggle} onUpdateItem={onUpdateItem} onDelete={onDelete} onSelect={onSelect} readonly={readonly}
    />
  )

  return (
    <div style={{ flex: 1, overflowY: 'auto', background: 'transparent' }}>
      <div style={{ maxWidth: 920, margin: '0 auto', padding: '32px 40px 80px' }}>
        {isDesktop ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 300px', gap: 28, alignItems: 'start' }}>
            <div style={{ minWidth: 0 }}>{surface}</div>
            <div style={{ position: 'sticky', top: 8, alignSelf: 'start' }}>{bench}</div>
          </div>
        ) : (
          <>
            <div style={{ marginBottom: 20 }}>
              <button
                onClick={() => setBenchOpen(o => !o)}
                style={{
                  width: '100%', textAlign: 'left', cursor: 'pointer',
                  background: 'var(--color-paper-2)', border: '1px solid var(--color-line)',
                  borderRadius: 'var(--hub-radius-lg)', padding: '12px 16px',
                  fontFamily: FONT_BODY, fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase',
                  color: 'var(--color-muted)',
                }}
              >This week’s bench {benchOpen ? '▴' : '▾'}</button>
              {benchOpen && <div style={{ marginTop: 12 }}>{bench}</div>}
            </div>
            {surface}
          </>
        )}
      </div>
    </div>
  )
}
