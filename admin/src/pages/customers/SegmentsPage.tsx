import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { api, ApiError, type AdminCustomer } from '../../utils/api'
import { formatMoney } from '../../utils/money'
import { formatDate } from '../../utils/format'
import type { LayoutContext } from '../../components/AdminLayout'

const COLS = '2fr 1fr .8fr 1fr 1fr'
const WEEK_MS = 7 * 24 * 60 * 60 * 1000
const INACTIVE_MS = 30 * 24 * 60 * 60 * 1000

interface Segment {
  id: string
  label: string
  icon: string
  tint: string
  note: string
  match: (c: AdminCustomer, vipThreshold: number) => boolean
}

const SEGMENTS: Segment[] = [
  {
    id: 'new', label: 'عملاء جدد', icon: '🆕', tint: '#EAF2FF',
    note: 'سجّلوا خلال آخر 7 أيام',
    match: c => Date.now() - new Date(c.createdAt).getTime() <= WEEK_MS
  },
  {
    id: 'repeat', label: 'عملاء متكررون', icon: '🔁', tint: '#EAF8EF',
    note: 'طلبوا أكتر من مرة',
    match: c => c.orderCount >= 2
  },
  {
    id: 'vip', label: 'كبار العملاء (VIP)', icon: '👑', tint: '#FFF3E3',
    note: 'أعلى 20% إنفاقاً',
    match: (c, vipThreshold) => c.orderCount > 0 && c.totalSpent >= vipThreshold
  },
  {
    id: 'at_risk', label: 'عملاء في خطر', icon: '⚠️', tint: '#FFECEC',
    note: 'طلبوا من قبل لكن مش من 30 يوم',
    match: c => c.orderCount > 0 && !!c.lastOrderAt && Date.now() - new Date(c.lastOrderAt).getTime() > INACTIVE_MS
  },
  {
    id: 'never', label: 'لم يطلبوا بعد', icon: '💤', tint: '#F1F4F2',
    note: 'مسجلين بدون أي طلب',
    match: c => c.orderCount === 0
  }
]

export function SegmentsPage() {
  const navigate = useNavigate()
  const { setHeader } = useOutletContext<LayoutContext>()
  const [customers, setCustomers] = useState<AdminCustomer[] | null>(null)
  const [error, setError] = useState('')
  const [activeSegment, setActiveSegment] = useState<string>('new')

  useEffect(() => {
    setHeader({ crumb: 'العملاء', title: 'شرائح العملاء' })
  }, [setHeader])

  useEffect(() => {
    api.listCustomers()
      .then(({ customers }) => setCustomers(customers))
      .catch(err => setError(err instanceof ApiError ? 'تعذر تحميل بيانات العملاء' : 'حدث خطأ، حاول مرة أخرى'))
  }, [])

  const vipThreshold = useMemo(() => {
    if (!customers) return Infinity
    const spenders = customers.filter(c => c.orderCount > 0).map(c => c.totalSpent).sort((a, b) => b - a)
    if (!spenders.length) return Infinity
    const cutoffIndex = Math.max(0, Math.ceil(spenders.length * 0.2) - 1)
    return spenders[cutoffIndex]
  }, [customers])

  const segmentCustomers = useMemo(() => {
    if (!customers) return new Map<string, AdminCustomer[]>()
    return new Map(SEGMENTS.map(s => [s.id, customers.filter(c => s.match(c, vipThreshold))]))
  }, [customers, vipThreshold])

  if (error) return <div className="admin-placeholder-card"><div className="admin-placeholder-note">{error}</div></div>
  if (!customers) return null

  const activeList = segmentCustomers.get(activeSegment) ?? []
  const activeDef = SEGMENTS.find(s => s.id === activeSegment)!
  const activeValue = activeList.reduce((a, c) => a + c.totalSpent, 0)

  return (
    <>
      <div className="admin-segments-grid">
        {SEGMENTS.map(s => (
          <button
            key={s.id}
            className={`admin-segment-card ${activeSegment === s.id ? 'active' : ''}`}
            onClick={() => setActiveSegment(s.id)}
          >
            <span className="admin-segment-icon" style={{ background: s.tint }}>{s.icon}</span>
            <span className="admin-segment-body">
              <span className="admin-segment-count">{(segmentCustomers.get(s.id) ?? []).length}</span>
              <span className="admin-segment-label">{s.label}</span>
              <span className="admin-segment-note">{s.note}</span>
            </span>
          </button>
        ))}
      </div>

      <div className="admin-table-card">
        <div className="admin-table-tools">
          <div style={{ fontWeight: 800, fontSize: 13.5 }}>{activeDef.label}</div>
          <div style={{ color: '#68746B', fontWeight: 700, fontSize: 12.5 }}>إجمالي إنفاق الشريحة: {formatMoney(activeValue)}</div>
        </div>
        <div className="admin-table-scroll">
          <div style={{ minWidth: 760 }}>
            <div className="admin-table-head" style={{ gridTemplateColumns: COLS }}>
              <div>العميل</div><div>تاريخ التسجيل</div><div>عدد الطلبات</div><div>إجمالي الإنفاق</div><div>آخر طلب</div>
            </div>
            {activeList.map(c => (
              <div key={c.id} className="admin-table-row clickable" style={{ gridTemplateColumns: COLS }} onClick={() => navigate(`/customers/${c.id}`)}>
                <div className="admin-cell-product">
                  <span style={{ minWidth: 0 }}>
                    <span className="admin-cell-product-text">{c.fullName}</span>
                    <span className="admin-cell-product-sub">{c.email}</span>
                  </span>
                </div>
                <div className="admin-cell-plain" style={{ color: '#68746B' }}>{formatDate(c.createdAt)}</div>
                <div className="admin-cell-plain" style={{ fontWeight: 800 }}>{c.orderCount}</div>
                <div className="admin-cell-plain" style={{ fontWeight: 800, color: '#12813C' }}>{formatMoney(c.totalSpent)}</div>
                <div className="admin-cell-plain" style={{ color: '#68746B' }}>{c.lastOrderAt ? formatDate(c.lastOrderAt) : '—'}</div>
              </div>
            ))}
            {activeList.length === 0 && <div className="admin-table-empty">مفيش عملاء في هذه الشريحة حالياً</div>}
          </div>
        </div>
        <div className="admin-table-footer">
          <span>{activeList.length} عميل</span>
          <span>اضغط على أي عميل لعرض ملفه وسجل طلباته</span>
        </div>
      </div>
    </>
  )
}
