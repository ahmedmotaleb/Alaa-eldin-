// Service worker مقصود يبقى "لا شيء" فعلياً بخصوص الكاش — بيتسجل بس عشان معايير Chrome
// لتثبيت PWA (زر "Install app" الحقيقي بيفتح شاشة كاملة بأيقونة المتجر) بتتطلب service
// worker مسجّل له معالج 'fetch'، وإلا المتصفح بيرجع لسلوك احتياطي ("إضافة اختصار") بياخد
// صورة شاشة للصفحة بدل أيقونة الـ manifest. لا كاش هنا خالص — كل طلب بيروح للشبكة عادي زي
// ما لو مفيش service worker أصلاً، عشان بيانات لوحة التحكم لازم تفضل طازة دايماً.
//
// 'push'/'notificationclick' هم الإضافة الوحيدة فوق الملف الفارغ ده (لإشعارات "طلب جديد"
// الإدارية) — نفس منطق src/sw.ts في تطبيق العميل بالظبط، مع تحسين واحد: عند الضغط على
// الإشعار، لو في تبويب لوحة تحكم مفتوح بالفعل بيتنقّل (navigate) للرابط الصحيح بدل ما
// يتفوكَس على أي صفحة كانت مفتوحة بالصدفة.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()))
self.addEventListener('fetch', () => {})

self.addEventListener('push', event => {
  let payload = {}
  try { payload = event.data ? event.data.json() : {} } catch { /* حمولة غير JSON صالحة — نتجاهلها */ }

  event.waitUntil(
    self.registration.showNotification(payload.title || 'علاء الدين', {
      body: payload.body || '',
      icon: '/admin/images/icon-192.png',
      badge: '/admin/images/icon-192.png',
      data: { url: payload.url || '/admin/' }
    })
  )
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/admin/'

  event.waitUntil((async () => {
    const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of clientList) {
      if (!('focus' in client)) continue
      if ('navigate' in client) {
        try {
          const navigated = await client.navigate(url)
          await navigated.focus()
          return
        } catch {
          // فشل التنقّل (نادر، مثلاً لو العميل مش من نفس الأصل) — نكتفي بالتركيز على
          // الصفحة المفتوحة بدل ما نفشل الحدث كله.
        }
      }
      await client.focus()
      return
    }
    await self.clients.openWindow(url)
  })())
})
