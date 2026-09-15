// Service worker مقصود يبقى "لا شيء" فعلياً — بيتسجل بس عشان معايير Chrome لتثبيت PWA
// (زر "Install app" الحقيقي بيفتح شاشة كاملة بأيقونة المتجر) بتتطلب service worker مسجّل
// له معالج 'fetch'، وإلا المتصفح بيرجع لسلوك احتياطي ("إضافة اختصار") بياخد صورة شاشة
// للصفحة بدل أيقونة الـ manifest. لا كاش هنا خالص — كل طلب بيروح للشبكة عادي زي ما لو
// مفيش service worker أصلاً، عشان بيانات لوحة التحكم لازم تفضل طازة دايماً.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()))
self.addEventListener('fetch', () => {})
