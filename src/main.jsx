import { StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import Shell from './Shell.jsx' // PicTalk and Piccolo panes
import LabPage from './lab/LazyLabPage.jsx' // the public Evaluation Lab page at /lab

const isLab = window.location.pathname.replace(/\/+$/, '') === '/lab'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {isLab ? (
      <Suspense fallback={null}>
        <LabPage />
      </Suspense>
    ) : (
      <Shell />
    )}
  </StrictMode>,
)

// Offline support: register the service worker (live site only, not during npm run dev)
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => console.warn('SW registration failed:', err));
  });
}
