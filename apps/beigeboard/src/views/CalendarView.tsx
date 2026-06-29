/**
 * CalendarView — BeigeBoard's calendar tab. The view itself now lives in
 * @jkos/cards; this wrapper injects BeigeBoard's DragProvider adapter and the
 * accent/source resolvers.
 */
import React from 'react'
import { CalendarView as KitCalendarView } from '@jkos/cards'
import { useDrag } from '../providers/DragProvider'
import { getAccent } from '../lib/seed'
import { sourceOf } from '../lib/theme'

export function CalendarView(props: any) {
  const dnd = useDrag()
  return (
    <KitCalendarView
      {...props}
      drag={dnd}
      resolvers={{
        accentOf: (it: any) => getAccent(it, props.items),
        sourceColorOf: (s?: string) => sourceOf(s ?? '').hex,
      }}
    />
  )
}
