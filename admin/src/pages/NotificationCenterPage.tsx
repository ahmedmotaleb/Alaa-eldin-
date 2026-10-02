import { useEffect, useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { api, ApiError, type Alert } from '../utils/api'
import { ALERT_SEVERITY_TINT, ALERT_SEVERITY_ICON } from '../utils/alertPresentation'
import { isPushSupported, subscribeToPush, unsubscribeFromPush, getPushSubscriptionStatus } from '../utils/push'
import type { LayoutContext } from '../components/AdminLayout'

type NewOrderPushState = 'loading' | 'unsupported' | 'denied' | 'enabled' | 'not_enabled'

// منطقة تفعيل إشعارات "طلب جديد" الإدارية — نفس البنية التحتية بتاعة إشعارات العميل
// (نفس جدول push_subscriptions، نفس مفتاح VAPID)، بس بتفضيل منفصل (admin_new_orders)
// ومفيش أي استدعاء لـ Notification.requestPermission() إلا بعد ضغطة صريحة على "تفعيل
// الإشعارات" (راجع admin/src/utils/push.ts).
function NewOrderPushControl() {
  const [state, setState] = useState<NewOrderPushState>('loading')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [testSending, setTestSending] = useState(false)

  async function refresh() {
    if (!isPushSupported()) { setState('unsupported'); return }
    if (typeof Notification !== 'undefined' && Notification.permission === 'denied') { setState('denied'); return }
    const [subStatus, pref] = await Promise.all([
      getPushSubscriptionStatus(),
      api.getAdminNotificationPreference().catch(() => ({ newOrders: false }))
    ])
    if (subStatus === 'denied') { setState('denied'); return }
    setState(subStatus === 'subscribed' && pref.newOrders ? 'enabled' : 'not_enabled')
  }

  useEffect(() => { refresh() }, [])

  async function enable() {
    setBusy(true)
    setMessage('')
    const result = await subscribeToPush()
    if (!result.ok) {
      setMessage(
        result.reason === 'permission_denied' ? 'تم رفض إذن الإشعارات من المتصفح'
          : result.reason === 'not_configured' ? 'الإشعارات غير مُفعّلة على السيرفر حالياً'
            : result.reason === 'unsupported' ? 'هذا المتصفح لا يدعم الإشعارات'
              : 'تعذر تفعيل الإشعارات، حاول مرة أخرى'
      )
      setBusy(false)
      await refresh()
      return
    }
    try {
      await api.setAdminNotificationPreference(true)
    } catch {
      setMessage('تعذر حفظ التفضيل على السيرفر، حاول مرة أخرى')
    }
    setBusy(false)
    await refresh()
  }

  async function disable() {
    setBusy(true)
    setMessage('')
    try {
      await api.setAdminNotificationPreference(false)
    } catch {
      // أفضل-جهد — حتى لو فشل حفظ التفضيل، نكمل إلغاء الاشتراك من المتصفح برضه.
    }
    await unsubscribeFromPush()
    setBusy(false)
    await refresh()
  }

  async function sendTest() {
    setTestSending(true)
    setMessage('')
    try {
      await api.sendTestNotification()
      setMessage('تم إرسال إشعار تجريبي — هيوصلك خلال لحظات')
    } catch {
      setMessage('تعذر إرسال الإشعار التجريبي')
    } finally {
      setTestSending(false)
    }
  }

  if (state === 'loading') return null

  return (
    <div className="admin-form-card" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 14 }}>
            {state === 'enabled' ? '🔔 إشعارات الطلبات الجديدة مفعلة' : '🔔 إشعارات الطلبات الجديدة'}
          </div>
          {state === 'denied' && (
            <div style={{ fontSize: 12.5, color: '#8A948C', marginTop: 4 }}>
              الإشعارات محظورة من إعدادات المتصفح — لازم تفعّل إذن الإشعارات لموقع لوحة التحكم من إعدادات المتصفح أو التطبيق أولاً، ثم أعد تحميل الصفحة.
            </div>
          )}
          {state === 'unsupported' && (
            <div style={{ fontSize: 12.5, color: '#8A948C', marginTop: 4 }}>هذا المتصفح/الجهاز لا يدعم الإشعارات الفورية</div>
          )}
          {state === 'not_enabled' && (
            <div style={{ fontSize: 12.5, color: '#8A948C', marginTop: 4 }}>فعّلها على هذا الجهاز عشان توصلك إشعار فوري لحظة وصول أي طلب جديد</div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {state === 'not_enabled' && (
            <button className="admin-category-card-btn" disabled={busy} onClick={enable}>تفعيل الإشعارات</button>
          )}
          {state === 'enabled' && (
            <>
              <button className="admin-category-card-btn" disabled={testSending} onClick={sendTest}>
                {testSending ? 'جارٍ الإرسال...' : 'إرسال إشعار تجريبي لهذا الجهاز'}
              </button>
              <button className="admin-category-card-btn" disabled={busy} onClick={disable}>إيقاف</button>
            </>
          )}
        </div>
      </div>
      {message && <div style={{ fontSize: 12, marginTop: 8, color: '#4C5B51' }}>{message}</div>}
    </div>
  )
}

export function NotificationCenterPage() {
  const navigate = useNavigate()
  const { setHeader } = useOutletContext<LayoutContext>()
  const [alerts, setAlerts] = useState<Alert[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    setHeader({ crumb: 'مركز التنبيهات', title: 'التنبيهات' })
  }, [setHeader])

  useEffect(() => {
    api.getAlerts()
      .then(({ alerts }) => setAlerts(alerts))
      .catch(err => setError(err instanceof ApiError ? 'تعذر تحميل التنبيهات' : 'حدث خطأ، حاول مرة أخرى'))
  }, [])

  if (error) return <div className="admin-placeholder-card"><div className="admin-placeholder-note">{error}</div></div>
  if (!alerts) return null

  if (alerts.length === 0) {
    return (
      <>
        <NewOrderPushControl />
        <div className="admin-placeholder-card"><div className="admin-placeholder-note">مفيش تنبيهات دلوقتي — كل حاجة تمام 🎉</div></div>
      </>
    )
  }

  return (
    <>
      <NewOrderPushControl />
      <div className="admin-table-card">
        <div className="admin-table-scroll">
          <div>
            {alerts.map(alert => {
              const tint = ALERT_SEVERITY_TINT[alert.severity]
              return (
                <div
                  key={alert.category}
                  className="admin-table-row clickable"
                  style={{ gridTemplateColumns: '40px 1fr auto', alignItems: 'center' }}
                  onClick={() => navigate(alert.link)}
                >
                  <div style={{ fontSize: 18 }}>{ALERT_SEVERITY_ICON[alert.severity]}</div>
                  <div className="admin-cell-plain" style={{ fontWeight: 700 }}>{alert.label}</div>
                  <div><span className="admin-pill" style={{ background: tint.bg, color: tint.fg }}>{alert.count}</span></div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </>
  )
}
