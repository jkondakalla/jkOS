/**
 * CalendarView — BeigeBoard's calendar tab. The view itself now lives in
 * @jkos/cards; this wrapper injects BeigeBoard's DragProvider adapter and the
 * accent/source resolvers.
 */
import React from 'react'
import { Calendar } from '@jkos/cards'
import { Colophon } from '@jkos/ui'
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
      // The sheet's foot — see the `foot` prop in @jkos/cards types.ts.
      foot={<Colophon style={{ fontSize: '0.82rem' }}>a month, impressed one day at a time</Colophon>}
      resolvers={{
        accentOf: (it: any) => getAccent(it, props.items),
        sourceColorOf: sourceTintOf,
      }}
    />
  )
}
