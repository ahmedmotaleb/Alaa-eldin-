import { useEffect, useState } from 'react'
import { useNavigate, useOutletContext, useParams } from 'react-router-dom'
import { api, type AdminContentPage } from '../../utils/api'
import type { LayoutContext } from '../../components/AdminLayout'

export function PageEditorPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { setHeader } = useOutletContext<LayoutContext>()
  const [page, setPage] = useState<AdminContentPage | null>(null)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [active, setActive] = useState(true)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setHeader({ crumb: 'الصفحات', title: page?.title ?? 'تعديل صفحة' })
  }, [setHeader, page])

  useEffect(() => {
    if (!id) return
    api.getPage(Number(id))
      .then(({ page }) => {
        setPage(page)
        setTitle(page.title)
        setContent(page.content)
        setActive(page.active)
      })
      .catch(() => setError('تعذر تحميل بيانات الصفحة'))
      .finally(() => setLoading(false))
  }, [id])

  async function save() {
    if (!id) return
    setError('')
    setSuccess('')
    if (!title.trim()) {
      setError('عنوان الصفحة مطلوب')
      return
    }
    setSaving(true)
    try {
      const { page: updated } = await api.updatePage(Number(id), { title: title.trim(), content, active })
      setPage(updated)
      setSuccess('تم حفظ التغييرات')
    } catch {
      setError('تعذر حفظ التغييرات، حاول مرة أخرى')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return null
  if (error && !page) return <div className="admin-placeholder-card"><div className="admin-placeholder-note">{error}</div></div>
  if (!page) return null

  return (
    <div className="admin-form-grid">
      <div className="admin-form-card">
        <div>
          <div className="admin-form-card-title">محتوى الصفحة</div>
          <div className="admin-form-card-sub">هذا المحتوى يظهر مباشرة للعملاء في المتجر — يُعرض كنص عادي مع الحفاظ على فواصل الأسطر</div>
        </div>
        <label>العنوان
          <input value={title} onChange={e => setTitle(e.target.value)} maxLength={200} />
        </label>
        <label>المحتوى
          <textarea rows={16} value={content} onChange={e => setContent(e.target.value)} maxLength={20000} style={{ fontFamily: 'inherit', lineHeight: 1.7 }} />
        </label>
        <label>حالة الصفحة
          <span className="admin-form-chips">
            <button type="button" className={`admin-form-chip ${active ? 'active' : ''}`} onClick={() => setActive(true)}>منشورة للعملاء</button>
            <button type="button" className={`admin-form-chip ${!active ? 'active' : ''}`} onClick={() => setActive(false)}>غير منشورة</button>
          </span>
        </label>

        {error && <div className="admin-form-error">{error}</div>}
        {success && <div className="admin-form-success">{success}</div>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="admin-form-save" disabled={saving} onClick={save}>حفظ التغييرات</button>
          <button className="admin-form-chip" onClick={() => navigate('/pages')} type="button">رجوع لكل الصفحات</button>
        </div>
      </div>
    </div>
  )
}
