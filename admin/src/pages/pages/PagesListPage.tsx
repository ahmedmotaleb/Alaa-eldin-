import { useEffect, useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { api, ApiError, type AdminContentPage } from '../../utils/api'
import { formatDateTime } from '../../utils/format'
import type { LayoutContext } from '../../components/AdminLayout'

export function PagesListPage() {
  const navigate = useNavigate()
  const { setHeader } = useOutletContext<LayoutContext>()
  const [pages, setPages] = useState<AdminContentPage[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    setHeader({ crumb: 'الصفحات', title: 'صفحات المحتوى' })
  }, [setHeader])

  useEffect(() => {
    api.listPages()
      .then(({ pages }) => setPages(pages))
      .catch(err => setError(err instanceof ApiError ? 'تعذر تحميل الصفحات' : 'حدث خطأ، حاول مرة أخرى'))
  }, [])

  if (error) return <div className="admin-placeholder-card"><div className="admin-placeholder-note">{error}</div></div>
  if (!pages) return null

  return (
    <div className="admin-categories-grid">
      {pages.map(p => (
        <div className="admin-category-card" key={p.id}>
          <div className="admin-category-card-head">
            <span className="admin-category-card-icon" style={{ background: '#F1F4F2' }}>📄</span>
            <span style={{ minWidth: 0 }}>
              <span className="admin-category-card-title">{p.title}</span>
              <span className="admin-category-card-sub">آخر تعديل: {formatDateTime(p.updatedAt)}</span>
            </span>
          </div>
          <span className="admin-pill" style={{ alignSelf: 'flex-start', background: p.active ? '#EAF8EF' : '#F1F4F2', color: p.active ? '#12813C' : '#68746B' }}>
            {p.active ? 'منشورة للعملاء' : 'غير منشورة'}
          </span>
          <button className="admin-category-card-btn" onClick={() => navigate(`/pages/edit/${p.id}`)}>تعديل</button>
        </div>
      ))}
      {pages.length === 0 && (
        <div className="admin-placeholder-card">
          <div className="admin-placeholder-note">مفيش صفحات محتوى بعد.</div>
        </div>
      )}
    </div>
  )
}
