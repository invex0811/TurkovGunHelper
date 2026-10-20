import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { redirectLegacyHashUrl } from './features/routing/legacyHashUrl.js'
import { reloadOnStaleChunk } from './features/pwa/staleChunkReload.js'

// Old #/… links (shared builds) become real paths before the router reads them.
redirectLegacyHashUrl()
reloadOnStaleChunk()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
