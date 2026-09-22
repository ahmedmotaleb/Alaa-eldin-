import { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { StatsGrid } from '../../components/StatsGrid'
import { api, ApiError, type AdminPriceSchedule, type AdminProduct, type AdminVariant } from '../../utils/api'
import { formatMoney } from '../../utils/money'
import type { LayoutContext } from '../../components/AdminLayout'

const STATUS_LABELS: Record<AdminPriceSchedule['status'], { label: string, bg: string, fg: string }> = {
  pending: { label: 'قيد الانتظار', bg: '#FFF3E3', fg: '#B8611A' },
  applied: { label: 'تم التنفيذ', bg: '#EAF8EF', fg: '#12813C' },
  cancelled: { label: 'ملغاة', bg: '#F1F4F2', fg: '#68746B' },
  conflict: { label: 'تعارض — السعر اتغيّر يدوياً', bg: '#FFF0EF', fg: '#B42318' }
}

function toLocalDateTimeInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function PricingSchedulesPage() {
  const { setHeader } = useOutletContext<LayoutContext>()
  const [schedules, setSchedules] = useState<AdminPriceSchedule[]>([])
  const [error, setError] = useState('')

  const [productSearch, setProductSearch] = useState('')
  const [productResults, setProductResults] = useState<AdminProduct[]>([])
  const [selectedProduct, setSelectedProduct] = useState<AdminProduct | null>(null)
  const [variants, setVariants] = useState<AdminVariant[]>([])
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null)
  const [newPrice, setNewPrice] = useState('')
  const [newOldPrice, setNewOldPrice] = useState('')
  const [startsAt, setStartsAt] = useState(toLocalDateTimeInputValue(new Date(Date.now() + 60 * 60 * 1000)))
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    setHeader({ crumb: 'المنتجات', title: 'جدولة الأسعار' })
  }, [setHeader])

  function refreshSchedules() {
    api.listPriceSchedules().then(({ schedules }) => setSchedules(schedules)).catch(() => setError('تعذر تحميل الجدولات'))
  }
  useEffect(refreshSchedules, [])

  useEffect(() => {
    if (!productSearch.trim()) { setProductResults([]); return }
    let cancelled = false
    const timeout = setTimeout(() => {
      api.listProducts({ search: productSearch.trim(), limit: 8 }).then(({ products }) => { if (!cancelled) setProductResults(products) }).catch(() => {})
    }, 250)
    return () => { cancelled = true; clearTimeout(timeout) }
  }, [productSearch])

  function pickProduct(product: AdminProduct) {
    setSelectedProduct(product)
    setSelectedVariantId(null)
    setProductSearch('')
    setProductResults([])
    api.listProductVariants(product.id).then(({ variants }) => setVariants(variants)).catch(() => setVariants([]))
  }

  const currentPrice = selectedVariantId ? variants.find(v => v.id === selectedVariantId)?.price : selectedProduct?.price

  async function submit() {
    setFormError('')
    setSuccess('')
    if (!selectedProduct || !newPrice || Number(newPrice) <= 0) {
      setFormError('اختر منتجاً وسعراً صحيحاً')
      return
    }
    setSaving(true)
    try {
      await api.createPriceSchedule({
        productId: selectedVariantId ? null : selectedProduct.id,
        variantId: selectedVariantId,
        newPrice: Number(newPrice),
        newOldPrice: newOldPrice ? Number(newOldPrice) : null,
        startsAt: new Date(startsAt).toISOString()
      })
      setSuccess('تم إنشاء الجدولة')
      setSelectedProduct(null)
      setSelectedVariantId(null)
      setVariants([])
      setNewPrice('')
      setNewOldPrice('')
      refreshSchedules()
    } catch (err) {
      if (err instanceof ApiError && err.code === 'target_not_found') setFormError('المنتج أو المتغيّر غير موجود')
      else if (err instanceof ApiError && err.code === 'starts_at_in_past') setFormError('لازم يكون موعد التنفيذ في المستقبل')
      else setFormError('تعذر إنشاء الجدولة، تحقق من البيانات')
    } finally {
      setSaving(false)
    }
  }

  async function cancel(id: string) {
    try {
      await api.cancelPriceSchedule(id)
      refreshSchedules()
    } catch {
      setError('تعذر إلغاء الجدولة')
    }
  }

  const pendingCount = schedules.filter(s => s.status === 'pending').length
  const conflictCount = schedules.filter(s => s.status === 'conflict').length

  return (
    <>
      <StatsGrid stats={[
        { label: 'جدولات قيد الانتظار', value: String(pendingCount), note: 'لسه معلقة', icon: '⏳', tint: '#FFF3E3' },
        { label: 'تعارضات', value: String(conflictCount), note: 'تحتاج مراجعة يدوية', icon: '⚠️', tint: '#FFF0EF', noteColor: '#B42318' }
      ]} />

      <div className="admin-form-grid">
        <div className="admin-form-card">
          <div>
            <div className="admin-form-card-title">جدولة سعر جديد</div>
            <div className="admin-form-card-sub">التنفيذ الفعلي يتم عبر معالج مجدول خارجياً (Cron) — راجع docs/SCHEDULED_PRICING_CRON.md</div>
          </div>
          <label>المنتج
            <input placeholder="دوّر على منتج بالاسم..." value={productSearch} onChange={e => setProductSearch(e.target.value)} />
            {selectedProduct && !productSearch && <span className="admin-form-help">المختار حالياً: {selectedProduct.name} (السعر الحالي: {formatMoney(selectedProduct.price)})</span>}
            {productResults.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
                {productResults.map(p => (
                  <button key={p.id} type="button" className="admin-form-chip" onClick={() => pickProduct(p)}>{p.name}</button>
                ))}
              </div>
            )}
          </label>
          {variants.length > 0 && (
            <label>المتغيّر (اختياري — اتركه لو الجدولة للمنتج الأساسي)
              <select value={selectedVariantId ?? ''} onChange={e => setSelectedVariantId(e.target.value || null)}>
                <option value="">المنتج الأساسي (بدون متغيّر)</option>
                {variants.map(v => <option key={v.id} value={v.id}>{v.name} — {formatMoney(v.price)}</option>)}
              </select>
            </label>
          )}
          {selectedProduct && (
            <span className="admin-form-help">السعر الحالي الفعلي: {formatMoney(currentPrice ?? 0)} — الجدولة هتترفض تلقائياً لو السعر ده اتغيّر يدوياً قبل موعد التنفيذ</span>
          )}
          <label>السعر الجديد (ج.م)
            <input type="number" min={0.01} step="0.01" value={newPrice} onChange={e => setNewPrice(e.target.value)} />
          </label>
          <label>السعر قبل الخصم الجديد (اختياري)
            <input type="number" min={0.01} step="0.01" value={newOldPrice} onChange={e => setNewOldPrice(e.target.value)} placeholder="اتركه فارغاً لعدم عرض خصم" />
          </label>
          <label>موعد التنفيذ
            <input type="datetime-local" value={startsAt} onChange={e => setStartsAt(e.target.value)} />
          </label>
          {formError && <div className="admin-form-error">{formError}</div>}
          {success && <div className="admin-form-success">{success}</div>}
          <button className="admin-form-save" disabled={saving} onClick={submit}>إنشاء الجدولة</button>
        </div>
      </div>

      <div className="admin-table-card">
        {error && <div className="admin-placeholder-note">{error}</div>}
        <div className="admin-table-scroll">
          <div style={{ minWidth: 780 }}>
            <div className="admin-table-head" style={{ gridTemplateColumns: '1fr .8fr .8fr .8fr 1fr .6fr' }}>
              <div>المنتج/المتغيّر</div><div>السعر الحالي وقت الجدولة</div><div>السعر الجديد</div><div>موعد التنفيذ</div><div>الحالة</div><div></div>
            </div>
            {schedules.map(s => {
              const status = STATUS_LABELS[s.status]
              return (
                <div key={s.id} className="admin-table-row" style={{ gridTemplateColumns: '1fr .8fr .8fr .8fr 1fr .6fr' }}>
                  <div className="admin-cell-plain">{s.variantId ? `متغيّر: ${s.variantId}` : `منتج: ${s.productId}`}</div>
                  <div className="admin-cell-plain">{formatMoney(s.expectedCurrentPrice)}</div>
                  <div className="admin-cell-plain" style={{ fontWeight: 800 }}>{formatMoney(s.newPrice)}</div>
                  <div className="admin-cell-plain" style={{ color: '#68746B' }}>{new Date(s.startsAt).toLocaleString('ar-EG')}</div>
                  <div><span className="admin-pill" style={{ background: status.bg, color: status.fg }}>{status.label}</span></div>
                  <div>
                    {s.status === 'pending' && <button className="admin-form-chip" onClick={() => cancel(s.id)}>إلغاء</button>}
                  </div>
                </div>
              )
            })}
            {schedules.length === 0 && <div className="admin-table-empty">مفيش جدولات بعد</div>}
          </div>
        </div>
      </div>
    </>
  )
}
