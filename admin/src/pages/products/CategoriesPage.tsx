import { useEffect, useRef, useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { api, ApiError, type AdminCategory } from '../../utils/api'
import type { LayoutContext } from '../../components/AdminLayout'

const TINTS = ['#E8F7EC', '#EAF2FF', '#FFF3E3', '#FBF0DC', '#FFECEC', '#EAF6FA', '#E8F4FA', '#F3EEFB', '#FCEDED']

export function CategoriesPage() {
  const navigate = useNavigate()
  const { setHeader } = useOutletContext<LayoutContext>()
  const [categories, setCategories] = useState<AdminCategory[] | null>(null)
  const [error, setError] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ id: '', name: '', emoji: '', tint: TINTS[0] })
  const [createError, setCreateError] = useState('')
  const [saving, setSaving] = useState(false)
  const [uploadingId, setUploadingId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [pendingUploadId, setPendingUploadId] = useState<string | null>(null)

  function load() {
    api.listCategories()
      .then(({ categories }) => setCategories(categories))
      .catch(err => setError(err instanceof ApiError ? 'تعذر تحميل الأقسام' : 'حدث خطأ، حاول مرة أخرى'))
  }

  useEffect(() => { load() }, [])

  useEffect(() => {
    setHeader({ crumb: 'المنتجات', title: 'الأقسام', action: { label: 'إضافة قسم', onClick: () => setShowCreate(v => !v) } })
  }, [setHeader])

  async function createCategory() {
    setCreateError('')
    if (!form.id.trim() || !form.name.trim() || !form.emoji.trim()) {
      setCreateError('يرجى إدخال جميع البيانات المطلوبة')
      return
    }
    setSaving(true)
    try {
      await api.createCategory({ id: form.id.trim(), name: form.name.trim(), emoji: form.emoji.trim(), tint: form.tint })
      setForm({ id: '', name: '', emoji: '', tint: TINTS[0] })
      setShowCreate(false)
      load()
    } catch (err) {
      setCreateError(err instanceof ApiError && err.code === 'category_id_taken' ? 'هذا المعرّف مستخدم بالفعل' : 'تعذر إضافة القسم')
    } finally {
      setSaving(false)
    }
  }

  function triggerUpload(categoryId: string) {
    setPendingUploadId(categoryId)
    fileInputRef.current?.click()
  }

  async function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    const categoryId = pendingUploadId
    e.target.value = ''
    if (!file || !categoryId) return
    setUploadingId(categoryId)
    try {
      await api.uploadCategoryImage(categoryId, file)
      load()
    } catch {
      setError('تعذر رفع صورة القسم')
    } finally {
      setUploadingId(null)
      setPendingUploadId(null)
    }
  }

  async function removeImage(categoryId: string) {
    setUploadingId(categoryId)
    try {
      await api.deleteCategoryImage(categoryId)
      load()
    } catch {
      setError('تعذر حذف صورة القسم')
    } finally {
      setUploadingId(null)
    }
  }

  if (error) return <div className="admin-placeholder-card"><div className="admin-placeholder-note">{error}</div></div>
  if (!categories) return null

  return (
    <>
      <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }} onChange={onFilePicked} />
      {showCreate && (
        <div className="admin-form-card" style={{ marginBottom: 4 }}>
          <div className="admin-form-card-title">إضافة قسم جديد</div>
          <div className="admin-row-2">
            <label>المعرّف (بالإنجليزية)
              <input value={form.id} onChange={e => setForm(f => ({ ...f, id: e.target.value }))} placeholder="frozen" />
            </label>
            <label>الاسم
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="مجمدات" />
            </label>
          </div>
          <label>الإيموجي
            <input value={form.emoji} onChange={e => setForm(f => ({ ...f, emoji: e.target.value }))} placeholder="🧊" />
          </label>
          <label>لون الخلفية
            <span className="admin-form-chips">
              {TINTS.map(t => (
                <button key={t} type="button" className="admin-form-chip" style={{ background: t, borderColor: form.tint === t ? '#16A34A' : undefined, width: 32, height: 32, padding: 0 }} onClick={() => setForm(f => ({ ...f, tint: t }))} />
              ))}
            </span>
          </label>
          {createError && <div className="admin-form-error">{createError}</div>}
          <button className="admin-form-save" disabled={saving} onClick={createCategory}>حفظ القسم</button>
        </div>
      )}

      <div className="admin-categories-grid">
        {categories.map(c => (
          <div className="admin-category-card" key={c.id}>
            <div className="admin-category-card-head">
              <span className="admin-category-card-icon" style={{ background: c.image ? undefined : c.tint, padding: 0, overflow: 'hidden' }}>
                {c.image ? <img src={c.image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : c.emoji}
              </span>
              <span>
                <span className="admin-category-card-title">{c.name}</span>
                <span className="admin-category-card-sub">{c.productCount} منتج</span>
              </span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="admin-category-card-btn" disabled={uploadingId === c.id} onClick={() => triggerUpload(c.id)}>
                {uploadingId === c.id ? 'جارِ الرفع...' : c.image ? 'تغيير الصورة' : 'رفع صورة'}
              </button>
              {c.image && (
                <button className="admin-category-card-btn" disabled={uploadingId === c.id} onClick={() => removeImage(c.id)}>حذف الصورة</button>
              )}
            </div>
            <button className="admin-category-card-btn" onClick={() => navigate('/products/all')}>إدارة القسم</button>
          </div>
        ))}
      </div>
    </>
  )
}
