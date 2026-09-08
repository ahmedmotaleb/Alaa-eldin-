import { useEffect, useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { api, ApiError, type AdminBanner } from '../../utils/api'
import type { LayoutContext } from '../../components/AdminLayout'

export function BannersListPage() {
  const navigate = useNavigate()
  const { setHeader } = useOutletContext<LayoutContext>()
  const [banners, setBanners] = useState<AdminBanner[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    setHeader({ crumb: 'التسويق', title: 'البنرات', action: { label: 'إضافة بانر', onClick: () => navigate('/marketing/banners/add') } })
  }, [setHeader, navigate])

  useEffect(() => {
    api.listBanners()
      .then(({ banners }) => setBanners(banners))
      .catch(err => setError(err instanceof ApiError ? 'تعذر تحميل البنرات' : 'حدث خطأ، حاول مرة أخرى'))
  }, [])

  if (error) return <div className="admin-placeholder-card"><div className="admin-placeholder-note">{error}</div></div>
  if (!banners) return null

  return (
    <div className="admin-categories-grid">
      {banners.map(b => (
        <div className="admin-category-card" key={b.id}>
          <div className="admin-category-card-head">
            <span className="admin-category-card-icon" style={{ background: '#F1F4F2' }}>{b.emoji}</span>
            <span style={{ minWidth: 0 }}>
              <span className="admin-category-card-title">{b.title}</span>
              <span className="admin-category-card-sub">{b.note || '—'}</span>
            </span>
          </div>
          <span className="admin-pill" style={{ alignSelf: 'flex-start', background: b.active ? '#EAF8EF' : '#F1F4F2', color: b.active ? '#12813C' : '#68746B' }}>
            {b.active ? 'ظاهر للعملاء' : 'مخفي'}
          </span>
          <button className="admin-category-card-btn" onClick={() => navigate(`/marketing/banners/edit/${b.id}`)}>تعديل</button>
        </div>
      ))}
      {banners.length === 0 && (
        <div className="admin-placeholder-card">
          <div className="admin-placeholder-note">مفيش بنرات بعد — اضغط "إضافة بانر" لإنشاء أول بانر.</div>
        </div>
      )}
    </div>
  )
}
