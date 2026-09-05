import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['images/app-icon.svg', 'images/product-placeholder.svg'],
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
            src: '/images/app-icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable'
          }
        ]
      }
    })
  ]
})
