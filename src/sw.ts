/// <reference lib="webworker" />
// service worker مخصص (injectManifest) بدل الافتراضي (generateSW) — السبب الوحيد للتحول:
// إشعارات Web Push الحقيقية محتاجة أحداث 'push'/'notificationclick' مكتوبة يدوياً، ومفيش
// طريقة تحقنها في وضع generateSW. باقي سلوك الكاش (precache + runtime caching) نفسه بالظبط
// زي ما كان في vite.config.ts قبل كده، منقول هنا حرفياً عشان محدش سلوك يتغيّر.
import { precacheAndRoute, createHandlerBoundToURL } from 'workbox-precaching'
import { registerRoute, NavigationRoute } from 'workbox-routing'
import { CacheFirst, NetworkFirst } from 'workbox-strategies'
import { ExpirationPlugin } from 'workbox-expiration'
import { CacheableResponsePlugin } from 'workbox-cacheable-response'

declare const self: ServiceWorkerGlobalScope

precacheAndRoute(self.__WB_MANIFEST)

const NAVIGATE_DENYLIST = [/^\/admin/, /^\/api/, /^\/sitemap\.xml$/, /^\/robots\.txt$/]
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html'), { denylist: NAVIGATE_DENYLIST }))

registerRoute(
  ({ url }) => url.origin === 'https://res.cloudinary.com',
  new CacheFirst({
    cacheName: 'product-images',
    plugins: [
      new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 30 * 24 * 60 * 60 }),
      new CacheableResponsePlugin({ statuses: [0, 200] })
    ]
  })
)

registerRoute(
  // settings مستبعد عمداً — إعدادات تشغيلية (زي آخر ميعاد توصيل نفس اليوم) لازم تفضل
  // طازة دايماً، مفيش أي تخزين مؤقت حتى NetworkFirst (راجع server/src/routes/settings.ts).
  //
  // كان StaleWhileRevalidate قبل كده — بيرجّع نسخة الكاش القديمة فوراً دايماً (بما فيها
  // image_url قديم لقسم/بانر الأدمن غيّر صورته)، ويحدّث الكاش بالخلفية بس لطلب الزيارة
  // الجاية. ده يعني أي عميل بيزور مرة واحدة ومايرجعش تاني، أو بيكرّر الصفحة نفسها خلال
  // ساعة (ExpirationPlugin)، كان يفضل شايف الصورة القديمة من غير ما يعرف. NetworkFirst
  // بيحاول الشبكة الحقيقية أولاً دايماً (نفس الـ Cache-Control اللي السيرفر فعلاً بيحدده
  // في setShortPublicCache)، ومايرجعش لنسخة الكاش إلا لو فعلاً مفيش نت.
  ({ url }) => ['/api/categories', '/api/banners'].includes(url.pathname),
  new NetworkFirst({
    cacheName: 'catalog-config',
    networkTimeoutSeconds: 4,
    plugins: [new ExpirationPlugin({ maxEntries: 20, maxAgeSeconds: 60 * 60 })]
  })
)

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()))

interface PushPayload { title?: string; body?: string; url?: string }

self.addEventListener('push', event => {
  let payload: PushPayload = {}
  try { payload = event.data?.json() ?? {} } catch { /* حمولة غير JSON صالحة — نتجاهلها */ }

  event.waitUntil(
    self.registration.showNotification(payload.title ?? 'علاء الدين', {
      body: payload.body ?? '',
      icon: '/images/icon-192.png',
      badge: '/images/icon-192.png',
      data: { url: payload.url ?? '/' }
    })
  )
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  const url = (event.notification.data as { url?: string } | undefined)?.url ?? '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then(clientList => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus()
      }
      return self.clients.openWindow(url)
    })
  )
})
