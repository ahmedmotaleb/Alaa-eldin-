import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, ApiError, type RiderOrder } from '../utils/api'
import { useAuth } from '../store/AuthContext'
import { formatMoney } from '../utils/money'
import { ORDER_STATUS_LABEL, ORDER_STATUS_COLOR } from '../orderStatus'

// شاشة مخصصة للمندوب على الموبايل — منفصلة تماماً عن لوحة التحكم الكاملة (بدون nav جانبي
// أو أقسام تانية)؛ بتعرض بس طلباته النشطة المُسندة له، بأزرار كبيرة سهلة اللمس، وبتحدّث
// حالة الطلب فعلياً عبر /api/rider (مقصور على طلباته هو بس، مش أي طلب في النظام).
export function RiderOrdersPage() {
  const { user, loading, logout } = useAuth()
  const navigate = useNavigate()
  const [orders, setOrders] = useState<RiderOrder[] | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState('')

  useEffect(() => {
    if (!loading && !user) navigate('/login', { replace: true })
  }, [loading, user, navigate])

  function load() {
    api.listMyRiderOrders(showAll)
      .then(({ orders }) => setOrders(orders))
      .catch(err => setError(err instanceof ApiError && err.code === 'not_a_rider'
        ? 'هذا الحساب غير مرتبط بمندوب توصيل'
        : 'تعذر تحميل الطلبات'))
  }

  useEffect(load, [showAll])

  async function advance(order: RiderOrder) {
    const nextStatus = order.status === 'ready_for_delivery' ? 'out_for_delivery'
      : order.status === 'out_for_delivery' ? 'delivered'
      : null
    if (!nextStatus) return
    setBusyId(order.id)
    try {
      await api.updateMyRiderOrderStatus(order.id, nextStatus)
      load()
    } catch {
      setError('تعذر تحديث حالة الطلب، حاول مرة أخرى')
    } finally {
      setBusyId('')
    }
  }

  async function doLogout() {
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <div style={{ minHeight: '100vh', background: '#F7F8F7', padding: 12, fontFamily: 'inherit' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <strong style={{ fontSize: 18 }}>🛵 طلباتي</strong>
        <button className="admin-category-card-btn" onClick={doLogout}>خروج</button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button className={`admin-form-chip ${!showAll ? 'active' : ''}`} onClick={() => setShowAll(false)}>النشطة</button>
        <button className={`admin-form-chip ${showAll ? 'active' : ''}`} onClick={() => setShowAll(true)}>الكل</button>
      </div>

      {error && <div className="admin-placeholder-card"><div className="admin-placeholder-note">{error}</div></div>}

      {orders && orders.length === 0 && !error && (
        <div className="admin-placeholder-card"><div className="admin-placeholder-note">مفيش طلبات مُسندة ليك دلوقتي</div></div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {orders?.map(order => {
          const [bg, fg] = ORDER_STATUS_COLOR[order.status]
          const nextLabel = order.status === 'ready_for_delivery' ? '🚴 بدء التوصيل'
            : order.status === 'out_for_delivery' ? '✅ تم التسليم'
            : null
          return (
            <div key={order.id} style={{ background: '#fff', borderRadius: 14, padding: 14, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <strong>{order.orderNumber}</strong>
                <span className="admin-pill" style={{ background: bg, color: fg }}>{ORDER_STATUS_LABEL[order.status]}</span>
              </div>
              <div style={{ fontSize: 14, marginBottom: 4 }}>👤 {order.customerFullName}</div>
              <div style={{ fontSize: 14, marginBottom: 4 }}>
                📞 <a href={`tel:${order.customerMobile}`} style={{ color: '#12813C', fontWeight: 700 }}>{order.customerMobile}</a>
              </div>
              <div style={{ fontSize: 14, marginBottom: 4 }}>🗺️ {order.customerGovernorate}</div>
              <div style={{ fontSize: 14, marginBottom: 8, color: '#4C5B51' }}>📍 {order.customerAddress}</div>
              <div style={{ fontSize: 14, marginBottom: 10, fontWeight: 700 }}>
                💵 {order.paymentMethod === 'COD' ? `${formatMoney(order.total)} كاش عند التسليم` : formatMoney(order.total)}
              </div>
              {nextLabel && (
                <button
                  className="admin-form-save"
                  style={{ width: '100%', padding: 14, fontSize: 16 }}
                  disabled={busyId === order.id}
                  onClick={() => advance(order)}
                >
                  {busyId === order.id ? 'جارٍ التحديث...' : nextLabel}
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
