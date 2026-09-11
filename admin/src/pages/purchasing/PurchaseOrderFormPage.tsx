import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useOutletContext, useParams } from 'react-router-dom'
import { api, ApiError, type AdminProduct, type AdminSupplier, type PurchaseOrderItemInput, type PurchaseOrderStatus } from '../../utils/api'
import { formatMoney } from '../../utils/money'
import type { LayoutContext } from '../../components/AdminLayout'

const STATUS_LABEL: Record<PurchaseOrderStatus, string> = {
  draft: 'مسودة',
  submitted: 'مُرسل للمورد',
  partially_received: 'استلام جزئي',
  received: 'مكتمل',
  cancelled: 'ملغي'
}

interface LineRow extends PurchaseOrderItemInput {
  key: string
}

export function PurchaseOrderFormPage() {
  const { id } = useParams()
  const isEdit = Boolean(id)
  const navigate = useNavigate()
  const { setHeader } = useOutletContext<LayoutContext>()

  const [suppliers, setSuppliers] = useState<AdminSupplier[]>([])
  const [products, setProducts] = useState<AdminProduct[]>([])
  const [supplierId, setSupplierId] = useState('')
  const [expectedDate, setExpectedDate] = useState('')
  const [notes, setNotes] = useState('')
  const [discount, setDiscount] = useState(0)
  const [shippingCost, setShippingCost] = useState(0)
  const [lines, setLines] = useState<LineRow[]>([])
  const [status, setStatus] = useState<PurchaseOrderStatus>('draft')
  const [poNumber, setPoNumber] = useState('')

  const [loading, setLoading] = useState(isEdit)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [saving, setSaving] = useState(false)

  const editable = !isEdit || status === 'draft'

  useEffect(() => {
    setHeader({ crumb: 'المشتريات', title: isEdit ? `أمر شراء ${poNumber || ''}` : 'إنشاء أمر شراء' })
  }, [setHeader, isEdit, poNumber])

  useEffect(() => {
    api.listSuppliers({ activeOnly: !isEdit }).then(({ suppliers }) => setSuppliers(suppliers)).catch(() => {})
    api.listProducts().then(({ products }) => setProducts(products)).catch(() => {})
  }, [isEdit])

  useEffect(() => {
    if (!id) return
    api.getPurchaseOrder(id)
      .then(({ order, items }) => {
        setSupplierId(order.supplierId)
        setExpectedDate(order.expectedDate ?? '')
        setNotes(order.notes)
        setDiscount(order.discount)
        setShippingCost(order.shippingCost)
        setStatus(order.status)
        setPoNumber(order.poNumber)
        setLines(items.map(item => ({ key: item.id, productId: item.productId, orderedQty: item.orderedQty, unitCost: item.unitCost })))
      })
      .catch(() => setError('تعذر تحميل أمر الشراء'))
      .finally(() => setLoading(false))
  }, [id])

  function addLine() {
    const firstAvailable = products.find(p => !lines.some(l => l.productId === p.id))
    if (!firstAvailable) return
    setLines(current => [...current, { key: crypto.randomUUID(), productId: firstAvailable.id, orderedQty: 1, unitCost: firstAvailable.cost }])
  }

  function updateLine(key: string, patch: Partial<PurchaseOrderItemInput>) {
    setLines(current => current.map(l => l.key === key ? { ...l, ...patch } : l))
  }

  function removeLine(key: string) {
    setLines(current => current.filter(l => l.key !== key))
  }

  const subtotal = useMemo(() => lines.reduce((sum, l) => sum + l.orderedQty * l.unitCost, 0), [lines])
  const total = useMemo(() => Math.max(0, subtotal - discount) + shippingCost, [subtotal, discount, shippingCost])

  async function save() {
    if (!supplierId) { setError('اختر مورد أولاً'); return }
    if (lines.length === 0) { setError('أضف صنف واحد على الأقل'); return }
    setError('')
    setSuccess('')
    setSaving(true)
    try {
      const body = {
        supplierId,
        expectedDate: expectedDate || null,
        notes,
        discount,
        shippingCost,
        items: lines.map(l => ({ productId: l.productId, orderedQty: l.orderedQty, unitCost: l.unitCost }))
      }
      if (isEdit && id) {
        const { order } = await api.updatePurchaseOrder(id, body)
        setStatus(order.status)
        setSuccess('تم حفظ التعديلات')
      } else {
        const { order } = await api.createPurchaseOrder(body)
        setSuccess('تم إنشاء أمر الشراء')
        navigate(`/purchasing/orders/edit/${order.id}`, { replace: true })
      }
    } catch (err) {
      setError(err instanceof ApiError ? 'تعذر حفظ أمر الشراء، تحقق من البيانات' : 'حدث خطأ، حاول مرة أخرى')
    } finally {
      setSaving(false)
    }
  }

  async function setOrderStatus(next: PurchaseOrderStatus) {
    if (!id) return
    try {
      const { order } = await api.setPurchaseOrderStatus(id, next)
      setStatus(order.status)
      setSuccess(next === 'cancelled' ? 'تم إلغاء أمر الشراء' : 'تم إرسال أمر الشراء للمورد')
    } catch {
      window.alert('تعذر تحديث حالة أمر الشراء')
    }
  }

  if (loading) return null

  return (
    <div className="admin-form-grid">
      <div className="admin-form-card">
        <div>
          <div className="admin-form-card-title">بيانات الأمر</div>
          <div className="admin-form-card-sub">المورد والتفاصيل الأساسية</div>
        </div>
        <label>المورد
          <select value={supplierId} disabled={!editable} onChange={e => setSupplierId(e.target.value)}>
            <option value="">اختر مورد...</option>
            {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label>تاريخ التسليم المتوقع
          <input type="date" value={expectedDate ? expectedDate.slice(0, 10) : ''} disabled={!editable} onChange={e => setExpectedDate(e.target.value)} />
        </label>
        <label>ملاحظات
          <textarea value={notes} disabled={!editable} onChange={e => setNotes(e.target.value)} rows={2} />
        </label>
        {isEdit && (
          <div className="admin-form-help">
            الحالة الحالية: <strong>{STATUS_LABEL[status]}</strong>
          </div>
        )}
        {isEdit && status === 'draft' && (
          <button className="admin-form-chip" type="button" onClick={() => setOrderStatus('submitted')}>إرسال الأمر للمورد</button>
        )}
        {isEdit && (status === 'draft' || status === 'submitted' || status === 'partially_received') && (
          <button className="admin-form-chip" type="button" onClick={() => setOrderStatus('cancelled')}>إلغاء أمر الشراء</button>
        )}
      </div>

      <div className="admin-form-card">
        <div>
          <div className="admin-form-card-title">الأصناف</div>
          <div className="admin-form-card-sub">الكميات والتكلفة لكل صنف</div>
        </div>
        {lines.map(line => (
          <div key={line.key} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <select
              value={line.productId}
              disabled={!editable}
              onChange={e => updateLine(line.key, { productId: e.target.value })}
              style={{ flex: '1 1 200px' }}
            >
              {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <input
              type="number" min={1} value={line.orderedQty} disabled={!editable}
              onChange={e => updateLine(line.key, { orderedQty: Number(e.target.value) })}
              style={{ width: 80 }} placeholder="الكمية"
            />
            <input
              type="number" min={0} step="0.01" value={line.unitCost} disabled={!editable}
              onChange={e => updateLine(line.key, { unitCost: Number(e.target.value) })}
              style={{ width: 100 }} placeholder="تكلفة الوحدة"
            />
            <span style={{ minWidth: 80, fontWeight: 700 }}>{formatMoney(line.orderedQty * line.unitCost)}</span>
            {editable && <button type="button" className="admin-form-chip" onClick={() => removeLine(line.key)}>حذف</button>}
          </div>
        ))}
        {editable && <button type="button" className="admin-form-chip" onClick={addLine}>+ إضافة صنف</button>}
        {lines.length === 0 && <div className="admin-form-help">أضف صنف واحد على الأقل</div>}

        <label>الخصم (ج.م)
          <input type="number" min={0} step="0.01" value={discount} disabled={!editable} onChange={e => setDiscount(Number(e.target.value))} />
        </label>
        <label>تكلفة الشحن (ج.م)
          <input type="number" min={0} step="0.01" value={shippingCost} disabled={!editable} onChange={e => setShippingCost(Number(e.target.value))} />
        </label>
        <div className="admin-form-help">الإجمالي الفرعي: {formatMoney(subtotal)}</div>
        <div style={{ fontWeight: 900 }}>الإجمالي: {formatMoney(total)}</div>

        {error && <div className="admin-form-error">{error}</div>}
        {success && <div className="admin-form-success">{success}</div>}
        {editable && (
          <button className="admin-form-save" disabled={saving} onClick={save}>{isEdit ? 'حفظ التعديلات' : 'إنشاء أمر الشراء'}</button>
        )}
      </div>
    </div>
  )
}
