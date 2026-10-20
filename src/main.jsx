import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Self-hosted fonts, the weights the styles use. Each file holds every
// subset with its unicode-range, so a browser downloads only the subsets a
// page needs (Latin, plus Cyrillic in Russian).
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import '@fontsource/jetbrains-mono/600.css'
import '@fontsource/oswald/500.css'
import '@fontsource/oswald/600.css'
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
