import { api } from './api'

// نفس منطق src/utils/push.ts في تطبيق العميل بالظبط (Web Push API قياسي، نفس جدول
// push_subscriptions ونفس مفتاح VAPID) — بس هنا navigator.serviceWorker.ready بيحل تلقائياً
// لـ service worker لوحة التحكم (/admin/sw.js، scope: /admin/) لأنه هو المسجَّل من الصفحة
// اللي الكود ده بيتنفّذ فيها، مش محتاج أي تمييز صريح. راجع admin/public/sw.js لمعالج push.
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const base64Safe = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64Safe)
  const buffer = new ArrayBuffer(raw.length)
  const bytes = new Uint8Array(buffer)
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes
}

export function isPushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window
}

export type PushSubscribeResult =
  | { ok: true }
  | { ok: false; reason: 'unsupported' | 'permission_denied' | 'not_configured' | 'error' }

// بيطلب إذن الإشعارات (لو لسه معلّق) ويشترك فعلياً عبر الـ service worker الحقيقي. ما بيتنادش
// إلا من إجراء صريح للمستخدم (زر "تفعيل الإشعارات") — أبداً مش عند تحميل الصفحة، عشان
// المتصفحات الحديثة بترفض/بتتجاهل طلب إذن مش مرتبط بتفاعل مستخدم حقيقي.
export async function subscribeToPush(): Promise<PushSubscribeResult> {
  if (!isPushSupported()) return { ok: false, reason: 'unsupported' }

  const { publicKey, configured } = await api.getVapidPublicKey()
  if (!configured || !publicKey) return { ok: false, reason: 'not_configured' }

  if (typeof Notification !== 'undefined' && Notification.permission === 'denied') {
    return { ok: false, reason: 'permission_denied' }
  }

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return { ok: false, reason: 'permission_denied' }

  try {
    const registration = await navigator.serviceWorker.ready
    let subscription = await registration.pushManager.getSubscription()
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey)
      })
    }
    const json = subscription.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } }
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return { ok: false, reason: 'error' }

    await api.subscribePush({ endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } })
    return { ok: true }
  } catch {
    return { ok: false, reason: 'error' }
  }
}

export async function unsubscribeFromPush(): Promise<void> {
  if (!isPushSupported()) return
  try {
    const registration = await navigator.serviceWorker.ready
    const subscription = await registration.pushManager.getSubscription()
    if (subscription) {
      await api.unsubscribePush(subscription.endpoint).catch(() => {})
      await subscription.unsubscribe()
    }
  } catch {
    // إلغاء الاشتراك أفضل-جهد — فشل هنا مش حرج، المستخدم أصلاً بيحاول يوقف إشعارات.
  }
}

export type PushCapabilityState = 'unsupported' | 'denied' | 'subscribed' | 'not_subscribed'

export async function getPushSubscriptionStatus(): Promise<PushCapabilityState> {
  if (!isPushSupported()) return 'unsupported'
  if (typeof Notification !== 'undefined' && Notification.permission === 'denied') return 'denied'
  try {
    const registration = await navigator.serviceWorker.ready
    const subscription = await registration.pushManager.getSubscription()
    if (!subscription) return 'not_subscribed'

    const json = subscription.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } }
    if (json.endpoint && json.keys?.p256dh && json.keys?.auth) {
      api.subscribePush({ endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } }).catch(() => {})
    }
    return 'subscribed'
  } catch {
    return 'unsupported'
  }
}
