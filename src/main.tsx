import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import { registerSW } from 'virtual:pwa-register'
import { isNative } from './utils/platform'
import { hydrateNativeSession } from './utils/nativeSession'

// service worker مفيد بس للويب (تحديث الكاش، تشغيل بدون اتصال، تثبيت PWA) — جوه Capacitor
// WebView الأصول أصلاً محمّلة محلياً من الـ APK نفسه، فمفيش داعي لأي service worker هناك،
// وممكن يسبب تعارض في الكاش/التوجيه لو اتسجّل بالغلط. الويب يفضل يسجّله زي ما هو تماماً.
if (!isNative()) {
  registerSW({ immediate: true })
}

// على الأندرويد لازم توكن الجلسة يتحمّل من التخزين الدائم قبل أول render — أول حاجة
// بيعملها التطبيق هي طلب /auth/me، ولو اتبعت من غير التوكن المستخدم هيتفتحله التطبيق
// كزائر رغم إنه مسجّل دخول. على الويب الدالة دي بترجع فوراً (الكوكيز بتتبعت لوحدها).
void hydrateNativeSession().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
})
