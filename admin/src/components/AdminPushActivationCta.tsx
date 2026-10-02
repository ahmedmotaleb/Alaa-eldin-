import { useEffect, useState } from 'react'
import { useAuth } from '../store/AuthContext'
import { api } from '../utils/api'
import { isPushSupported, subscribeToPush, getPushSubscriptionStatus } from '../utils/push'

const DISMISS_KEY = 'admin-push-cta-dismissed'

type CtaState = 'hidden' | 'offer' | 'activating' | 'error'

// زرار عائم شديد الوضوح لتفعيل إشعارات "طلب جديد" — نفس البنية التحتية بتاعة
// NotificationCenterPage بالظبط (نفس push.ts، نفس /api/notifications/*)، بس هنا ظاهر من أي
// صفحة في لوحة التحكم (مش بس مركز التنبيهات) عشان الأدمن ميفوتش الميزة لو مادخلش هناك.
// بيختفي تلقائياً فور التفعيل، ولو مش متاح (متصفح مش مدعوم/إذن مرفوض نهائياً/الأدمن مالوش
// orders.view/مفيش تفضيل غير مفعّل أصلاً) — من غير أي استدعاء لـ Notification.requestPermission()
// إلا بعد ضغطة صريحة على "تفعيل".
export function AdminPushActivationCta() {
  const { user } = useAuth()
  const [state, setState] = useState<CtaState>('hidden')
  const [message, setMessage] = useState('')

  useEffect(() => {
    let cancelled = false

    async function evaluate() {
      if (!user || !user.permissions?.includes('orders.view')) { setState('hidden'); return }
      if (!isPushSupported()) { setState('hidden'); return }
      if (typeof Notification !== 'undefined' && Notification.permission === 'denied') { setState('hidden'); return }
      if (sessionStorage.getItem(DISMISS_KEY) === '1') { setState('hidden'); return }

      const [subStatus, pref] = await Promise.all([
        getPushSubscriptionStatus(),
        api.getAdminNotificationPreference().catch(() => ({ newOrders: false }))
      ])
      if (cancelled) return
      const alreadyActive = subStatus === 'subscribed' && pref.newOrders
      setState(alreadyActive || subStatus === 'denied' ? 'hidden' : 'offer')
    }

    evaluate()
    return () => { cancelled = true }
  }, [user])

  async function activate() {
    setState('activating')
    setMessage('')
    const result = await subscribeToPush()
    if (!result.ok) {
      setMessage(
        result.reason === 'permission_denied' ? 'تم رفض إذن الإشعارات من المتصفح'
          : result.reason === 'not_configured' ? 'الإشعارات غير مُفعّلة على السيرفر حالياً'
            : result.reason === 'unsupported' ? 'هذا المتصفح لا يدعم الإشعارات'
              : 'تعذر تفعيل الإشعارات، حاول مرة أخرى'
      )
      setState(result.reason === 'permission_denied' || result.reason === 'unsupported' ? 'hidden' : 'error')
      return
    }
    try {
      await api.setAdminNotificationPreference(true)
    } catch {
      setMessage('تم تفعيل الإذن لكن تعذر حفظ التفضيل على السيرفر، حاول مرة أخرى')
      setState('error')
      return
    }
    setState('hidden')
  }

  function dismiss() {
    try { sessionStorage.setItem(DISMISS_KEY, '1') } catch { /* تخزين أفضل-جهد بس */ }
    setState('hidden')
  }

  if (state === 'hidden') return null

  return (
    <div className="admin-push-cta" role="status" aria-live="polite">
      <div className="admin-push-cta-row">
        <span className="admin-push-cta-icon" aria-hidden="true">🔔</span>
        <div className="admin-push-cta-text">
          <div className="admin-push-cta-title">تفعيل إشعارات الطلبات</div>
          <div className="admin-push-cta-sub">
            {state === 'error' && message ? message : 'وصّلك إشعار فوري لحظة ما يوصل طلب جديد'}
          </div>
        </div>
        <button
          type="button"
          className="admin-push-cta-btn"
          disabled={state === 'activating'}
          onClick={activate}
        >
          {state === 'activating' ? 'جارٍ التفعيل...' : '🔔 تفعيل إشعارات الطلبات'}
        </button>
        <button type="button" className="admin-push-cta-dismiss" aria-label="إغلاق" onClick={dismiss}>×</button>
      </div>
    </div>
  )
}
