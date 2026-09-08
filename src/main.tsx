import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import { registerSW } from 'virtual:pwa-register'
import { isNative } from './utils/platform'

// service worker مفيد بس للويب (تحديث الكاش، تشغيل بدون اتصال، تثبيت PWA) — جوه Capacitor
// WebView الأصول أصلاً محمّلة محلياً من الـ APK نفسه، فمفيش داعي لأي service worker هناك،
// وممكن يسبب تعارض في الكاش/التوجيه لو اتسجّل بالغلط. الويب يفضل يسجّله زي ما هو تماماً.
if (!isNative()) {
  registerSW({ immediate: true })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
