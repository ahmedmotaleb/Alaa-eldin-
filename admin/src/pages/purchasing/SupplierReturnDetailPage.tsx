import { useEffect, useState } from 'react'
import { useNavigate, useOutletContext, useParams } from 'react-router-dom'
import { api, ApiError, type AdminSupplier, type AdminProduct, type AdminSupplierReturnItem, type SupplierReturnStatus } from '../../utils/api'
import { formatMoney } from '../../utils/money'
import type { LayoutContext } from '../../components/AdminLayout'

const STATUS_LABEL: Record<SupplierReturnStatus, string> = {
  draft: 'مسودة', approved: 'تمت الموافقة', sent: 'تم الإرسال', completed: 'مكتمل', cancelled: 'ملغي'
}

interface NewLine {
  key: string
  productId: string
  quantity: number
  unitCost: number
}

export function SupplierReturnDetailPage() {
  const { id } = useParams()
  const isNew = !id
  const navigate = useNavigate()
  const { setHeader } = useOutletContext<LayoutContext>()

  const [suppliers, setSuppliers] = useState<AdminSupplier[]>([])
  const [products, setProducts] = useState<AdminProduct[]>([])
  const [supplierId, setSupplierId] = useState('')
  const [reason, setReason] = useState('')
  const [lines, setLines] = useState<NewLine[]>([])
  const [status, setStatus] = useState<SupplierReturnStatus>('draft')
  const [returnNumber, setReturnNumber] = useState('')
  const [items, setItems] = useState<AdminSupplierReturnItem[]>([])
  const [loading, setLoading] = useState(!isNew)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setHeader({ crumb: 'المشتريات', title: isNew ? 'إنشاء مرتجع مورد' : `مرتجع ${returnNumber}` })
  }, [setHeader, isNew, returnNumber])

  useEffect(() => {
    api.listSuppliers({ activeOnly: true }).then(({ suppliers }) => setSuppliers(suppliers)).catch(() => {})
    api.listProducts().then(({ products }) => setProducts(products)).catch(() => {})
  }, [])

  useEffect(() => {
    if (!id) return
    api.getSupplierReturn(id)
      .then(({ supplierReturn, items }) => {
        setSupplierId(supplierReturn.supplierId)
        setReason(supplierReturn.reason)
        setStatus(supplierReturn.status)
        setReturnNumber(supplierReturn.returnNumber)
        setItems(items)
      })
      .catch(() => setError('تعذر تحميل المرتجع'))
      .finally(() => setLoading(false))
  }, [id])

  function addLine() {
    const firstAvailable = products.find(p => !lines.some(l => l.productId === p.id))
    if (!firstAvailable) return
    setLines(current => [...current, { key: crypto.randomUUID(), productId: firstAvailable.id, quantity: 1, unitCost: firstAvailable.cost }])
  }

  function updateLine(key: string, patch: Partial<NewLine>) {
    setLines(current => current.map(l => l.key === key ? { ...l, ...patch } : l))
  }

  function removeLine(key: string) {
    setLines(current => current.filter(l => l.key !== key))
  }

  async function create() {
    if (!supplierId) { setError('اختر مورد'); return }
    if (lines.length === 0) { setError('أضف صنف واحد على الأقل'); return }
    setError('')
    setSaving(true)
    try {
      const { supplierReturn } = await api.createSupplierReturn({
        supplierId, reason,
        items: lines.map(l => ({ productId: l.productId, quantity: l.quantity, unitCost: l.unitCost }))
      })
      navigate(`/purchasing/supplier-returns/${supplierReturn.id}`, { replace: true })
    } catch {
      setError('تعذر إنشاء المرتجع')
    } finally {
      setSaving(false)
    }
  }

  async function setReturnStatus(next: SupplierReturnStatus) {
    if (!id) return
    try {
      const { supplierReturn } = await api.setSupplierReturnStatus(id, next)
      setStatus(supplierReturn.status)
      setSuccess('تم تحديث الحالة')
    } catch (err) {
      window.alert(err instanceof ApiError ? 'تعذر تحديث الحالة' : 'حدث خطأ')
    }
  }

  if (loading) return null

  if (isNew) {
    return (
      <div className="admin-form-grid">
        <div className="admin-form-card">
          <div>
            <div className="admin-form-card-title">مرتجع مورد جديد</div>
            <div className="admin-form-card-sub">المخزون بينقص فقط بعد الموافقة على المرتجع</div>
          </div>
          <label>المورد
            <select value={supplierId} onChange={e => setSupplierId(e.target.value)}>
              <option value="">اختر مورد...</option>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label>سبب الإرجاع
            <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} />
          </label>
        </div>
        <div className="admin-form-card">
          <div>
            <div className="admin-form-card-title">الأصناف</div>
          </div>
          {lines.map(line => (
            <div key={line.key} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <select value={line.productId} onChange={e => updateLine(line.key, { productId: e.target.value })} style={{ flex: '1 1 200px' }}>
                {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <input type="number" min={1} value={line.quantity} onChange={e => updateLine(line.key, { quantity: Number(e.target.value) })} style={{ width: 80 }} />
              <input type="number" min={0} step="0.01" value={line.unitCost} onChange={e => updateLine(line.key, { unitCost: Number(e.target.value) })} style={{ width: 100 }} />
              <button type="button" className="admin-form-chip" onClick={() => removeLine(line.key)}>حذف</button>
            </div>
          ))}
          <button type="button" className="admin-form-chip" onClick={addLine}>+ إضافة صنف</button>

          {error && <div className="admin-form-error">{error}</div>}
          <button className="admin-form-save" disabled={saving} onClick={create}>إنشاء المرتجع</button>
        </div>
      </div>
    )
  }

  return (
    <div className="admin-form-grid">
      <div className="admin-form-card">
        <div>
          <div className="admin-form-card-title">بيانات المرتجع</div>
        </div>
        <div className="admin-form-help">الحالة الحالية: <strong>{STATUS_LABEL[status]}</strong></div>
        <div className="admin-form-help">السبب: {reason || '—'}</div>
        {status === 'draft' && <button className="admin-form-chip" onClick={() => setReturnStatus('approved')}>الموافقة على المرتجع (سينقص المخزون)</button>}
        {status === 'approved' && <button className="admin-form-chip" onClick={() => setReturnStatus('sent')}>تأكيد الإرسال للمورد</button>}
        {status === 'sent' && <button className="admin-form-chip" onClick={() => setReturnStatus('completed')}>تأكيد الاكتمال</button>}
        {(status === 'draft' || status === 'approved') && <button className="admin-form-chip" onClick={() => setReturnStatus('cancelled')}>إلغاء المرتجع</button>}
        {success && <div className="admin-form-success">{success}</div>}
      </div>
      <div className="admin-form-card">
        <div><div className="admin-form-card-title">الأصناف</div></div>
        {items.map(item => (
          <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>{item.productName} × {item.quantity}</span>
            <span style={{ fontWeight: 700 }}>{formatMoney(item.quantity * item.unitCost)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
