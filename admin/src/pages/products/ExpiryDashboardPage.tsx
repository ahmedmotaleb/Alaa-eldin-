import { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { StatsGrid } from '../../components/StatsGrid'
import { api, ApiError, type ExpiryBatchRow, type ExpiryDashboard } from '../../utils/api'
import { formatMoney } from '../../utils/money'
import type { LayoutContext } from '../../components/AdminLayout'

const COLS = '1.3fr 1fr .8fr 1fr .8fr 1fr'

function Section({ title, rows, tint }: { title: string, rows: ExpiryBatchRow[], tint: string }) {
  if (rows.length === 0) return null
  return (
    <div className="admin-table-card" style={{ marginBottom: 16 }}>
      <div className="admin-table-tools">
        <span className="admin-pill" style={{ background: tint, fontWeight: 800 }}>{title} ({rows.length})</span>
      </div>
      <div className="admin-table-scroll">
        <div style={{ minWidth: 720 }}>
          <div className="admin-table-head" style={{ gridTemplateColumns: COLS }}>
            <div>المنتج</div><div>رقم الدفعة</div><div>الكمية المتبقية</div><div>تاريخ الانتهاء</div><div>الأيام المتبقية</div><div>القيمة المعرّضة للخطر</div>
          </div>
          {rows.map(r => (
            <div key={r.batchId} className="admin-table-row" style={{ gridTemplateColumns: COLS }}>
              <div className="admin-cell-plain" style={{ fontWeight: 700 }}>{r.productName}</div>
              <div className="admin-cell-plain" style={{ color: '#68746B' }}>{r.batchNumber || '—'}</div>
              <div className="admin-cell-plain">{r.quantityRemaining}</div>
              <div className="admin-cell-plain" style={{ color: '#68746B' }}>{r.expiryDate.slice(0, 10)}</div>
              <div className="admin-cell-plain">{r.daysRemaining}</div>
              <div className="admin-cell-plain" style={{ fontWeight: 800 }}>{formatMoney(r.costValueAtRisk)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export function ExpiryDashboardPage() {
  const { setHeader } = useOutletContext<LayoutContext>()
  const [dashboard, setDashboard] = useState<ExpiryDashboard | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    setHeader({ crumb: 'المخزون', title: 'الصلاحية' })
  }, [setHeader])

  useEffect(() => {
    api.getExpiryDashboard()
      .then(setDashboard)
      .catch(err => setError(err instanceof ApiError ? 'تعذر تحميل بيانات الصلاحية' : 'حدث خطأ، حاول مرة أخرى'))
  }, [])

  if (error) return <div className="admin-placeholder-card"><div className="admin-placeholder-note">{error}</div></div>
  if (!dashboard) return null

  const totalAtRisk = [...dashboard.expired, ...dashboard.within7Days, ...dashboard.within30Days, ...dashboard.within60Days]
    .reduce((sum, r) => sum + r.costValueAtRisk, 0)

  return (
    <>
      <StatsGrid stats={[
        { label: 'منتهي الصلاحية', value: String(dashboard.expired.length), note: 'دفعات', icon: '⛔', tint: '#FFF0EF' },
        { label: 'ينتهي خلال 7 أيام', value: String(dashboard.within7Days.length), note: 'دفعات', icon: '⏰', tint: '#FFF3E3' },
        { label: 'ينتهي خلال 30 يوم', value: String(dashboard.within30Days.length), note: 'دفعات', icon: '📅', tint: '#EAF2FF' },
        { label: 'القيمة الإجمالية المعرّضة للخطر', value: formatMoney(totalAtRisk), note: 'كل الفئات أعلاه', icon: '💸', tint: '#F1F4F2', noteColor: '#68746B' }
      ]} />

      <Section title="منتهي الصلاحية" rows={dashboard.expired} tint="#FFF0EF" />
      <Section title="ينتهي خلال 7 أيام" rows={dashboard.within7Days} tint="#FFF3E3" />
      <Section title="ينتهي خلال 30 يوم" rows={dashboard.within30Days} tint="#EAF2FF" />
      <Section title="ينتهي خلال 60 يوم" rows={dashboard.within60Days} tint="#F1F4F2" />

      {dashboard.expired.length + dashboard.within7Days.length + dashboard.within30Days.length + dashboard.within60Days.length === 0 && (
        <div className="admin-placeholder-card"><div className="admin-placeholder-note">مفيش دفعات قريبة من انتهاء الصلاحية حالياً</div></div>
      )}
    </>
  )
}
