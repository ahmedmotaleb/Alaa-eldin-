import { useEffect, useState } from 'react'
import { useNavigate, useOutletContext, useParams } from 'react-router-dom'
import { api, ApiError, type AdminPurchaseOrderItem, type AdminProduct } from '../../utils/api'
import { formatMoney } from '../../utils/money'
import type { LayoutContext } from '../../components/AdminLayout'

interface ReceiveLine {
  productId: string
  productName: string
  remaining: number
  quantity: number
  unitCost: number
  batchNumber: string
  expiryDate: string
  manufacturedDate: string
  tracksExpiry: boolean
}

export function GoodsReceivingFormPage() {
  const { poId } = useParams()
  const navigate = useNavigate()
  const { setHeader } = useOutletContext<LayoutContext>()
  const [poNumber, setPoNumber] = useState('')
  const [lines, setLines] = useState<ReceiveLine[]>([])
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setHeader({ crumb: 'المشتريات', title: `استلام بضاعة ${poNumber || ''}` })
  }, [setHeader, poNumber])

  useEffect(() => {
    if (!poId) return
    Promise.all([api.getPurchaseOrder(poId), api.listProducts()])
      .then(([po, productsRes]) => {
        setPoNumber(po.order.poNumber)
        const productById = new Map<string, AdminProduct>(productsRes.products.map(p => [p.id, p]))
        const receivable = po.items
          .filter((item: AdminPurchaseOrderItem) => item.orderedQty > item.receivedQty)
          .map((item: AdminPurchaseOrderItem) => {
            const remaining = item.orderedQty - item.receivedQty
            const product = productById.get(item.productId)
            return {
              productId: item.productId,
              productName: item.productName,
              remaining,
              quantity: remaining,
              unitCost: item.unitCost,
              batchNumber: '',
              expiryDate: '',
              manufacturedDate: '',
              tracksExpiry: !!product?.tracksExpiry
            }
          })
        setLines(receivable)
      })
      .catch(() => setError('تعذر تحميل بيانات أمر الشراء'))
      .finally(() => setLoading(false))
  }, [poId])

  function updateLine(productId: string, patch: Partial<ReceiveLine>) {
    setLines(current => current.map(l => l.productId === productId ? { ...l, ...patch } : l))
  }

  async function submit() {
    if (!poId) return
    const toReceive = lines.filter(l => l.quantity > 0)
    if (toReceive.length === 0) { setError('أدخل كمية استلام لصنف واحد على الأقل'); return }
    for (const l of toReceive) {
      if (l.tracksExpiry && !l.expiryDate) { setError(`تاريخ الصلاحية مطلوب لـ "${l.productName}"`); return }
      if (l.quantity > l.remaining) { setError(`الكمية المُدخلة لـ "${l.productName}" أكبر من المتبقي`); return }
    }
    setError('')
    setSaving(true)
    try {
      await api.receiveGoods({
        purchaseOrderId: poId,
        notes,
        items: toReceive.map(l => ({
          productId: l.productId,
          quantity: l.quantity,
          unitCost: l.unitCost,
          batchNumber: l.batchNumber || null,
          expiryDate: l.expiryDate || null,
          manufacturedDate: l.manufacturedDate || null
        }))
      })
      navigate(`/purchasing/orders/edit/${poId}`)
    } catch (err) {
      setError(err instanceof ApiError ? 'تعذر تسجيل الاستلام، تحقق من البيانات' : 'حدث خطأ، حاول مرة أخرى')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return null

  return (
    <div className="admin-form-grid">
      <div className="admin-form-card" style={{ gridColumn: '1 / -1' }}>
        <div>
          <div className="admin-form-card-title">أصناف الاستلام</div>
          <div className="admin-form-card-sub">الكمية المتبقية من أمر الشراء لكل صنف — عدّل الكمية المستلمة فعلياً لو أقل</div>
        </div>
        {lines.map(line => (
          <div key={line.productId} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', borderBottom: '1px solid #EEF1EF', paddingBottom: 8 }}>
            <span style={{ minWidth: 160, fontWeight: 700 }}>{line.productName}</span>
            <span style={{ color: '#8A948C', fontSize: 12 }}>متبقي: {line.remaining}</span>
            <input
              type="number" min={0} max={line.remaining} value={line.quantity}
              onChange={e => updateLine(line.productId, { quantity: Number(e.target.value) })}
              style={{ width: 80 }} placeholder="الكمية المستلمة"
            />
            <input
              type="number" min={0} step="0.01" value={line.unitCost}
              onChange={e => updateLine(line.productId, { unitCost: Number(e.target.value) })}
              style={{ width: 100 }} placeholder="تكلفة الوحدة"
            />
            <input
              value={line.batchNumber}
              onChange={e => updateLine(line.productId, { batchNumber: e.target.value })}
              style={{ width: 120 }} placeholder="رقم الدفعة (اختياري)"
            />
            <input
              type="date" value={line.expiryDate}
              onChange={e => updateLine(line.productId, { expiryDate: e.target.value })}
              style={{ width: 150 }}
            />
            {line.tracksExpiry && <span style={{ color: '#B42318', fontSize: 12 }}>* تاريخ الصلاحية مطلوب</span>}
            <span style={{ minWidth: 80, fontWeight: 700 }}>{formatMoney(line.quantity * line.unitCost)}</span>
          </div>
        ))}
        {lines.length === 0 && <div className="admin-form-help">كل الأصناف في هذا الأمر تم استلامها بالكامل</div>}

        <label>ملاحظات
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} />
        </label>

        {error && <div className="admin-form-error">{error}</div>}
        {lines.length > 0 && <button className="admin-form-save" disabled={saving} onClick={submit}>تأكيد الاستلام</button>}
      </div>
    </div>
  )
}
