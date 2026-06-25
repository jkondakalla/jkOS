import { useEffect } from 'react'
import { useAppStore } from '../store/appStore'
import type { SchemeId } from '../types'
import { applyTheme } from '@jkos/auth-client'

export type { SchemeId }
export type ThemeName = 'light' | 'dark'

export interface Scheme {
  id: SchemeId
  name: string
  theme: ThemeName
  accent: string
}

export const SCHEMES: Scheme[] = [
  { id: 'reading-room', name: 'Reading Room', theme: 'light', accent: '#0e7c66' },
  { id: 'sandstone',    name: 'Sandstone',    theme: 'light', accent: '#b8543a' },
  { id: 'nocturne',     name: 'Nocturne',     theme: 'dark',  accent: '#0e7c66' },
  { id: 'velvet',       name: 'Velvet',       theme: 'dark',  accent: '#7c3aed' },
]

export function schemeById(id: string): Scheme {
  return SCHEMES.find(s => s.id === id) ?? SCHEMES[2] // default: nocturne
}

export function applyScheme(id: SchemeId): void {
  const s = schemeById(id)
  // A reading scheme now sets only the mode (light/dark). The accent is owned
  // suite-wide by the shared chooser (jkAuth theme → --accent-raw), so we no
  // longer write --accent-raw here — that kept the reading scheme from fighting
  // the unified accent. `Scheme.accent` is retained as the scheme's intended
  // tint metadata (used by useTheme's mode-toggle matching), not applied.
  document.documentElement.setAttribute('data-mode', s.theme === 'dark' ? 'dark' : 'paper')
}

// Suite-wide jkOS theme application (shared with ORDECK + BeigeBoard).
export const applyJkOSTheme = applyTheme

export function useTheme() {
  const schemeId = useAppStore(s => s.settings.scheme ?? 'nocturne') as SchemeId
  const updateSettings = useAppStore(s => s.updateSettings)
  const s = schemeById(schemeId)

  useEffect(() => { applyScheme(schemeId) }, [schemeId])

  return {
    theme: s.theme as ThemeName,
    scheme: schemeId,
    setScheme: (id: SchemeId) =>
      updateSettings({ scheme: id, theme: schemeById(id).theme }),
    // Backward-compat: toggles to same-accent different-theme variant when possible
    setTheme: (t: ThemeName) => {
      const match = SCHEMES.find(sc => sc.theme === t && sc.accent === s.accent)
        ?? SCHEMES.find(sc => sc.theme === t)!
      updateSettings({ scheme: match.id, theme: t })
    },
    toggle: () => {
      const next: ThemeName = s.theme === 'dark' ? 'light' : 'dark'
      const match = SCHEMES.find(sc => sc.theme === next && sc.accent === s.accent)
        ?? SCHEMES.find(sc => sc.theme === next)!
      updateSettings({ scheme: match.id, theme: next })
    },
  }
}
