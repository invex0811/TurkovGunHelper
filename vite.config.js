import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['tgh-logo.png'],
      manifest: {
        name: 'Tarkov Gun Helper',
        short_name: 'Tarkov Gun Helper',
        description: 'Create and manage optimized Escape from Tarkov weapon builds.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#0d0f10',
        theme_color: '#c7a86b',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // A new worker takes over at once instead of waiting for every tab to
        // close. The HashRouter-era worker served a shell with ./assets/ paths
        // that break on nested URLs; this way one reload brings the new shell.
        // PwaUpdatePrompt then offers the reload to pages still on old code.
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        globPatterns: ['**/*.{js,css,html,woff2}'],
        // Every route is a client route; the app shell answers them offline.
        navigateFallback: '/index.html',
        // Files a browser can open directly that are not app routes.
        navigateFallbackDenylist: [/^\/sitemap\.xml$/, /^\/robots\.txt$/],
        // Google Fonts: the stylesheet revalidates, the font files are immutable.
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'google-fonts-stylesheets' },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              cacheableResponse: { statuses: [0, 200] },
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
      },
    }),
  ],
  // Absolute asset URLs, so nested pages (/weapon/<slug>/) load them too.
  base: '/',
})
