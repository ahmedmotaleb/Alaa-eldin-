import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { StatsGrid } from '../../components/StatsGrid'
import { api, ApiError, type AdminCustomer } from '../../utils/api'
import { formatMoney } from '../../utils/money'
import type { LayoutContext } from '../../components/AdminLayout'

const COLS = '2fr 1fr .8fr 1fr 1fr'
const WEEK_MS = 7 * 24 * 60 * 60 * 1000

export function CustomersListPage() {
  const navigate = useNavigate()
  const { setHeader } = useOutletContext<LayoutContext>()
  const [customers, setCustomers] = useState<AdminCustomer[] | null>(null)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')

  useEffect(() => {
    setHeader({ crumb: 'العملاء', title: 'جميع العملاء' })
  }, [setHeader])

  useEffect(() => {
    api.listCustomers()
      .then(({ customers }) => setCustomers(customers))
      .catch(err => setError(err instanceof ApiError ? 'تعذر تحميل بيانات العملاء' : 'حدث خطأ، حاول مرة أخرى'))
  }, [])

  const filtered = useMemo(() => {
    if (!customers) return []
    const q = query.trim()
    if (!q) return customers
    return customers.filter(c => c.fullName.includes(q) || c.email.includes(q) || (c.lastMobile ?? '').includes(q))
  }, [customers, query])

  if (error) return <div className="admin-placeholder-card"><div className="admin-placeholder-note">{error}</div></div>
  if (!customers) return null

  const newThisWeek = customers.filter(c => Date.now() - new Date(c.createdAt).getTime() <= WEEK_MS).length
  const withOrders = customers.filter(c => c.orderCount > 0)
  const avgOrderValue = withOrders.length
    ? withOrders.reduce((a, c) => a + c.totalSpent / c.orderCount, 0) / withOrders.length
    : 0

  return (
    <>
      <StatsGrid stats={[
        { label: 'عدد العملاء', value: String(customers.length), note: 'حساب مسجّل', icon: '👥', tint: '#EAF2FF' },
        { label: 'عملاء جدد', value: String(newThisWeek), note: 'آخر ٧ أيام', icon: '🆕', tint: '#EAF8EF' },
        { label: 'متوسط قيمة الطلب', value: formatMoney(avgOrderValue), note: 'لعملاء لديهم طلبات', icon: '🛒', tint: '#FFF3E3' },
        { label: 'لم يطلبوا بعد', value: String(customers.length - withOrders.length), note: 'مسجلين بدون طلبات', icon: '💤', tint: '#F1F4F2', noteColor: '#68746B' }
      ]} />

      <div className="admin-table-card">
        <div className="admin-table-tools">
          <div className="admin-search">
            <span style={{ color: '#8A948C', fontSize: 13 }}>🔎</span>
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="ابحث بالاسم أو البريد أو الهاتف..." />
          </div>
        </div>
        <div className="admin-table-scroll">
          <div style={{ minWidth: 760 }}>
            <div className="admin-table-head" style={{ gridTemplateColumns: COLS }}>
              <div>العميل</div><div>تاريخ التسجيل</div><div>عدد الطلبات</div><div>إجمالي الإنفاق</div><div>آخر طلب</div>
            </div>
            {filtered.map(c => (
              <div key={c.id} className="admin-table-row clickable" style={{ gridTemplateColumns: COLS }} onClick={() => navigate(`/customers/${c.id}`)}>
                <div className="admin-cell-product">
                  <span style={{ minWidth: 0 }}>
                    <span className="admin-cell-product-text">{c.fullName}</span>
                    <span className="admin-cell-product-sub">{c.email}</span>
                  </span>
                </div>
                <div className="admin-cell-plain" style={{ color: '#68746B' }}>{new Date(c.createdAt).toLocaleDateString('ar-EG')}</div>
                <div className="admin-cell-plain" style={{ fontWeight: 800 }}>{c.orderCount}</div>
                <div className="admin-cell-plain" style={{ fontWeight: 800, color: '#12813C' }}>{formatMoney(c.totalSpent)}</div>
                <div className="admin-cell-plain" style={{ color: '#68746B' }}>{c.lastOrderAt ? new Date(c.lastOrderAt).toLocaleDateString('ar-EG') : '—'}</div>
              </div>
            ))}
            {filtered.length === 0 && <div className="admin-table-empty">مفيش بيانات في هذا العرض</div>}
          </div>
        </div>
        <div className="admin-table-footer">
          <span>{filtered.length} عميل</span>
          <span>اضغط على أي عميل لعرض ملفه وسجل طلباته</span>
        </div>
      </div>
    </>
  )
}
