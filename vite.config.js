import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// The fonts of the first screen, Latin subset: the page title and the brand
// (Oswald 600) and the body text (IBM Plex Sans 400). Preloading them lets
// the text render in its font without waiting for the CSS to be parsed.
const PRELOADED_FONTS = [
  /^assets\/oswald-latin-600-normal-[\w-]+\.woff2$/,
  /^assets\/ibm-plex-sans-latin-400-normal-[\w-]+\.woff2$/,
];

function preloadFonts() {
  return {
    name: 'tgh-preload-fonts',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html, { bundle = {} }) {
        const files = Object.keys(bundle);
        return PRELOADED_FONTS.map(pattern => {
          const file = files.find(name => pattern.test(name));
          // A renamed font file fails the build instead of dropping the preload.
          if (!file) throw new Error(`No built font matches ${pattern}.`);
          return {
            tag: 'link',
            attrs: { rel: 'preload', as: 'font', type: 'font/woff2', href: `/${file}`, crossorigin: '' },
            injectTo: 'head',
          };
        });
      },
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    preloadFonts(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['tgh-logo-96.png'],
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
        // Fonts: the icons and the Latin text subset are precached, so the
        // app looks the same offline; other subsets (Cyrillic and the rest)
        // are cached when a page first needs them, see runtimeCaching.
        globPatterns: ['**/*.{js,css,html}', 'assets/material-symbols-*.woff2', 'assets/*-latin-[0-9]*.woff2'],
        // Every route is a client route; the app shell answers them offline.
        navigateFallback: '/index.html',
        // Files a browser can open directly that are not app routes.
        navigateFallbackDenylist: [/^\/sitemap\.xml$/, /^\/robots\.txt$/],
        // Font files have hashed names and never change: cache first.
        runtimeCaching: [
          {
            urlPattern: ({ url, sameOrigin }) => sameOrigin && /^\/assets\/.+\.woff2$/.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'fonts',
              expiration: { maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
      },
    }),
  ],
  // Absolute asset URLs, so nested pages (/weapon/<slug>/) load them too.
  base: '/',
})
