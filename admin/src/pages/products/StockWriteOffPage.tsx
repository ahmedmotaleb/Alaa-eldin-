import { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { api, ApiError, type AdminProduct, type WriteOffReason } from '../../utils/api'
import type { LayoutContext } from '../../components/AdminLayout'

const REASON_LABEL: Record<WriteOffReason, string> = {
  expired: 'منتهي الصلاحية',
  damaged: 'تالف',
  lost: 'فقد',
  inventory_adjustment: 'تسوية مخزون',
  supplier_return: 'مرتجع لمورد'
}

export function StockWriteOffPage() {
  const { setHeader } = useOutletContext<LayoutContext>()
  const [products, setProducts] = useState<AdminProduct[]>([])
  const [productId, setProductId] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [reason, setReason] = useState<WriteOffReason>('damaged')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setHeader({ crumb: 'المخزون', title: 'شطب المخزون' })
  }, [setHeader])

  useEffect(() => {
    api.listProducts().then(({ products }) => {
      setProducts(products)
      setProductId(current => current || products[0]?.id || '')
    }).catch(() => {})
  }, [])

  async function submit() {
    if (!productId || quantity <= 0) { setError('اختر منتج وكمية صحيحة'); return }
    setError('')
    setSuccess('')
    setSaving(true)
    try {
      await api.writeOffStock({ productId, quantity, reason, note })
      setSuccess('تم تسجيل الشطب بنجاح')
      setQuantity(1)
      setNote('')
    } catch (err) {
      if (err instanceof ApiError && err.code === 'insufficient_stock') setError('الكمية المطلوبة أكبر من المخزون المتاح')
      else setError('تعذر تسجيل الشطب، حاول مرة أخرى')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="admin-form-grid">
      <div className="admin-form-card">
        <div>
          <div className="admin-form-card-title">شطب مخزون</div>
          <div className="admin-form-card-sub">يقلل المخزون فعلياً ويُسجَّل كحركة مخزون مدقّقة</div>
        </div>
        <label>المنتج
          <select value={productId} onChange={e => setProductId(e.target.value)}>
            {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label>الكمية
          <input type="number" min={1} value={quantity} onChange={e => setQuantity(Number(e.target.value))} />
        </label>
        <label>السبب
          <span className="admin-form-chips">
            {(Object.keys(REASON_LABEL) as WriteOffReason[]).map(r => (
              <button key={r} type="button" className={`admin-form-chip ${reason === r ? 'active' : ''}`} onClick={() => setReason(r)}>{REASON_LABEL[r]}</button>
            ))}
          </span>
        </label>
        <label>ملاحظات
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} />
        </label>

        {error && <div className="admin-form-error">{error}</div>}
        {success && <div className="admin-form-success">{success}</div>}
        <button className="admin-form-save" disabled={saving} onClick={submit}>تسجيل الشطب</button>
      </div>
    </div>
  )
}
