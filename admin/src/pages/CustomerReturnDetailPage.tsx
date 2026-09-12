import { useEffect, useState } from 'react'
import { useNavigate, useOutletContext, useParams } from 'react-router-dom'
import { api, ApiError, type AdminOrder, type ReturnItemCondition, type CustomerReturnStatus, type AdminCustomerReturnItem } from '../utils/api'
import { formatMoney } from '../utils/money'
import type { LayoutContext } from '../components/AdminLayout'

const CONDITION_LABEL: Record<ReturnItemCondition, string> = {
  return_to_stock: 'يرجع للمخزون', damaged: 'تالف', expired: 'منتهي الصلاحية', discard: 'إتلاف'
}
const STATUS_LABEL: Record<CustomerReturnStatus, string> = {
  requested: 'مطلوب', approved: 'تمت الموافقة', received: 'تم الاستلام', refunded: 'تم الاسترداد', rejected: 'مرفوض', cancelled: 'ملغي'
}

interface NewLine {
  key: string
  orderItemId: number
  productId: string
  productName: string
  maxQuantity: number
  quantity: number
  condition: ReturnItemCondition
}

export function CustomerReturnDetailPage() {
  const { id } = useParams()
  const isNew = !id
  const navigate = useNavigate()
  const { setHeader } = useOutletContext<LayoutContext>()

  const [orderIdInput, setOrderIdInput] = useState('')
  const [order, setOrder] = useState<AdminOrder | null>(null)
  const [lines, setLines] = useState<NewLine[]>([])
  const [reason, setReason] = useState('')
  const [notes, setNotes] = useState('')
  const [returnNumber, setReturnNumber] = useState('')
  const [status, setStatus] = useState<CustomerReturnStatus>('requested')
  const [items, setItems] = useState<AdminCustomerReturnItem[]>([])
  const [refundAmount, setRefundAmount] = useState(0)
  const [loading, setLoading] = useState(!isNew)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setHeader({ crumb: 'الطلبات', title: isNew ? 'إنشاء مرتجع عميل' : `مرتجع ${returnNumber}` })
  }, [setHeader, isNew, returnNumber])

  useEffect(() => {
    if (!id) return
    api.getCustomerReturn(id)
      .then(({ customerReturn, items }) => {
        setReturnNumber(customerReturn.returnNumber)
        setStatus(customerReturn.status)
        setRefundAmount(customerReturn.refundAmount)
        setItems(items)
      })
      .catch(() => setError('تعذر تحميل المرتجع'))
      .finally(() => setLoading(false))
  }, [id])

  async function lookupOrder() {
    if (!orderIdInput.trim()) return
    setError('')
    try {
      const { order } = await api.getOrder(orderIdInput.trim())
      setOrder(order)
      setLines(order.items.map(item => ({
        key: crypto.randomUUID(), orderItemId: item.id, productId: item.productId, productName: item.name,
        maxQuantity: item.quantity, quantity: item.quantity, condition: 'return_to_stock'
      })))
    } catch {
      setError('تعذر إيجاد طلب بهذا المعرّف')
    }
  }

  function updateLine(key: string, patch: Partial<NewLine>) {
    setLines(current => current.map(l => l.key === key ? { ...l, ...patch } : l))
  }

  async function create() {
    if (!order || lines.length === 0) return
    setError('')
    setSaving(true)
    try {
      const { customerReturn } = await api.createCustomerReturn({
        orderId: order.id, reason, notes,
        items: lines.filter(l => l.quantity > 0).map(l => ({ orderItemId: l.orderItemId, productId: l.productId, quantity: l.quantity, condition: l.condition }))
      })
      navigate(`/orders/returns/${customerReturn.id}`, { replace: true })
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'exceeds_sold_quantity' ? 'الكمية المطلوبة أكبر من المباعة فعلياً' : 'تعذر إنشاء المرتجع')
    } finally {
      setSaving(false)
    }
  }

  async function setReturnStatus(next: CustomerReturnStatus) {
    if (!id) return
    try {
      const { customerReturn } = await api.setCustomerReturnStatus(id, next)
      setStatus(customerReturn.status)
      setSuccess('تم تحديث الحالة')
    } catch {
      window.alert('تعذر تحديث الحالة')
    }
  }

  if (loading) return null

  if (isNew) {
    return (
      <div className="admin-form-grid">
        <div className="admin-form-card">
          <div>
            <div className="admin-form-card-title">إيجاد الطلب</div>
            <div className="admin-form-card-sub">أدخل معرّف الطلب (نفس الرابط المستخدم في تفاصيل الطلب)</div>
          </div>
          <label>معرّف الطلب
            <input value={orderIdInput} onChange={e => setOrderIdInput(e.target.value)} placeholder="مثال: ord_123..." />
          </label>
          <button type="button" className="admin-form-chip" onClick={lookupOrder}>بحث</button>
          {error && <div className="admin-form-error">{error}</div>}
        </div>

        {order && (
          <div className="admin-form-card">
            <div>
              <div className="admin-form-card-title">أصناف الطلب {order.orderNumber}</div>
              <div className="admin-form-card-sub">حدد الكمية وحالة كل صنف مُرجع</div>
            </div>
            {lines.map(line => (
              <div key={line.key} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', borderBottom: '1px solid #EEF1EF', paddingBottom: 8 }}>
                <span style={{ minWidth: 140, fontWeight: 700 }}>{line.productName}</span>
                <input
                  type="number" min={0} max={line.maxQuantity} value={line.quantity}
                  onChange={e => updateLine(line.key, { quantity: Number(e.target.value) })}
                  style={{ width: 80 }}
                />
                <span style={{ color: '#8A948C', fontSize: 12 }}>من أصل {line.maxQuantity}</span>
                <select value={line.condition} onChange={e => updateLine(line.key, { condition: e.target.value as ReturnItemCondition })}>
                  {(Object.keys(CONDITION_LABEL) as ReturnItemCondition[]).map(c => <option key={c} value={c}>{CONDITION_LABEL[c]}</option>)}
                </select>
              </div>
            ))}
            <label>سبب الإرجاع
              <input value={reason} onChange={e => setReason(e.target.value)} />
            </label>
            <label>ملاحظات
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} />
            </label>
            <button className="admin-form-save" disabled={saving} onClick={create}>إنشاء طلب المرتجع</button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="admin-form-grid">
      <div className="admin-form-card">
        <div><div className="admin-form-card-title">بيانات المرتجع</div></div>
        <div className="admin-form-help">الحالة: <strong>{STATUS_LABEL[status]}</strong></div>
        <div className="admin-form-help">قيمة الاسترداد: <strong>{formatMoney(refundAmount)}</strong></div>
        {status === 'requested' && <>
          <button className="admin-form-chip" onClick={() => setReturnStatus('approved')}>الموافقة على المرتجع</button>
          <button className="admin-form-chip" onClick={() => setReturnStatus('rejected')}>رفض المرتجع</button>
        </>}
        {status === 'approved' && <button className="admin-form-chip" onClick={() => setReturnStatus('received')}>تأكيد استلام البضاعة</button>}
        {status === 'received' && <button className="admin-form-chip" onClick={() => setReturnStatus('refunded')}>تأكيد الاسترداد (يتم يدوياً خارج النظام)</button>}
        {(status === 'requested' || status === 'approved') && <button className="admin-form-chip" onClick={() => setReturnStatus('cancelled')}>إلغاء</button>}
        {success && <div className="admin-form-success">{success}</div>}
      </div>
      <div className="admin-form-card">
        <div><div className="admin-form-card-title">الأصناف</div></div>
        {items.map(item => (
          <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>{item.productName} × {item.quantity} ({CONDITION_LABEL[item.condition]})</span>
            <span style={{ fontWeight: 700 }}>{formatMoney(item.refundAmount)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
