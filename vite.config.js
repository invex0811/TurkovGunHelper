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
      includeAssets: ['favicon.svg', 'tgh-logo.png'],
      manifest: {
        name: 'Tarkov Gun Helper',
        short_name: 'Tarkov Gun Helper',
        description: 'Create and manage optimized Escape from Tarkov weapon builds.',
        start_url: './',
        scope: './',
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
        cleanupOutdatedCaches: true,
        globPatterns: ['**/*.{js,css,html,woff2}'],
        navigateFallback: 'index.html',
      },
    }),
  ],
  base: './',
})
