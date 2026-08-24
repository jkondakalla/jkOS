import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

// The app-shell service worker. BASE_URL already carries the deploy prefix
// (root-domain prod vs. the /kouros/ staging subpath), so both the registration
// URL and the resulting scope stay correct under either shape. PROD-only: a dev
// server's asset URLs are not the ones the worker should be caching.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`)
      .catch((err) => console.warn('[kouros] service worker registration failed:', err))
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
