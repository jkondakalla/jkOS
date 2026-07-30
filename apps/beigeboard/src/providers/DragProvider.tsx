/**
 * DragProvider — BeigeBoard's calendar drag is now the shared @jkos/cards
 * CalendarDragProvider, built on @jkos/ui's usePointerDrag (one gesture engine
 * for the whole suite, and pointer-based so reschedule works on touch).
 *
 * Kept as a local re-export so App.tsx's <DragProvider> mount and the view
 * wrappers' `useDrag()` imports stay unchanged; here we inject BeigeBoard's
 * source → colour map so the drag ghost keeps its per-source tint.
 */
import React from 'react'
import { CalendarDragProvider, useCalendarDrag } from '@jkos/cards'
import { sourceTintOf } from '../lib/theme'

/** The view wrappers read the adapter through this alias (unchanged call site). */
export const useDrag = useCalendarDrag

export function DragProvider({ children }: { children: React.ReactNode }) {
  return (
    <CalendarDragProvider sourceColorOf={sourceTintOf}>
      {children}
    </CalendarDragProvider>
  )
}
