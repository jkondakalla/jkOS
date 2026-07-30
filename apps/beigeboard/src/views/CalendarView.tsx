/**
 * CalendarView — BeigeBoard's calendar tab. The view itself now lives in
 * @jkos/cards; this wrapper injects BeigeBoard's DragProvider adapter and the
 * accent/source resolvers.
 */
import React from 'react'
import { Calendar } from '@jkos/cards'
import { useDrag } from '../providers/DragProvider'
import { getAccent } from '../lib/seed'
import { sourceTintOf } from '../lib/theme'

export function CalendarView(props: any) {
  const dnd = useDrag()
  return (
    <Calendar
      view="month"
      {...props}
      drag={dnd}
      // No `foot`. The colophon line ("a month, impressed one day at a time")
      // is worth keeping and worth re-siting; as a page footer it read as one
      // more thing to look at below the thing you came to look at, and its rule
      // made a second page boundary arguing with the masthead's. The kit's
      // `foot` seam stays open for wherever it lands next.
      resolvers={{
        accentOf: (it: any) => getAccent(it, props.items),
        sourceColorOf: sourceTintOf,
      }}
    />
  )
}
