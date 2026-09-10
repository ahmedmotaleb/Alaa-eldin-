import { useEffect, useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { StatsGrid } from '../../components/StatsGrid'
import { api, ApiError, type AdminDiscount } from '../../utils/api'
import { formatMoney } from '../../utils/money'
import { useDebouncedValue } from '../../utils/useDebouncedValue'
import type { LayoutContext } from '../../components/AdminLayout'

const COLS = '1.1fr .8fr .9fr 1fr 1fr .9fr'
const LIMIT = 20

function isExpired(discount: AdminDiscount) {
  return !!discount.expiresAt && new Date(discount.expiresAt).getTime() < Date.now()
}

export function DiscountsListPage() {
  const navigate = useNavigate()
  const { setHeader } = useOutletContext<LayoutContext>()
  const [discounts, setDiscounts] = useState<AdminDiscount[] | null>(null)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [statsDiscounts, setStatsDiscounts] = useState<AdminDiscount[]>([])
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebouncedValue(query)

  useEffect(() => {
    setHeader({ crumb: 'الخصومات', title: 'جميع الخصومات', action: { label: 'إنشاء خصم', onClick: () => navigate('/discounts/new') } })
  }, [setHeader, navigate])

  // الإحصائيات بتتحسب من كل الأكواد (بدون ترقيم) عشان تفضل صحيحة بغض النظر عن الصفحة
  // الحالية أو البحث المطبّق على الجدول.
  useEffect(() => {
    api.listDiscounts().then(({ discounts }) => setStatsDiscounts(discounts)).catch(() => {})
  }, [])

  useEffect(() => { setPage(1) }, [debouncedQuery])

  useEffect(() => {
    api.listDiscounts({ page, limit: LIMIT, search: debouncedQuery.trim() || undefined })
      .then(({ discounts, totalPages, total }) => {
        setDiscounts(discounts)
        setTotalPages(totalPages ?? 1)
        setTotal(total ?? discounts.length)
      })
      .catch(err => setError(err instanceof ApiError ? 'تعذر تحميل الخصومات' : 'حدث خطأ، حاول مرة أخرى'))
  }, [page, debouncedQuery])

  if (error) return <div className="admin-placeholder-card"><div className="admin-placeholder-note">{error}</div></div>
  if (!discounts) return null

  const activeCount = statsDiscounts.filter(d => d.active && !isExpired(d)).length
  const totalUses = statsDiscounts.reduce((a, d) => a + d.usedCount, 0)
  const expiredCount = statsDiscounts.filter(isExpired).length

  return (
    <>
      <StatsGrid stats={[
        { label: 'عدد الأكواد', value: String(statsDiscounts.length), note: 'كل الأكواد', icon: '🏷️', tint: '#EAF2FF' },
        { label: 'أكواد مفعّلة', value: String(activeCount), note: 'قابلة للاستخدام الآن', icon: '✅', tint: '#EAF8EF' },
        { label: 'مرات الاستخدام', value: String(totalUses), note: 'إجمالي كل الأكواد', icon: '🔁', tint: '#FFF3E3' },
        { label: 'أكواد منتهية', value: String(expiredCount), note: 'تجاوزت تاريخ الانتهاء', icon: '⏳', tint: '#F1F4F2', noteColor: '#68746B' }
      ]} />

      <div className="admin-table-card">
        <div className="admin-table-tools">
          <div className="admin-search">
            <span style={{ color: '#8A948C', fontSize: 13 }}>🔎</span>
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="ابحث بكود الخصم..." />
          </div>
        </div>
        <div className="admin-table-scroll">
          <div style={{ minWidth: 780 }}>
            <div className="admin-table-head" style={{ gridTemplateColumns: COLS }}>
              <div>الكود</div><div>النوع</div><div>القيمة</div><div>الحد الأدنى</div><div>الاستخدام</div><div>الحالة</div>
            </div>
            {discounts.map(d => {
              const expired = isExpired(d)
              const status = expired
                ? { label: 'منتهي', bg: '#F1F4F2', fg: '#68746B' }
                : d.active
                  ? { label: 'مفعّل', bg: '#EAF8EF', fg: '#12813C' }
                  : { label: 'معطّل', bg: '#FFF0EF', fg: '#B42318' }
              return (
                <div key={d.code} className="admin-table-row clickable" style={{ gridTemplateColumns: COLS }} onClick={() => navigate(`/discounts/edit/${d.code}`)}>
                  <div className="admin-cell-plain" style={{ fontWeight: 900 }}>{d.code}</div>
                  <div className="admin-cell-plain" style={{ color: '#68746B' }}>{d.type === 'percentage' ? 'نسبة مئوية' : 'قيمة ثابتة'}</div>
                  <div className="admin-cell-plain" style={{ fontWeight: 800 }}>{d.type === 'percentage' ? `${d.value}%` : formatMoney(d.value)}</div>
                  <div className="admin-cell-plain" style={{ color: '#68746B' }}>{d.minOrder ? formatMoney(d.minOrder) : '—'}</div>
                  <div className="admin-cell-plain" style={{ color: '#68746B' }}>{d.usedCount}{d.maxUses ? ` / ${d.maxUses}` : ''}</div>
                  <div><span className="admin-pill" style={{ background: status.bg, color: status.fg }}>{status.label}</span></div>
                </div>
              )
            })}
            {discounts.length === 0 && <div className="admin-table-empty">مفيش أكواد خصم بعد</div>}
          </div>
        </div>
        <div className="admin-table-footer">
          <span>{total} كود</span>
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
