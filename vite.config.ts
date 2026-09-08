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
      registerType: 'autoUpdate',
      includeAssets: ['images/app-icon.svg', 'images/logo.png', 'images/apple-touch-icon.png', 'images/favicon-32.png'],
      workbox: {
        navigateFallbackDenylist: [/^\/admin/, /^\/api/],
        // Cloudinary صور المنتجات: cache-first مع حد أقصى لعدد العناصر وعمر الكاش — بيمنع
        // نمو غير محدود لكاش الـ service worker. أعدادات المتجر/الأقسام/البنرات: بيانات
        // إعداد خفيفة التغيّر فمناسب لها stale-while-revalidate. باقي endpoints الـ API
        // (المنتجات لأنها بتحمل حالة المخزون الحالية، السلة، الدفع، الطلبات، تسجيل الدخول)
        // ممنوع تتخزن كاش من الـ service worker خالص — بيانات حساسة أو لازم تكون لحظية دايماً.
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.origin === 'https://res.cloudinary.com',
            handler: 'CacheFirst',
            options: {
              cacheName: 'product-images',
              expiration: { maxEntries: 200, maxAgeSeconds: 30 * 24 * 60 * 60 },
              cacheableResponse: { statuses: [0, 200] }
            }
          },
          {
            urlPattern: ({ url }) => ['/api/categories', '/api/banners', '/api/settings'].includes(url.pathname),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'catalog-config',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 }
            }
          }
        ]
      },
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
