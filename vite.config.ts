import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true
      }
    }
  },
  plugins: [
    react(),
    VitePWA({
      // اتحوّلنا من generateSW الافتراضي لـ injectManifest عشان نقدر نضيف أحداث push/
      // notificationclick يدوياً لإشعارات Web Push الحقيقية (Batch L10) — مفيش طريقة تحقن
      // كود event-listener مخصص في وضع generateSW. سلوك الكاش (precache + runtime caching)
      // نفسه بالظبط، اتنقل حرفياً لملف src/sw.ts بدل ما يتحدد هنا بصيغة workbox الوصفية.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}']
      },
      registerType: 'autoUpdate',
      includeAssets: ['images/app-icon.svg', 'images/logo.png', 'images/apple-touch-icon.png', 'images/favicon-32.png'],
      manifest: {
        name: 'علاء الدين',
        short_name: 'علاء الدين',
        description: 'سوبر ماركت علاء الدين للتسوق أونلاين',
        theme_color: '#16A34A',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        lang: 'ar',
        dir: 'rtl',
        icons: [
          {
            src: '/images/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: '/images/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: '/images/app-icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'maskable'
          }
        ]
      }
    })
  ]
})
