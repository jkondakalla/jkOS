/**
 * WeekView — BeigeBoard's week tab. The view itself now lives in @jkos/cards (so
 * the same component powers ORDECK widgets); this wrapper injects BeigeBoard's
 * concrete wiring: the DragProvider adapter and the accent/source resolvers.
 */
import React from 'react'
import { Calendar } from '@jkos/cards'
import { Colophon } from '@jkos/ui'
import { useDrag } from '../providers/DragProvider'
import { getAccent } from '../lib/seed'
import { sourceOf } from '../lib/theme'

export function WeekView(props: any) {
  const dnd = useDrag()
  return (
    <Calendar
      view="week"
      {...props}
      benchLane
      createSource="bb"
      drag={dnd}
      // The sheet's foot. The kit renders the anchor (.jk-canvas-foot), the app
      // supplies the voice — see the `foot` prop in @jkos/cards types.ts.
      foot={<Colophon style={{ fontSize: '0.82rem' }}>seven days, set and locked up</Colophon>}
      resolvers={{
        accentOf: (it: any) => getAccent(it, props.items),
        sourceColorOf: (s?: string) => sourceOf(s ?? '').hex,
      }}
    />
  )
}
