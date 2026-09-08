import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { StatsGrid } from '../components/StatsGrid'
import { OrderTable } from '../components/OrderTable'
import { api, ApiError, type AdminOrder } from '../utils/api'
import { formatMoney } from '../utils/money'
import type { LayoutContext } from '../components/AdminLayout'

const DAY_NAMES = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']

function startOfDay(date: Date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

export function HomePage() {
  const navigate = useNavigate()
  const { setHeader } = useOutletContext<LayoutContext>()
  const [orders, setOrders] = useState<AdminOrder[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    setHeader({ crumb: 'لوحة التحكم', title: 'الرئيسية' })
  }, [setHeader])

  useEffect(() => {
    api.listOrders()
      .then(({ orders }) => setOrders(orders))
      .catch(err => setError(err instanceof ApiError ? 'تعذر تحميل البيانات' : 'حدث خطأ، حاول مرة أخرى'))
  }, [])

  const today = startOfDay(new Date())
  const todayOrders = useMemo(() => (orders ?? []).filter(o => startOfDay(new Date(o.createdAt)).getTime() === today.getTime()), [orders, today])
  const newOrders = useMemo(() => (orders ?? []).filter(o => o.status === 'placed'), [orders])

  const chart = useMemo(() => {
    const days: { date: Date, total: number, count: number }[] = []
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today)
      d.setDate(d.getDate() - i)
      days.push({ date: d, total: 0, count: 0 })
    }
    for (const order of orders ?? []) {
      const day = startOfDay(new Date(order.createdAt)).getTime()
      const bucket = days.find(d => d.date.getTime() === day)
      if (bucket) { bucket.total += order.total; bucket.count += 1 }
    }
    const max = Math.max(1, ...days.map(d => d.total))
    return days.map(d => ({
      label: DAY_NAMES[d.date.getDay()],
      value: d.total >= 1000 ? Math.round(d.total / 1000) + 'k' : String(Math.round(d.total)),
      h: Math.round((d.total / max) * 100) + '%',
      count: d.count
    }))
  }, [orders, today])

  const topProducts = useMemo(() => {
    const totals = new Map<string, { name: string, qty: number, revenue: number }>()
    for (const order of orders ?? []) {
      for (const item of order.items) {
        const current = totals.get(item.name) ?? { name: item.name, qty: 0, revenue: 0 }
        current.qty += item.quantity
        current.revenue += item.lineTotal
        totals.set(item.name, current)
      }
    }
    return Array.from(totals.values()).sort((a, b) => b.qty - a.qty).slice(0, 5)
  }, [orders])

  if (error) return <div className="admin-placeholder-card"><div className="admin-placeholder-note">{error}</div></div>
  if (!orders) return null

  const todayRevenue = todayOrders.reduce((sum, o) => sum + o.total, 0)

  return (
    <>
      <StatsGrid stats={[
        { label: 'مبيعات اليوم', value: formatMoney(todayRevenue), note: `${todayOrders.length} طلب اليوم`, icon: '💰', tint: '#EAF8EF' },
        { label: 'عدد الطلبات', value: String(orders.length), note: 'إجمالي كل الطلبات', icon: '🧾', tint: '#EAF2FF' },
        { label: 'متوسط قيمة الطلب', value: formatMoney(todayOrders.length ? todayRevenue / todayOrders.length : 0), note: 'لطلبات اليوم', icon: '🛒', tint: '#FFF3E3' },
        { label: 'طلبات جديدة', value: String(newOrders.length), note: 'بانتظار القبول', icon: '🔔', tint: '#F3EEFB', noteColor: '#B45309' }
      ]} />

      <div className="admin-chart-card">
        <div className="admin-chart-head">
          <div>
            <div className="admin-chart-title">المبيعات</div>
            <div className="admin-chart-sub">آخر ٧ أيام</div>
          </div>
        </div>
        <div className="admin-chart-bars">
          {chart.map((d, i) => (
            <div className="admin-chart-col" key={i}>
              <div className="admin-chart-value">{d.value}</div>
              <div className="admin-chart-bar-group" style={{ height: d.h }}>
                <div className="admin-chart-bar" style={{ background: '#16A34A', height: '100%', flex: 1 }} />
              </div>
              <div className="admin-chart-label">{d.label}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="admin-layout-with-side has-side">
        <OrderTable
          orders={orders.slice(0, 5)}
          onRowClick={() => navigate('/orders/all')}
          footer="أحدث ٥ طلبات — من صفحة الطلبات لعرض التفاصيل"
        />
        <div className="admin-side-panels">
          <div className="admin-side-card">
            <div className="admin-side-title">أكثر المنتجات مبيعاً</div>
            <div className="admin-side-rows">
              {topProducts.length === 0 && <div style={{ color: '#8A948C', fontSize: 12.5, fontWeight: 600 }}>لا توجد بيانات بعد</div>}
              {topProducts.map(p => (
                <div className="admin-side-row" key={p.name}>
                  <span className="admin-side-row-icon" style={{ background: '#EAF8EF' }}>📦</span>
                  <span className="admin-side-row-info">
                    <span className="admin-side-row-title">{p.name}</span>
                    <span className="admin-side-row-sub">{p.qty} وحدة</span>
                  </span>
                  <span className="admin-side-row-value" style={{ color: '#12813C' }}>{formatMoney(p.revenue)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
