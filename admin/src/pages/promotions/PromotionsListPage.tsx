import { useEffect, useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { StatsGrid } from '../../components/StatsGrid'
import { api, ApiError, type AdminPromotion } from '../../utils/api'
import { useDebouncedValue } from '../../utils/useDebouncedValue'
import type { LayoutContext } from '../../components/AdminLayout'

const COLS = '1.4fr .9fr 1.6fr .8fr'
const LIMIT = 20

function isExpired(promotion: AdminPromotion) {
  return !!promotion.expiresAt && new Date(promotion.expiresAt).getTime() < Date.now()
}

function describeRule(p: AdminPromotion): string {
  if (p.type === 'buy_x_get_y') {
    const rewardSameGroup = !p.rewardProductId && !p.rewardCategoryId
    const freeOrPercent = p.getDiscountPercent === 100 ? 'مجاناً' : `بخصم ${p.getDiscountPercent}%`
    return rewardSameGroup
      ? `اشترِ ${p.buyQuantity} واحصل على ${p.getQuantity} ${freeOrPercent}`
      : `اشترِ ${p.buyQuantity} من صنف واحصل على ${p.getQuantity} من صنف آخر ${freeOrPercent}`
  }
  const groups = p.bundleItems?.length ?? 0
  return `باقة (${groups} ${groups === 1 ? 'مجموعة' : 'مجموعات'}) بسعر ثابت`
}

export function PromotionsListPage() {
  const navigate = useNavigate()
  const { setHeader } = useOutletContext<LayoutContext>()
  const [promotions, setPromotions] = useState<AdminPromotion[] | null>(null)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [statsPromotions, setStatsPromotions] = useState<AdminPromotion[]>([])
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebouncedValue(query)

  useEffect(() => {
    setHeader({ crumb: 'العروض', title: 'جميع العروض', action: { label: 'إنشاء عرض', onClick: () => navigate('/promotions/new') } })
  }, [setHeader, navigate])

  useEffect(() => {
    api.listPromotions().then(({ promotions }) => setStatsPromotions(promotions)).catch(() => {})
  }, [])

  useEffect(() => { setPage(1) }, [debouncedQuery])

  useEffect(() => {
    api.listPromotions({ page, limit: LIMIT, search: debouncedQuery.trim() || undefined })
      .then(({ promotions, totalPages, total }) => {
        setPromotions(promotions)
        setTotalPages(totalPages ?? 1)
        setTotal(total ?? promotions.length)
      })
      .catch(err => setError(err instanceof ApiError ? 'تعذر تحميل العروض' : 'حدث خطأ، حاول مرة أخرى'))
  }, [page, debouncedQuery])

  if (error) return <div className="admin-placeholder-card"><div className="admin-placeholder-note">{error}</div></div>
  if (!promotions) return null

  const activeCount = statsPromotions.filter(p => p.active && !isExpired(p)).length
  const bogoCount = statsPromotions.filter(p => p.type === 'buy_x_get_y').length
  const bundleCount = statsPromotions.filter(p => p.type === 'bundle_fixed_price').length

  return (
    <>
      <StatsGrid stats={[
        { label: 'عدد العروض', value: String(statsPromotions.length), note: 'كل العروض', icon: '🎁', tint: '#EAF2FF' },
        { label: 'عروض مفعّلة', value: String(activeCount), note: 'تُطبَّق تلقائياً الآن', icon: '✅', tint: '#EAF8EF' },
        { label: 'اشترِ واحصل', value: String(bogoCount), note: 'عروض BOGO', icon: '🛍️', tint: '#FFF3E3' },
        { label: 'باقات بسعر ثابت', value: String(bundleCount), note: 'عروض باقات', icon: '📦', tint: '#F1F4F2', noteColor: '#68746B' }
      ]} />

      <div className="admin-table-card">
        <div className="admin-table-tools">
          <div className="admin-search">
            <span style={{ color: '#8A948C', fontSize: 13 }}>🔎</span>
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="ابحث باسم العرض..." />
          </div>
        </div>
        <div className="admin-table-scroll">
          <div style={{ minWidth: 780 }}>
            <div className="admin-table-head" style={{ gridTemplateColumns: COLS }}>
              <div>اسم العرض</div><div>النوع</div><div>الوصف</div><div>الحالة</div>
            </div>
            {promotions.map(p => {
              const expired = isExpired(p)
              const status = expired
                ? { label: 'منتهي', bg: '#F1F4F2', fg: '#68746B' }
                : p.active
                  ? { label: 'مفعّل', bg: '#EAF8EF', fg: '#12813C' }
                  : { label: 'معطّل', bg: '#FFF0EF', fg: '#B42318' }
              return (
                <div key={p.id} className="admin-table-row clickable" style={{ gridTemplateColumns: COLS }} onClick={() => navigate(`/promotions/edit/${p.id}`)}>
                  <div className="admin-cell-plain" style={{ fontWeight: 900 }}>{p.name}</div>
                  <div className="admin-cell-plain" style={{ color: '#68746B' }}>{p.type === 'buy_x_get_y' ? 'اشترِ واحصل' : 'باقة بسعر ثابت'}</div>
                  <div className="admin-cell-plain" style={{ color: '#68746B' }}>{describeRule(p)}</div>
                  <div><span className="admin-pill" style={{ background: status.bg, color: status.fg }}>{status.label}</span></div>
                </div>
              )
            })}
            {promotions.length === 0 && <div className="admin-table-empty">مفيش عروض بعد</div>}
          </div>
        </div>
        <div className="admin-table-footer">
          <span>{total} عرض</span>
          <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span>صفحة {page} من {totalPages}</span>
            <button className="admin-form-chip" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>السابق</button>
            <button className="admin-form-chip" disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>التالي</button>
          </span>
        </div>
      </div>
    </>
  )
}
