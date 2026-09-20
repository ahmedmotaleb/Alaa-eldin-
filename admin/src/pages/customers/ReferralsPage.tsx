import { useEffect, useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { StatsGrid } from '../../components/StatsGrid'
import { api, ApiError, type AdminReferralRow, type AdminReferralStatus, type ReferralAnalytics } from '../../utils/api'
import { formatMoney } from '../../utils/money'
import { formatDate } from '../../utils/format'
import { useDebouncedValue } from '../../utils/useDebouncedValue'
import type { LayoutContext } from '../../components/AdminLayout'

const COLS = '1.1fr 0.9fr 1.1fr 0.9fr 1fr 0.9fr 0.8fr 0.8fr 0.8fr 0.9fr'
const LIMIT = 20

const STATUS_LABEL: Record<AdminReferralStatus, string> = {
  pending: 'معلّقة', qualified: 'مؤهّلة', rewarded: 'مكافأة'
}
const STATUS_TINT: Record<AdminReferralStatus, { bg: string, fg: string }> = {
  pending: { bg: '#FFF3E3', fg: '#B4740E' },
  qualified: { bg: '#EAF2FF', fg: '#1D5BBF' },
  rewarded: { bg: '#EAF8EF', fg: '#12813C' }
}

const TABS: Array<{ id: string, label: string, status?: AdminReferralStatus }> = [
  { id: 'all', label: 'الكل' },
  { id: 'pending', label: 'معلّقة', status: 'pending' },
  { id: 'qualified', label: 'مؤهّلة', status: 'qualified' },
  { id: 'rewarded', label: 'مكافأة', status: 'rewarded' }
]

export function ReferralsPage() {
  const navigate = useNavigate()
  const { setHeader } = useOutletContext<LayoutContext>()
  const [analytics, setAnalytics] = useState<ReferralAnalytics | null>(null)
  const [referrals, setReferrals] = useState<AdminReferralRow[] | null>(null)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const debouncedQuery = useDebouncedValue(query)

  useEffect(() => {
    setHeader({ crumb: 'العملاء', title: 'الإحالات' })
  }, [setHeader])

  useEffect(() => {
    api.getReferralAnalytics().then(setAnalytics).catch(() => {})
  }, [])

  useEffect(() => { setPage(1) }, [debouncedQuery, tab, dateFrom, dateTo])

  useEffect(() => {
    const status = TABS.find(t => t.id === tab)?.status
    api.listReferrals({
      page, limit: LIMIT, status,
      search: debouncedQuery.trim() || undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined
    })
      .then(({ referrals, totalPages, total }) => {
        setReferrals(referrals)
        setTotalPages(totalPages ?? 1)
        setTotal(total ?? referrals.length)
      })
      .catch(err => setError(err instanceof ApiError ? 'تعذر تحميل بيانات الإحالات' : 'حدث خطأ، حاول مرة أخرى'))
  }, [page, tab, debouncedQuery, dateFrom, dateTo])

  if (error) return <div className="admin-placeholder-card"><div className="admin-placeholder-note">{error}</div></div>
  if (!referrals) return null

  return (
    <>
      {analytics && (
        <StatsGrid stats={[
          { label: 'إجمالي الإحالات', value: String(analytics.totalReferrals), note: `${analytics.customersAcquired} عميل مكتسب`, icon: '🔗', tint: '#EAF2FF' },
          { label: 'معلّقة / مؤهّلة', value: `${analytics.pendingReferrals} / ${analytics.qualifiedReferrals}`, note: 'قيد التأهيل', icon: '⏳', tint: '#FFF3E3' },
          { label: 'مكافأة', value: String(analytics.rewardedReferrals), note: `${analytics.totalPointsAwarded} نقطة إجمالاً`, icon: '🎁', tint: '#EAF8EF' },
          { label: 'إيراد من طلبات مؤهِّلة', value: formatMoney(analytics.revenueFromQualifyingOrders), note: `نسبة تحويل ${(analytics.conversionRate * 100).toFixed(1)}% — إيراد خام وليس ربحاً`, icon: '📈', tint: '#F1F4F2', noteColor: '#68746B' }
        ]} />
      )}

      <div className="admin-table-card">
        <div className="admin-table-tools" style={{ flexWrap: 'wrap', gap: 10 }}>
          <span className="admin-form-chips">
            {TABS.map(t => (
              <button key={t.id} type="button" className={`admin-form-chip ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>{t.label}</button>
            ))}
          </span>
          <div className="admin-search">
            <span style={{ color: '#8A948C', fontSize: 13 }}>🔎</span>
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="ابحث بالاسم أو الموبايل أو كود الإحالة..." />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#68746B' }}>
            من
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#68746B' }}>
            إلى
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} />
          </label>
        </div>
        <div className="admin-table-scroll">
          <div style={{ minWidth: 1300 }}>
            <div className="admin-table-head" style={{ gridTemplateColumns: COLS }}>
              <div>المُحيل</div><div>كود الإحالة</div><div>العميل المُحال</div><div>تاريخ التسجيل</div>
              <div>الطلب المؤهِّل</div><div>قيمة الطلب</div><div>الحالة</div><div>مكافأة المُحيل</div>
              <div>مكافأة المُحال</div><div>تاريخ المكافأة</div>
            </div>
            {referrals.map(r => {
              const tint = STATUS_TINT[r.status]
              return (
                <div key={r.id} className="admin-table-row clickable" style={{ gridTemplateColumns: COLS }} onClick={() => navigate(`/customers/referrals/${r.id}`)}>
                  <div className="admin-cell-plain">{r.referrerName}</div>
                  <div className="admin-cell-plain" style={{ fontWeight: 800 }}>{r.referralCode}</div>
                  <div className="admin-cell-plain">{r.referredName}</div>
                  <div className="admin-cell-plain" style={{ color: '#68746B' }}>{formatDate(r.createdAt)}</div>
                  <div className="admin-cell-plain" style={{ color: '#68746B' }}>{r.qualifyingOrderNumber ?? '—'}</div>
                  <div className="admin-cell-plain" style={{ fontWeight: 800 }}>{r.qualifyingOrderValue != null ? formatMoney(r.qualifyingOrderValue) : '—'}</div>
                  <div><span className="admin-pill" style={{ background: tint.bg, color: tint.fg }}>{STATUS_LABEL[r.status]}</span></div>
                  <div className="admin-cell-plain">{r.referrerRewardPoints ?? '—'}</div>
                  <div className="admin-cell-plain">{r.referredRewardPoints ?? '—'}</div>
                  <div className="admin-cell-plain" style={{ color: '#8A948C', fontSize: 12 }}>{r.rewardedAt ? formatDate(r.rewardedAt) : '—'}</div>
                </div>
              )
            })}
            {referrals.length === 0 && <div className="admin-table-empty">مفيش إحالات في هذا العرض</div>}
          </div>
        </div>
        <div className="admin-table-footer">
          <span>{total} إحالة</span>
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
