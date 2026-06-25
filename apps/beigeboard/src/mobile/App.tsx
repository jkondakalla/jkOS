import React, { useState, useMemo, useEffect, useRef } from 'react'
import { FONT_HEAD } from '../lib/theme'

import { Chrome, MobileHeader, MobileBottomNav } from './components'
import { DetailSheet, AddSheet } from './components/MobileSheets'
import { MobileTodayView, MobileWeekView, MobileCalendarView, MobileTasksView } from './views'

/**
 * Mobile App — main layout component for phone interface
 * Handles swipe navigation, sheets, tweaks, and view routing
 */

export interface MobileAppProps {
  items: any[]
  today: string
  onItemToggle: (id: number, completed: boolean) => void
  onItemDelete: (id: number) => void
  onItemAdd: (partial: any) => any
  onItemUpdate: (id: number, patch: any) => void
  chromeIntensity?: 'off' | 'subtle' | 'full'
  navVariant?: 'transport' | 'linear'
}

export function MobileApp({
  items,
  today,
  onItemToggle,
  onItemDelete,
  onItemAdd,
  onItemUpdate,
  chromeIntensity = 'full',
  navVariant = 'transport',
}: MobileAppProps) {

  const [view, setView] = useState('today')
  const [selected, setSelected] = useState<any>(null)
  const [adding, setAdding] = useState<string | boolean>(false)

  // Handle swipe navigation between views
  const touchRef = useRef({ x: 0, y: 0, t: 0 })
  const VIEWS = ['today', 'week', 'calendar', 'tasks']
  const idx = VIEWS.findIndex((v) => v === view)

  const go = (dir: number) => {
    const ni = Math.min(VIEWS.length - 1, Math.max(0, idx + dir))
    if (ni !== idx) setView(VIEWS[ni])
  }

  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0]
    touchRef.current = { x: t.clientX, y: t.clientY, t: Date.now() }
  }

  const onTouchEnd = (e: React.TouchEvent) => {
    const t = e.changedTouches[0]
    const dx = t.clientX - touchRef.current.x
    const dy = t.clientY - touchRef.current.y
    if (Math.abs(dx) > 56 && Math.abs(dx) > Math.abs(dy) * 1.6 && Date.now() - touchRef.current.t < 600) {
      go(dx < 0 ? 1 : -1)
    }
  }

  const handleToggle = (id: number) => {
    const item = items.find((it) => it.id === id)
    if (item) onItemToggle(id, !item.completed)
  }

  const handleSelect = (item: any) => {
    setSelected(item)
  }

  const handleAddOnDate = (date: string) => {
    setAdding(date)
  }

  return (
    <div
      data-density="compact"
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        background: 'transparent',   /* grained paper backdrop comes from the body */
        color: 'var(--color-ink)',
        overflow: 'hidden',
        transition: 'background 0.5s ease, color 0.5s ease',
      }}
    >
      <Chrome intensity={chromeIntensity} />

      <MobileHeader today={today} />

      <main
        key={view}
        className="bb-viewin"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        style={{
          flex: 1,
          minHeight: 0,
          position: 'relative',
        }}
      >
        {view === 'today' && (
          <MobileTodayView
            items={items}
            today={today}
            onSelect={handleSelect}
            onToggle={handleToggle}
            onAdd={() => setAdding(true)}
          />
        )}
        {view === 'week' && (
          <MobileWeekView items={items} today={today} onSelect={handleSelect} onToggle={handleToggle} />
        )}
        {view === 'calendar' && (
          <MobileCalendarView
            items={items}
            today={today}
            onSelect={handleSelect}
            onToggle={handleToggle}
            onUpdate={onItemUpdate}
            onAddOnDate={handleAddOnDate}
          />
        )}
        {view === 'tasks' && (
          <MobileTasksView
            items={items}
            today={today}
            onSelect={handleSelect}
            onToggle={handleToggle}
            onCreate={onItemAdd}
            onUpdate={onItemUpdate}
          />
        )}
      </main>

      <MobileBottomNav view={view} setView={setView} onAdd={() => setAdding(true)} variant={navVariant} />

      {selected && (
        <DetailSheet
          item={selected}
          items={items}
          onClose={() => setSelected(null)}
          onToggle={handleToggle}
          onDelete={onItemDelete}
          onUpdate={onItemUpdate}
          onCreate={onItemAdd}
          onSelect={handleSelect}
        />
      )}
      {adding && (
        <AddSheet
          date={typeof adding === 'string' ? adding : today}
          today={today}
          items={items}
          onClose={() => setAdding(false)}
          onAdd={onItemAdd}
        />
      )}
    </div>
  )
}
