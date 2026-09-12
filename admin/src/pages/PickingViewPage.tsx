import { useEffect, useState } from 'react'
import { useNavigate, useOutletContext, useParams } from 'react-router-dom'
import { api, ApiError, type AdminOrder, type PickedStatus } from '../utils/api'
import { ALLOWED_NEXT_STATUSES, ORDER_STATUS_LABEL } from '../orderStatus'
import type { LayoutContext } from '../components/AdminLayout'

const STATUS_LABEL: Record<PickedStatus, string> = {
  pending: 'لسه', picked: 'تم التجهيز', substituted: 'استبدال', unavailable: 'غير متوفر'
}
const STATUS_TINT: Record<PickedStatus, { bg: string, fg: string }> = {
  pending: { bg: '#F1F4F2', fg: '#68746B' },
  picked: { bg: '#EAF8EF', fg: '#12813C' },
  substituted: { bg: '#FFF3E3', fg: '#B4740E' },
  unavailable: { bg: '#FFF0EF', fg: '#B42318' }
}

// وضع تجهيز الطلب لفريق المخزن — حالة كل صنف بتتسجّل فعلياً على السيرفر (مش محلية بس في
// المتصفح زي ما كانت قبل كده)، عشان تفضل موجودة لو حصل refresh، وعشان تبقى أساس "الإيصال
// الحقيقي" اللي بيشوفه العميل لو حصل استبدال أو نقص فعلي.
export function PickingViewPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { setHeader } = useOutletContext<LayoutContext>()
  const [order, setOrder] = useState<AdminOrder | null>(null)
  const [error, setError] = useState('')
  const [updating, setUpdating] = useState(false)
  const [savingItemId, setSavingItemId] = useState<number | null>(null)

  function load() {
    if (!id) return
    api.getOrder(id)
      .then(({ order }) => setOrder(order))
      .catch(err => setError(err instanceof ApiError ? 'تعذر تحميل الطلب' : 'حدث خطأ، حاول مرة أخرى'))
  }

  useEffect(load, [id])

  useEffect(() => {
    setHeader({ crumb: 'الطلبات', title: order ? `تجهيز الطلب ${order.orderNumber}` : 'تجهيز الطلب' })
  }, [order, setHeader])

  if (error) return <div className="admin-placeholder-card"><div className="admin-placeholder-note">{error}</div></div>
  if (!order) return null

  const allResolved = order.items.length > 0 && order.items.every(item => item.pickedStatus !== 'pending')
  const nextStatus = ALLOWED_NEXT_STATUSES[order.status].includes('ready_for_delivery') ? 'ready_for_delivery' : null

  async function setStatus(itemId: number, status: PickedStatus) {
    if (!id) return
    let note = ''
    if (status === 'substituted' || status === 'unavailable') {
      const promptText = status === 'substituted' ? 'اتستبدل بإيه؟ (اختياري)' : 'سبب عدم التوفر (اختياري)'
      note = window.prompt(promptText) ?? ''
    }
    setSavingItemId(itemId)
    try {
      await api.setOrderItemPickedStatus(id, itemId, status, note)
      load()
    } catch {
      window.alert('تعذر تحديث حالة الصنف — حاول تاني')
    } finally {
      setSavingItemId(null)
    }
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
      {order.deliveryInstructions && (
        <div style={{ margin: '0 14px 10px', padding: '10px 12px', background: '#EAF2FF', borderRadius: 10, fontSize: 12.5, fontWeight: 700, color: '#1D5BBF' }}>
          📝 تعليمات التوصيل: {order.deliveryInstructions}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 14 }}>
        {order.items.map(item => {
          const tint = STATUS_TINT[item.pickedStatus]
          const saving = savingItemId === item.id
          return (
            <div key={item.id} className="admin-table-row" style={{ gridTemplateColumns: '1fr auto', alignItems: 'center', gap: 10 }}>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontWeight: 800, fontSize: 13.5 }}>{item.name}</span>
                <span style={{ fontWeight: 600, fontSize: 12, color: '#68746B' }}>{item.quantity} × {item.unit}</span>
                {item.pickedNote && <span style={{ fontWeight: 600, fontSize: 11.5, color: '#8A948C' }}>{item.pickedNote}</span>}
              </span>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <span className="admin-pill" style={{ background: tint.bg, color: tint.fg }}>{STATUS_LABEL[item.pickedStatus]}</span>
                <button className="admin-form-chip" disabled={saving} onClick={() => setStatus(item.id, 'picked')}>تم</button>
                <button className="admin-form-chip" disabled={saving} onClick={() => setStatus(item.id, 'substituted')}>استبدال</button>
                <button className="admin-form-chip" disabled={saving} onClick={() => setStatus(item.id, 'unavailable')}>غير متوفر</button>
              </div>
            </div>
          )
        })}
      </div>
      <div className="admin-table-footer">
        <span>{order.items.filter(i => i.pickedStatus !== 'pending').length} / {order.items.length} اتجهزوا</span>
        {nextStatus ? (
          <button className="admin-action-button" disabled={!allResolved || updating} onClick={markReady}>
            نقل لحالة "{ORDER_STATUS_LABEL[nextStatus]}"
          </button>
        ) : (
          <span style={{ color: '#8A948C', fontWeight: 600, fontSize: 12.5 }}>حالة الطلب الحالية ({ORDER_STATUS_LABEL[order.status]}) ما بتسمحش بالانتقال ده</span>
        )}
      </div>
    </div>
  )
}
