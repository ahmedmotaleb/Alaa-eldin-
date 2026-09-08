import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { StatsGrid } from '../../components/StatsGrid'
import { api, ApiError, type AdminDiscount } from '../../utils/api'
import { formatMoney } from '../../utils/money'
import type { LayoutContext } from '../../components/AdminLayout'

const COLS = '1.1fr .8fr .9fr 1fr 1fr .9fr'

function isExpired(discount: AdminDiscount) {
  return !!discount.expiresAt && new Date(discount.expiresAt).getTime() < Date.now()
}

export function DiscountsListPage() {
  const navigate = useNavigate()
  const { setHeader } = useOutletContext<LayoutContext>()
  const [discounts, setDiscounts] = useState<AdminDiscount[] | null>(null)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')

  useEffect(() => {
    setHeader({ crumb: 'الخصومات', title: 'جميع الخصومات', action: { label: 'إنشاء خصم', onClick: () => navigate('/discounts/new') } })
  }, [setHeader, navigate])

  useEffect(() => {
    api.listDiscounts()
      .then(({ discounts }) => setDiscounts(discounts))
      .catch(err => setError(err instanceof ApiError ? 'تعذر تحميل الخصومات' : 'حدث خطأ، حاول مرة أخرى'))
  }, [])

  const filtered = useMemo(() => {
    if (!discounts) return []
    const q = query.trim().toUpperCase()
    return discounts.filter(d => !q || d.code.includes(q))
  }, [discounts, query])

  if (error) return <div className="admin-placeholder-card"><div className="admin-placeholder-note">{error}</div></div>
  if (!discounts) return null

  const activeCount = discounts.filter(d => d.active && !isExpired(d)).length
  const totalUses = discounts.reduce((a, d) => a + d.usedCount, 0)
  const expiredCount = discounts.filter(isExpired).length

  return (
    <>
      <StatsGrid stats={[
        { label: 'عدد الأكواد', value: String(discounts.length), note: 'كل الأكواد', icon: '🏷️', tint: '#EAF2FF' },
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
            {filtered.map(d => {
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
            {filtered.length === 0 && <div className="admin-table-empty">مفيش أكواد خصم بعد</div>}
          </div>
        </div>
        <div className="admin-table-footer">
          <span>{filtered.length} كود</span>
          <span>اضغط على أي كود لتعديله</span>
        </div>
      </div>
    </>
  )
}
