import { useEffect, useState } from 'react'
import { api, ApiError, type AdminVariant, type AdminVariantInput } from '../utils/api'

const emptyDraft: AdminVariantInput = {
  name: '', sku: null, barcode: '', price: 0, cost: 0, stock: 0, available: true, sortOrder: 0
}

function toDraft(variant: AdminVariant): AdminVariantInput {
  return {
    name: variant.name, sku: variant.sku, barcode: variant.barcode, price: variant.price,
    cost: variant.cost, stock: variant.stock, available: variant.available, sortOrder: variant.sortOrder
  }
}

export function ProductVariantsManager({ productId }: { productId: string }) {
  const [variants, setVariants] = useState<AdminVariant[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<AdminVariantInput>(emptyDraft)
  const [showNewForm, setShowNewForm] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api.listProductVariants(productId)
      .then(({ variants }) => setVariants(variants))
      .catch(() => setError('تعذر تحميل متغيرات المنتج'))
      .finally(() => setLoading(false))
  }, [productId])

  function set<K extends keyof AdminVariantInput>(key: K, value: AdminVariantInput[K]) {
    setDraft(current => ({ ...current, [key]: value }))
  }

  function startEdit(variant: AdminVariant) {
    setShowNewForm(false)
    setEditingId(variant.id)
    setDraft(toDraft(variant))
  }

  function startNew() {
    setEditingId(null)
    setDraft(emptyDraft)
    setShowNewForm(true)
  }

  function cancelForm() {
    setEditingId(null)
    setShowNewForm(false)
    setDraft(emptyDraft)
  }

  async function saveDraft() {
    if (!draft.name.trim() || draft.price <= 0) { setError('اسم المتغير وسعر أكبر من صفر مطلوبان'); return }
    setError('')
    setSaving(true)
    try {
      if (editingId) {
        const { variant } = await api.updateProductVariant(productId, editingId, draft)
        setVariants(current => current.map(v => v.id === variant.id ? variant : v))
      } else {
        const { variant } = await api.createProductVariant(productId, draft)
        setVariants(current => [...current, variant])
      }
      cancelForm()
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'sku_taken' ? 'هذا الـ SKU مستخدم بالفعل لمتغير آخر' : 'تعذر حفظ المتغير')
    } finally {
      setSaving(false)
    }
  }

  async function remove(variant: AdminVariant) {
    setError('')
    try {
      await api.deleteProductVariant(productId, variant.id)
      setVariants(current => current.filter(v => v.id !== variant.id))
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'variant_has_orders'
        ? 'لا يمكن حذف هذا المتغير — مرتبط بطلبات سابقة فعلية'
        : 'تعذر حذف المتغير')
    }
  }

  if (loading) return null

  const formOpen = showNewForm || editingId !== null

  return (
    <div className="admin-form-card">
      <div>
        <div className="admin-form-card-title">متغيرات المنتج</div>
        <div className="admin-form-card-sub">كل متغير له سعر ومخزون وباركود مستقل عن المنتج الأساسي — لا يستخدم دفعات صلاحية (FEFO) مثل المنتج الأساسي</div>
      </div>

      {error && <div className="admin-form-error">{error}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {variants.map(variant => (
          <div key={variant.id} style={{ display: 'flex', alignItems: 'center', gap: 10, border: '1px solid #dce4de', borderRadius: 11, padding: '9px 12px' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 13.5 }}>{variant.name} {!variant.available && <span style={{ color: '#B42318', fontWeight: 700, fontSize: 11.5 }}>(مخفي)</span>}</div>
              <div style={{ color: '#8A948C', fontSize: 12 }}>{variant.price} ج.م · مخزون {variant.stock}{variant.sku ? ` · SKU ${variant.sku}` : ''}</div>
            </div>
            <button type="button" className="admin-form-chip" onClick={() => startEdit(variant)}>تعديل</button>
            <button type="button" className="admin-form-chip" onClick={() => remove(variant)} style={{ color: '#B42318' }}>حذف</button>
          </div>
        ))}
        {variants.length === 0 && !formOpen && <span style={{ fontSize: 12.5, color: '#8A948C' }}>مفيش متغيرات مضافة لسه</span>}
      </div>

      {formOpen ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, border: '1px dashed #dce4de', borderRadius: 11, padding: 12 }}>
          <label>اسم المتغير
            <input value={draft.name} onChange={e => set('name', e.target.value)} placeholder="مثال: أحمر - كبير" />
          </label>
          <div className="admin-row-2">
            <label>السعر (ج.م)
              <input type="number" value={draft.price} onChange={e => set('price', Number(e.target.value))} />
            </label>
            <label>التكلفة (ج.م)
              <input type="number" value={draft.cost} onChange={e => set('cost', Number(e.target.value))} />
            </label>
          </div>
          <div className="admin-row-2">
            <label>الكمية المتاحة
              <input type="number" value={draft.stock} onChange={e => set('stock', Number(e.target.value))} />
            </label>
            <label>الباركود (اختياري)
              <input value={draft.barcode} onChange={e => set('barcode', e.target.value)} />
            </label>
          </div>
          <label>SKU (اختياري)
            <input value={draft.sku ?? ''} onChange={e => set('sku', e.target.value.trim() || null)} />
          </label>
          <label>الحالة
            <span className="admin-form-chips">
              <button type="button" className={`admin-form-chip ${draft.available ? 'active' : ''}`} onClick={() => set('available', true)}>معروض</button>
              <button type="button" className={`admin-form-chip ${!draft.available ? 'active' : ''}`} onClick={() => set('available', false)}>مخفي</button>
            </span>
          </label>
          <span className="admin-form-chips">
            <button type="button" className="admin-form-chip" disabled={saving} onClick={saveDraft}>{editingId ? 'حفظ التعديلات' : 'إضافة المتغير'}</button>
            <button type="button" className="admin-form-chip" onClick={cancelForm}>إلغاء</button>
          </span>
        </div>
      ) : (
        <button type="button" className="admin-form-chip" onClick={startNew}>+ إضافة متغير جديد</button>
      )}
    </div>
  )
}
