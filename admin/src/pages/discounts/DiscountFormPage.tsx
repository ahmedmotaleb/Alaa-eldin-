import { useEffect, useState } from 'react'
import { useNavigate, useOutletContext, useParams } from 'react-router-dom'
import { api, ApiError, type AdminCategory, type AdminDiscountInput, type AdminProduct } from '../../utils/api'
import type { LayoutContext } from '../../components/AdminLayout'

const emptyForm: AdminDiscountInput = {
  code: '', type: 'percentage', value: 10, minOrder: 0, maxUses: null, active: true, expiresAt: null,
  startsAt: null, scope: 'order', scopeId: null, minQuantity: null, firstOrderOnly: false,
  freeDelivery: false, maxUsesPerCustomer: null
}

export function DiscountFormPage() {
  const { code } = useParams()
  const isEdit = Boolean(code)
  const navigate = useNavigate()
  const { setHeader } = useOutletContext<LayoutContext>()
  const [form, setForm] = useState<AdminDiscountInput>(emptyForm)
  const [usedCount, setUsedCount] = useState(0)
  const [loading, setLoading] = useState(isEdit)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [saving, setSaving] = useState(false)
  const [categories, setCategories] = useState<AdminCategory[]>([])
  const [productSearch, setProductSearch] = useState('')
  const [productResults, setProductResults] = useState<AdminProduct[]>([])
  const [scopedProductName, setScopedProductName] = useState('')

  useEffect(() => {
    setHeader({ crumb: 'الخصومات', title: isEdit ? 'تعديل خصم' : 'إنشاء خصم' })
  }, [setHeader, isEdit])

  useEffect(() => {
    api.listCategories().then(({ categories }) => setCategories(categories)).catch(() => {})
  }, [])

  useEffect(() => {
    if (!code) return
    api.listDiscounts()
      .then(({ discounts }) => {
        const found = discounts.find(d => d.code === code)
        if (found) { setForm(found); setUsedCount(found.usedCount) }
        else setError('كود الخصم غير موجود')
      })
      .catch(() => setError('تعذر تحميل بيانات الخصم'))
      .finally(() => setLoading(false))
  }, [code])

  // لو نطاق الخصم "منتج معيّن" واسم المنتج المختار لسه مش معروض (وقت التحميل الأول لتعديل
  // خصم موجود)، بنجيب اسمه مرة واحدة بس عشان يبان بدل الـ id الخام.
  useEffect(() => {
    if (form.scope === 'product' && form.scopeId && !scopedProductName) {
      api.getProduct(form.scopeId).then(({ product }) => setScopedProductName(product.name)).catch(() => {})
    }
  }, [form.scope, form.scopeId, scopedProductName])

  useEffect(() => {
    if (!productSearch.trim()) { setProductResults([]); return }
    let cancelled = false
    const timeout = setTimeout(() => {
      api.listProducts({ search: productSearch.trim(), limit: 8 })
        .then(({ products }) => { if (!cancelled) setProductResults(products) })
        .catch(() => {})
    }, 250)
    return () => { cancelled = true; clearTimeout(timeout) }
  }, [productSearch])

  function set<K extends keyof AdminDiscountInput>(key: K, value: AdminDiscountInput[K]) {
    setForm(current => ({ ...current, [key]: value }))
  }

  async function save() {
    setError('')
    setSuccess('')
    setSaving(true)
    try {
      if (isEdit && code) {
        const { discount } = await api.updateDiscount(code, form)
        setForm(discount)
        setUsedCount(discount.usedCount)
        setSuccess('تم حفظ التعديلات')
      } else {
        const { discount } = await api.createDiscount({ ...form, code: form.code.trim().toUpperCase() })
        setSuccess('تم إنشاء كود الخصم')
        navigate(`/discounts/edit/${discount.code}`, { replace: true })
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === 'code_taken') setError('هذا الكود مستخدم بالفعل')
      else if (err instanceof ApiError && err.code === 'scope_target_not_found') setError('الفئة أو المنتج المحدد لنطاق الخصم غير موجود')
      else setError('تعذر حفظ الخصم، تحقق من البيانات وحاول مرة أخرى')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return null

  return (
    <div className="admin-form-grid">
      <div className="admin-form-card">
        <div>
          <div className="admin-form-card-title">بيانات الكود</div>
          <div className="admin-form-card-sub">الكود ونوع الخصم</div>
        </div>
        <label>كود الخصم
          <input
            value={form.code}
            disabled={isEdit}
            onChange={e => set('code', e.target.value.toUpperCase())}
            placeholder="مثال: SAVE10"
          />
        </label>
        <label>نوع الخصم
          <span className="admin-form-chips">
            <button type="button" className={`admin-form-chip ${form.type === 'percentage' ? 'active' : ''}`} onClick={() => set('type', 'percentage')}>نسبة مئوية</button>
            <button type="button" className={`admin-form-chip ${form.type === 'fixed' ? 'active' : ''}`} onClick={() => set('type', 'fixed')}>قيمة ثابتة</button>
          </span>
        </label>
        <label>{form.type === 'percentage' ? 'النسبة (%)' : 'القيمة (ج.م)'}
          <input type="number" value={form.value} onChange={e => set('value', Number(e.target.value))} />
        </label>
        <label>الحالة
          <span className="admin-form-chips">
            <button type="button" className={`admin-form-chip ${form.active ? 'active' : ''}`} onClick={() => set('active', true)}>مفعّل</button>
            <button type="button" className={`admin-form-chip ${!form.active ? 'active' : ''}`} onClick={() => set('active', false)}>معطّل</button>
          </span>
        </label>
      </div>

      <div className="admin-form-card">
        <div>
          <div className="admin-form-card-title">نطاق الخصم</div>
          <div className="admin-form-card-sub">الطلب كله، أو فئة/منتج معيّن بس</div>
        </div>
        <label>النطاق
          <span className="admin-form-chips">
            <button type="button" className={`admin-form-chip ${form.scope === 'order' ? 'active' : ''}`} onClick={() => { set('scope', 'order'); set('scopeId', null) }}>الطلب كله</button>
            <button type="button" className={`admin-form-chip ${form.scope === 'category' ? 'active' : ''}`} onClick={() => set('scope', 'category')}>فئة معيّنة</button>
            <button type="button" className={`admin-form-chip ${form.scope === 'product' ? 'active' : ''}`} onClick={() => set('scope', 'product')}>منتج معيّن</button>
          </span>
        </label>
        {form.scope === 'category' && (
          <label>الفئة
            <select value={form.scopeId ?? ''} onChange={e => set('scopeId', e.target.value || null)}>
              <option value="" disabled>اختر فئة</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        )}
        {form.scope === 'product' && (
          <label>المنتج
            <input
              placeholder="دوّر على منتج بالاسم..."
              value={productSearch}
              onChange={e => setProductSearch(e.target.value)}
            />
            {scopedProductName && !productSearch && <span className="admin-form-help">المنتج المختار حالياً: {scopedProductName}</span>}
            {productResults.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
                {productResults.map(p => (
                  <button
                    key={p.id}
                    type="button"
                    className="admin-form-chip"
                    onClick={() => { set('scopeId', p.id); setScopedProductName(p.name); setProductSearch('') }}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            )}
          </label>
        )}
      </div>

      <div className="admin-form-card">
        <div>
          <div className="admin-form-card-title">الشروط والحدود</div>
          <div className="admin-form-card-sub">الحد الأدنى وعدد مرات الاستخدام والجدولة</div>
        </div>
        <label>الحد الأدنى للطلب (ج.م)
          <input type="number" value={form.minOrder} onChange={e => set('minOrder', Number(e.target.value))} />
        </label>
        <label>الحد الأدنى للكمية (اختياري)
          <input
            type="number"
            value={form.minQuantity ?? ''}
            onChange={e => set('minQuantity', e.target.value ? Number(e.target.value) : null)}
            placeholder="بلا حد أدنى"
          />
          <span className="admin-form-help">من الأصناف الداخلة في نطاق الخصم بس (فوق)</span>
        </label>
        <label>الحد الأقصى لعدد مرات الاستخدام (إجمالي)
          <input
            type="number"
            value={form.maxUses ?? ''}
            onChange={e => set('maxUses', e.target.value ? Number(e.target.value) : null)}
            placeholder="بلا حدود"
          />
        </label>
        <label>الحد الأقصى لكل عميل
          <input
            type="number"
            value={form.maxUsesPerCustomer ?? ''}
            onChange={e => set('maxUsesPerCustomer', e.target.value ? Number(e.target.value) : null)}
            placeholder="بلا حدود لكل عميل"
          />
        </label>
        <label>تاريخ بداية السريان
          <input
            type="date"
            value={form.startsAt ? form.startsAt.slice(0, 10) : ''}
            onChange={e => set('startsAt', e.target.value || null)}
          />
          <span className="admin-form-help">اتركه فارغاً ليبدأ العمل فوراً</span>
        </label>
        <label>تاريخ انتهاء الصلاحية
          <input
            type="date"
            value={form.expiresAt ? form.expiresAt.slice(0, 10) : ''}
            onChange={e => set('expiresAt', e.target.value || null)}
          />
          <span className="admin-form-help">اتركه فارغاً لخصم بلا تاريخ انتهاء</span>
        </label>
        <label>عروض إضافية
          <span className="admin-form-chips">
            <button type="button" className={`admin-form-chip ${form.firstOrderOnly ? 'active' : ''}`} onClick={() => set('firstOrderOnly', !form.firstOrderOnly)}>أول طلب فقط</button>
            <button type="button" className={`admin-form-chip ${form.freeDelivery ? 'active' : ''}`} onClick={() => set('freeDelivery', !form.freeDelivery)}>توصيل مجاني</button>
          </span>
        </label>
        {isEdit && (
          <span className="admin-form-help">عدد مرات الاستخدام حتى الآن: {usedCount}</span>
        )}

        {error && <div className="admin-form-error">{error}</div>}
        {success && <div className="admin-form-success">{success}</div>}
        <button className="admin-form-save" disabled={saving} onClick={save}>{isEdit ? 'حفظ التعديلات' : 'إنشاء الكود'}</button>
      </div>
    </div>
  )
}
