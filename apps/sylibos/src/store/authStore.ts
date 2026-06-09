import { create } from 'zustand'
import { getMe, refreshToken, redirectToLogin, getAuthProfile, normaliseTheme } from '../api/auth'
import type { JkosUser } from '../api/auth'
import { applyScheme, applyJkOSTheme } from '../lib/theme'
import type { SchemeId } from '../types'

interface AuthStore {
  user:   JkosUser | null
  status: 'loading' | 'ready' | 'unauthenticated'
  init:   () => Promise<void>
}

let _initInFlight = false

export const useAuthStore = create<AuthStore>((set) => ({
  user:   null,
  status: 'loading',

  init: async () => {
    // Prevent concurrent init calls (React StrictMode mounts effects twice in dev)
    if (_initInFlight) return
    _initInFlight = true
    try {
      let user = await getMe()

      if (!user) {
        const refreshed = await refreshToken()
        if (refreshed) user = await getMe()
      }

      if (!user) {
        set({ status: 'unauthenticated' })
        redirectToLogin()
        return
      }

      set({ user, status: 'ready' })

      // Non-blocking: apply cross-app theme from jkAuth preferences.
      // Effects are managed by useJkOSPreferences in Layout.
      getAuthProfile()
        .then((profile) => {
          if (!profile) return
          const { preferences } = profile
          if (preferences.scheme) applyScheme(preferences.scheme as SchemeId)
          if (preferences.theme)  applyJkOSTheme(normaliseTheme(preferences.theme))
        })
        .catch(() => {})

    } catch {
      set({ status: 'unauthenticated' })
      redirectToLogin()
    } finally {
      _initInFlight = false
    }
  },
}))
