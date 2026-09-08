import { useEffect, useState } from 'react'
import { useNavigate, useOutletContext, useParams } from 'react-router-dom'
import { api, ApiError, type AdminCategory, type AdminProductInput } from '../../utils/api'
import { ProductImagesManager } from '../../components/ProductImagesManager'
import type { LayoutContext } from '../../components/AdminLayout'

const UNITS = ['قطعة', 'عبوة', 'كرتونة', 'كجم', 'جرام', 'لتر', 'مل', 'زجاجة']

const emptyForm: AdminProductInput = {
  id: '', slug: '', categoryId: '', name: '', description: '', price: 0, oldPrice: undefined,
  cost: 0, unit: 'عبوة', emoji: '📦', available: true, bestseller: false, offer: false,
  stock: 0, alertThreshold: 10, barcode: '', brand: ''
}

export function ProductFormPage() {
  const { id } = useParams()
  const isEdit = Boolean(id)
  const navigate = useNavigate()
  const { setHeader } = useOutletContext<LayoutContext>()
  const [categories, setCategories] = useState<AdminCategory[]>([])
  const [form, setForm] = useState<AdminProductInput>(emptyForm)
  const [loading, setLoading] = useState(isEdit)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setHeader({ crumb: 'المنتجات', title: isEdit ? 'تعديل منتج' : 'إضافة منتج' })
  }, [setHeader, isEdit])

  useEffect(() => {
    api.listCategories().then(({ categories }) => {
      setCategories(categories)
      setForm(current => current.categoryId ? current : { ...current, categoryId: categories[0]?.id ?? '' })
    })
  }, [])

  useEffect(() => {
    if (!id) return
    api.getProduct(id)
      .then(({ product }) => setForm(product))
      .catch(() => setError('تعذر تحميل بيانات المنتج'))
      .finally(() => setLoading(false))
  }, [id])

  function set<K extends keyof AdminProductInput>(key: K, value: AdminProductInput[K]) {
    setForm(current => ({ ...current, [key]: value }))
  }

  async function save() {
    setError('')
    setSuccess('')
    setSaving(true)
    try {
      const payload: AdminProductInput = { ...form, offer: !!form.oldPrice && form.oldPrice > form.price }
      if (isEdit && id) {
        const { product } = await api.updateProduct(id, payload)
        setForm(product)
        setSuccess('تم حفظ التعديلات')
      } else {
        const { product } = await api.createProduct(payload)
        setSuccess('تم حفظ المنتج')
        navigate(`/products/edit/${product.id}`, { replace: true })
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === 'slug_taken') setError('هذا الرابط (slug) مستخدم بالفعل لمنتج آخر')
      else setError('تعذر حفظ المنتج، تحقق من البيانات وحاول مرة أخرى')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return null

  return (
    <div className="admin-form-grid">
      {isEdit && id && <ProductImagesManager productId={id} />}

      <div className="admin-form-card">
        <div>
          <div className="admin-form-card-title">البيانات الأساسية</div>
          <div className="admin-form-card-sub">الاسم والوصف والتصنيف</div>
        </div>
        <label>اسم المنتج
          <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="مثال: زيت عباد الشمس 1 لتر" />
        </label>
        <label>الوصف
          <textarea rows={3} value={form.description} onChange={e => set('description', e.target.value)} placeholder="وصف مختصر يظهر في صفحة المنتج" />
        </label>
        <label>القسم
          <span className="admin-form-chips">
            {categories.map(c => (
              <button key={c.id} type="button" className={`admin-form-chip ${form.categoryId === c.id ? 'active' : ''}`} onClick={() => set('categoryId', c.id)}>
                {c.emoji} {c.name}
              </button>
            ))}
          </span>
        </label>
        <label>العلامة التجارية
          <input value={form.brand} onChange={e => set('brand', e.target.value)} placeholder="مثال: كريستال" />
        </label>
        <label>الإيموجي المعروض للمنتج
          <input value={form.emoji} onChange={e => set('emoji', e.target.value)} placeholder="🫒" />
        </label>
      </div>

      <div className="admin-form-card">
        <div>
          <div className="admin-form-card-title">السعر والتكلفة</div>
          <div className="admin-form-card-sub">الهامش يُحسب تلقائياً</div>
        </div>
        <div className="admin-row-2">
          <label>سعر البيع (ج.م)
            <input type="number" value={form.price} onChange={e => set('price', Number(e.target.value))} />
          </label>
          <label>السعر قبل الخصم (ج.م)
            <input type="number" value={form.oldPrice ?? ''} onChange={e => set('oldPrice', e.target.value ? Number(e.target.value) : undefined)} placeholder="اختياري" />
          </label>
        </div>
        <label>تكلفة المنتج (ج.م)
          <input type="number" value={form.cost} onChange={e => set('cost', Number(e.target.value))} />
          <span className="admin-form-help">الهامش الحالي: {form.price ? Math.round(((form.price - form.cost) / form.price) * 100) : 0}%</span>
        </label>
        <label>الوحدة
          <span className="admin-form-chips">
            {UNITS.map(u => (
              <button key={u} type="button" className={`admin-form-chip ${form.unit === u ? 'active' : ''}`} onClick={() => set('unit', u)}>{u}</button>
            ))}
          </span>
        </label>
        <label>حالة المنتج
          <span className="admin-form-chips">
            <button type="button" className={`admin-form-chip ${form.available ? 'active' : ''}`} onClick={() => set('available', true)}>معروض</button>
            <button type="button" className={`admin-form-chip ${!form.available ? 'active' : ''}`} onClick={() => set('available', false)}>مخفي</button>
          </span>
        </label>
        <label>الأكثر مبيعاً
          <span className="admin-form-chips">
            <button type="button" className={`admin-form-chip ${form.bestseller ? 'active' : ''}`} onClick={() => set('bestseller', true)}>نعم</button>
            <button type="button" className={`admin-form-chip ${!form.bestseller ? 'active' : ''}`} onClick={() => set('bestseller', false)}>لا</button>
          </span>
        </label>
      </div>

      <div className="admin-form-card">
        <div>
          <div className="admin-form-card-title">المخزون والتعريف</div>
          <div className="admin-form-card-sub">التتبع والتنبيهات</div>
        </div>
        <label>الرابط (slug)
          <input value={form.slug} onChange={e => set('slug', e.target.value)} placeholder="oil" />
        </label>
        <label>الباركود
          <input value={form.barcode} onChange={e => set('barcode', e.target.value)} />
        </label>
        <div className="admin-row-2">
          <label>الكمية المتاحة
            <input type="number" value={form.stock} onChange={e => set('stock', Number(e.target.value))} />
          </label>
          <label>حد تنبيه المخزون
            <input type="number" value={form.alertThreshold} onChange={e => set('alertThreshold', Number(e.target.value))} />
            <span className="admin-form-help">يظهر تنبيه لما يقل المخزون عن هذا الرقم</span>
          </label>
        </div>

        {error && <div className="admin-form-error">{error}</div>}
        {success && <div className="admin-form-success">{success}</div>}
        <button className="admin-form-save" disabled={saving} onClick={save}>{isEdit ? 'حفظ التعديلات' : 'حفظ ونشر المنتج'}</button>
      </div>
    </div>
  )
}
