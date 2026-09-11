import { useEffect, useState } from 'react'
import { useNavigate, useOutletContext, useParams } from 'react-router-dom'
import { api, ApiError, type AdminOrder } from '../utils/api'
import { ALLOWED_NEXT_STATUSES, ORDER_STATUS_LABEL } from '../orderStatus'
import type { LayoutContext } from '../components/AdminLayout'

// وضع تجهيز الطلب لفريق المخزن — قايمة تحقق بسيطة (اتقفت المنتجات فعلياً من على الرف؟).
// حالة الصح دي محلية بس في المتصفح، ومالهاش أي علاقة بحالة الطلب الحقيقية في قاعدة
// البيانات — لما كل الأصناف تتحقق، الزر بيعرض الانتقال المناسب (لو لسه مسموح فعلاً)،
// لكن السيرفر يفضل هو المرجع الوحيد اللي بيثبّت التحديث.
export function PickingViewPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { setHeader } = useOutletContext<LayoutContext>()
  const [order, setOrder] = useState<AdminOrder | null>(null)
  const [error, setError] = useState('')
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const [updating, setUpdating] = useState(false)

  useEffect(() => {
    if (!id) return
    api.getOrder(id)
      .then(({ order }) => setOrder(order))
      .catch(err => setError(err instanceof ApiError ? 'تعذر تحميل الطلب' : 'حدث خطأ، حاول مرة أخرى'))
  }, [id])

  useEffect(() => {
    setHeader({ crumb: 'الطلبات', title: order ? `تجهيز الطلب ${order.orderNumber}` : 'تجهيز الطلب' })
  }, [order, setHeader])

  if (error) return <div className="admin-placeholder-card"><div className="admin-placeholder-note">{error}</div></div>
  if (!order) return null

  const allChecked = order.items.length > 0 && order.items.every(item => checked[item.productId])
  const nextStatus = ALLOWED_NEXT_STATUSES[order.status].includes('ready_for_delivery') ? 'ready_for_delivery' : null

  function toggle(productId: string) {
    setChecked(current => ({ ...current, [productId]: !current[productId] }))
  }

  async function markReady() {
    if (!nextStatus || !order || !id) return
    setUpdating(true)
    try {
      await api.updateOrderStatus(id, nextStatus)
      navigate('/orders/all')
    } catch {
      window.alert('تعذر تحديث حالة الطلب — حاول تاني')
    } finally {
      setUpdating(false)
    }
  }

  return (
    <div className="admin-table-card">
      <div className="admin-table-tools">
        <div style={{ fontWeight: 800, fontSize: 13.5 }}>{order.customer.fullName} — {order.customer.governorate}</div>
        <div style={{ color: '#68746B', fontWeight: 600, fontSize: 12.5 }}>{order.items.length} صنف</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 14 }}>
        {order.items.map(item => (
          <label
            key={item.productId}
            className="admin-table-row"
            style={{ gridTemplateColumns: '1fr auto', cursor: 'pointer', alignItems: 'center' }}
          >
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2, textDecoration: checked[item.productId] ? 'line-through' : 'none', color: checked[item.productId] ? '#8A948C' : '#17221a' }}>
              <span style={{ fontWeight: 800, fontSize: 13.5 }}>{item.name}</span>
              <span style={{ fontWeight: 600, fontSize: 12, color: '#68746B' }}>{item.quantity} × {item.unit}</span>
            </span>
            <input
              type="checkbox"
              checked={!!checked[item.productId]}
              onChange={() => toggle(item.productId)}
              style={{ width: 22, height: 22 }}
            />
          </label>
        ))}
      </div>
      <div className="admin-table-footer">
        <span>{Object.values(checked).filter(Boolean).length} / {order.items.length} اتجهزوا</span>
        {nextStatus ? (
          <button className="admin-action-button" disabled={!allChecked || updating} onClick={markReady}>
            نقل لحالة "{ORDER_STATUS_LABEL[nextStatus]}"
          </button>
        ) : (
          <span style={{ color: '#8A948C', fontWeight: 600, fontSize: 12.5 }}>حالة الطلب الحالية ({ORDER_STATUS_LABEL[order.status]}) ما بتسمحش بالانتقال ده</span>
        )}
      </div>
    </div>
  )
}
