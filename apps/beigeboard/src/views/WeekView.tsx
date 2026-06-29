/**
 * WeekView — BeigeBoard's week tab. The view itself now lives in @jkos/cards (so
 * the same component powers ORDECK widgets); this wrapper injects BeigeBoard's
 * concrete wiring: the DragProvider adapter and the accent/source resolvers.
 */
import React from 'react'
import { WeekView as KitWeekView } from '@jkos/cards'
import { useDrag } from '../providers/DragProvider'
import { getAccent } from '../lib/seed'
import { sourceOf } from '../lib/theme'

export function WeekView(props: any) {
  const dnd = useDrag()
  return (
    <KitWeekView
      {...props}
      drag={dnd}
      resolvers={{
        accentOf: (it: any) => getAccent(it, props.items),
        sourceColorOf: (s?: string) => sourceOf(s ?? '').hex,
      }}
    />
  )
}
