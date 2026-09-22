import { useEffect, useState } from 'react'
import { useNavigate, useOutletContext, useParams } from 'react-router-dom'
import { api, ApiError, type AdminCategory, type AdminPromotion, type AdminPromotionBundleItem, type AdminProduct } from '../../utils/api'
import type { LayoutContext } from '../../components/AdminLayout'

type FormState = Partial<AdminPromotion> & { type: AdminPromotion['type'] }

const emptyForm: FormState = {
  name: '', type: 'buy_x_get_y', active: true, startsAt: null, expiresAt: null, priority: 0,
  maxApplicationsPerOrder: null,
  triggerProductId: null, triggerCategoryId: null, buyQuantity: 2, getQuantity: 1, getDiscountPercent: 100,
  rewardProductId: null, rewardCategoryId: null,
  bundlePrice: null, bundleItems: []
}

// اختيار منتج أو فئة واحد بس (مش الاتنين) — مستخدم في أكتر من مكان في النموذج ده (المُحفِّز،
// الهدية، وكل مجموعة من مجموعات الباقة).
function ProductOrCategoryPicker({
  label, productId, categoryId, categories, onChangeProduct, onChangeCategory, allowNeither
}: {
  label: string
  productId: string | null
  categoryId: string | null
  categories: AdminCategory[]
  onChangeProduct: (id: string | null, name: string) => void
  onChangeCategory: (id: string | null) => void
  allowNeither?: boolean
}) {
  const [mode, setMode] = useState<'product' | 'category'>(categoryId ? 'category' : 'product')
  const [search, setSearch] = useState('')
  const [results, setResults] = useState<AdminProduct[]>([])
  const [selectedName, setSelectedName] = useState('')

  useEffect(() => {
    if (productId && !selectedName) {
      api.getProduct(productId).then(({ product }) => setSelectedName(product.name)).catch(() => {})
    }
  }, [productId, selectedName])

  useEffect(() => {
    if (!search.trim()) { setResults([]); return }
    let cancelled = false
    const timeout = setTimeout(() => {
      api.listProducts({ search: search.trim(), limit: 8 }).then(({ products }) => { if (!cancelled) setResults(products) }).catch(() => {})
    }, 250)
    return () => { cancelled = true; clearTimeout(timeout) }
  }, [search])

  return (
    <label>{label}
      <span className="admin-form-chips">
        {allowNeither && (
          <button type="button" className={`admin-form-chip ${!productId && !categoryId ? 'active' : ''}`}
            onClick={() => { onChangeProduct(null, ''); onChangeCategory(null) }}>نفس مجموعة المُحفِّز</button>
        )}
        <button type="button" className={`admin-form-chip ${mode === 'product' ? 'active' : ''}`} onClick={() => { setMode('product'); onChangeCategory(null) }}>منتج معيّن</button>
        <button type="button" className={`admin-form-chip ${mode === 'category' ? 'active' : ''}`} onClick={() => { setMode('category'); onChangeProduct(null, '') }}>فئة كاملة</button>
      </span>
      {mode === 'category' && (
        <select value={categoryId ?? ''} onChange={e => onChangeCategory(e.target.value || null)}>
          <option value="" disabled>اختر فئة</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      )}
      {mode === 'product' && (
        <>
          <input placeholder="دوّر على منتج بالاسم..." value={search} onChange={e => setSearch(e.target.value)} />
          {selectedName && !search && <span className="admin-form-help">المختار حالياً: {selectedName}</span>}
          {results.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
              {results.map(p => (
                <button key={p.id} type="button" className="admin-form-chip"
                  onClick={() => { onChangeProduct(p.id, p.name); setSelectedName(p.name); setSearch('') }}>
                  {p.name}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </label>
  )
}

export function PromotionFormPage() {
  const { id } = useParams()
  const isEdit = Boolean(id)
  const navigate = useNavigate()
  const { setHeader } = useOutletContext<LayoutContext>()
  const [form, setForm] = useState<FormState>(emptyForm)
  const [loading, setLoading] = useState(isEdit)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [saving, setSaving] = useState(false)
  const [categories, setCategories] = useState<AdminCategory[]>([])

  useEffect(() => {
    setHeader({ crumb: 'العروض', title: isEdit ? 'تعديل عرض' : 'إنشاء عرض' })
  }, [setHeader, isEdit])

  useEffect(() => {
    api.listCategories().then(({ categories }) => setCategories(categories)).catch(() => {})
  }, [])

  useEffect(() => {
    if (!id) return
    api.getPromotion(id)
      .then(({ promotion }) => setForm(promotion))
      .catch(() => setError('العرض غير موجود'))
      .finally(() => setLoading(false))
  }, [id])

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm(current => ({ ...current, [key]: value }))
  }

  function addBundleItem() {
    set('bundleItems', [...(form.bundleItems ?? []), { productId: null, categoryId: null, requiredQuantity: 1 }])
  }

  function updateBundleItem(index: number, patch: Partial<AdminPromotionBundleItem>) {
    const items = [...(form.bundleItems ?? [])]
    items[index] = { ...items[index], ...patch }
    set('bundleItems', items)
  }

  function removeBundleItem(index: number) {
    set('bundleItems', (form.bundleItems ?? []).filter((_, i) => i !== index))
  }

  async function save() {
    setError('')
    setSuccess('')
    setSaving(true)
    try {
      if (isEdit && id) {
        const { promotion } = await api.updatePromotion(id, form)
        setForm(promotion)
        setSuccess('تم حفظ التعديلات')
      } else {
        const { promotion } = await api.createPromotion(form)
        setSuccess('تم إنشاء العرض')
        navigate(`/promotions/edit/${promotion.id}`, { replace: true })
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === 'target_not_found') setError('المنتج أو الفئة المحددة في العرض غير موجودة')
      else setError('تعذر حفظ العرض، تحقق من البيانات وحاول مرة أخرى')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return null

  return (
    <div className="admin-form-grid">
      <div className="admin-form-card">
        <div>
          <div className="admin-form-card-title">بيانات العرض</div>
          <div className="admin-form-card-sub">اسم العرض ونوعه — بيتطبق تلقائياً من محتوى السلة، من غير كود</div>
        </div>
        <label>اسم العرض (يظهر للعميل في ملخص الطلب)
          <input value={form.name ?? ''} onChange={e => set('name', e.target.value)} placeholder="مثال: اشترِ 2 واحصل على 1 مجاناً" />
        </label>
        <label>نوع العرض
          <span className="admin-form-chips">
            <button type="button" disabled={isEdit} className={`admin-form-chip ${form.type === 'buy_x_get_y' ? 'active' : ''}`} onClick={() => set('type', 'buy_x_get_y')}>اشترِ X واحصل على Y</button>
            <button type="button" disabled={isEdit} className={`admin-form-chip ${form.type === 'bundle_fixed_price' ? 'active' : ''}`} onClick={() => set('type', 'bundle_fixed_price')}>باقة بسعر ثابت</button>
          </span>
          {isEdit && <span className="admin-form-help">نوع العرض ثابت بعد الإنشاء — أنشئ عرضاً جديداً لو محتاج نوع مختلف</span>}
        </label>
        <label>الحالة
          <span className="admin-form-chips">
            <button type="button" className={`admin-form-chip ${form.active ? 'active' : ''}`} onClick={() => set('active', true)}>مفعّل</button>
            <button type="button" className={`admin-form-chip ${!form.active ? 'active' : ''}`} onClick={() => set('active', false)}>معطّل</button>
          </span>
        </label>
      </div>

      {form.type === 'buy_x_get_y' ? (
        <div className="admin-form-card">
          <div>
            <div className="admin-form-card-title">شروط العرض</div>
            <div className="admin-form-card-sub">المُحفِّز (المنتج/الفئة اللي العميل بيشتريها) وكمية الهدية</div>
          </div>
          <ProductOrCategoryPicker
            label="المُحفِّز (اشترِ من)"
            productId={form.triggerProductId ?? null}
            categoryId={form.triggerCategoryId ?? null}
            categories={categories}
            onChangeProduct={id => set('triggerProductId', id)}
            onChangeCategory={id => set('triggerCategoryId', id)}
          />
          <label>كمية الشراء (X)
            <input type="number" min={1} value={form.buyQuantity ?? 1} onChange={e => set('buyQuantity', Number(e.target.value))} />
          </label>
          <label>كمية الهدية (Y)
            <input type="number" min={1} value={form.getQuantity ?? 1} onChange={e => set('getQuantity', Number(e.target.value))} />
          </label>
          <label>نسبة خصم الهدية (%)
            <input type="number" min={1} max={100} value={form.getDiscountPercent ?? 100} onChange={e => set('getDiscountPercent', Number(e.target.value))} />
            <span className="admin-form-help">100% يعني الهدية مجاناً بالكامل</span>
          </label>
          <ProductOrCategoryPicker
            label="الهدية (احصل على) — اتركها فارغة لنفس مجموعة المُحفِّز"
            productId={form.rewardProductId ?? null}
            categoryId={form.rewardCategoryId ?? null}
            categories={categories}
            onChangeProduct={id => set('rewardProductId', id)}
            onChangeCategory={id => set('rewardCategoryId', id)}
            allowNeither
          />
        </div>
      ) : (
        <div className="admin-form-card">
          <div>
            <div className="admin-form-card-title">مجموعات الباقة</div>
            <div className="admin-form-card-sub">لازم توجد كل المجموعات معاً في السلة عشان الباقة تتفعّل</div>
          </div>
          <label>السعر الإجمالي الثابت للباقة (ج.م)
            <input type="number" min={0.01} step="0.01" value={form.bundlePrice ?? ''} onChange={e => set('bundlePrice', e.target.value ? Number(e.target.value) : null)} />
          </label>
          {(form.bundleItems ?? []).map((item, index) => (
            <div key={index} style={{ border: '1px solid #E4E9E5', borderRadius: 12, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong>مجموعة {index + 1}</strong>
                <button type="button" className="admin-form-chip" onClick={() => removeBundleItem(index)}>حذف</button>
              </div>
              <ProductOrCategoryPicker
                label="المنتج أو الفئة"
                productId={item.productId}
                categoryId={item.categoryId}
                categories={categories}
                onChangeProduct={pid => updateBundleItem(index, { productId: pid, categoryId: null })}
                onChangeCategory={cid => updateBundleItem(index, { categoryId: cid, productId: null })}
              />
              <label>الكمية المطلوبة من هذه المجموعة
                <input type="number" min={1} value={item.requiredQuantity} onChange={e => updateBundleItem(index, { requiredQuantity: Number(e.target.value) })} />
              </label>
            </div>
          ))}
          <button type="button" className="admin-form-chip" onClick={addBundleItem}>+ إضافة مجموعة</button>
        </div>
      )}

      <div className="admin-form-card">
        <div>
          <div className="admin-form-card-title">الحدود والجدولة</div>
          <div className="admin-form-card-sub">أولوية التطبيق عند تعدد العروض، وحدود التكرار والتاريخ</div>
        </div>
        <label>الأولوية (الأعلى يُطبَّق أولاً عند تعدد العروض المؤهّلة في نفس السلة)
          <input type="number" value={form.priority ?? 0} onChange={e => set('priority', Number(e.target.value))} />
        </label>
        <label>الحد الأقصى لعدد مرات التطبيق في الطلب الواحد (اختياري)
          <input type="number" min={1} value={form.maxApplicationsPerOrder ?? ''} onChange={e => set('maxApplicationsPerOrder', e.target.value ? Number(e.target.value) : null)} placeholder="بلا حدود" />
        </label>
        <label>تاريخ بداية السريان
          <input type="date" value={form.startsAt ? form.startsAt.slice(0, 10) : ''} onChange={e => set('startsAt', e.target.value || null)} />
          <span className="admin-form-help">اتركه فارغاً ليبدأ العمل فوراً</span>
        </label>
        <label>تاريخ انتهاء الصلاحية
          <input type="date" value={form.expiresAt ? form.expiresAt.slice(0, 10) : ''} onChange={e => set('expiresAt', e.target.value || null)} />
          <span className="admin-form-help">اتركه فارغاً لعرض بلا تاريخ انتهاء</span>
        </label>

        {error && <div className="admin-form-error">{error}</div>}
        {success && <div className="admin-form-success">{success}</div>}
        <button className="admin-form-save" disabled={saving} onClick={save}>{isEdit ? 'حفظ التعديلات' : 'إنشاء العرض'}</button>
      </div>
    </div>
  )
}
