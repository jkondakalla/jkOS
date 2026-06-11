import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './index.css'
import ErrorBoundary from './components/ErrorBoundary'
import Layout from './components/Layout'
import Home from './pages/Home'
import Library from './pages/Library'
import Import from './pages/Import'
import CoursePage from './pages/CoursePage'
import Lesson from './pages/Lesson'
import Settings from './pages/Settings'

// Vite injects the deploy base (e.g. "/sylib/" on staging, "/" on prod) as
// BASE_URL. React Router needs it as a basename or no route matches the
// path-prefixed URL and the app renders blank. Strip the trailing slash;
// "/" collapses to "" which react-router treats as root.
const basename = (import.meta.env.BASE_URL as string).replace(/\/$/, '')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter basename={basename}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Home />} />
            <Route path="/library" element={<Library />} />
            <Route path="/import" element={<Import />} />
            <Route path="/course/:id" element={<CoursePage />} />
            <Route path="/lesson/:id" element={<Lesson />} />
            <Route path="/settings" element={<Settings />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
)
