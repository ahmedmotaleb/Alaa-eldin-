import { useEffect, useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { StatsGrid } from '../components/StatsGrid'
import { OrderTable } from '../components/OrderTable'
import { api, ApiError, type AdminOrder, type AnalyticsHomeSummary } from '../utils/api'
import { formatMoney } from '../utils/money'
import { useAuth } from '../store/AuthContext'
import type { LayoutContext } from '../components/AdminLayout'

const DAY_NAMES = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']
const RECENT_ORDERS_LIMIT = 5

export function HomePage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { setHeader } = useOutletContext<LayoutContext>()
  const [summary, setSummary] = useState<AnalyticsHomeSummary | null>(null)
  const [recentOrders, setRecentOrders] = useState<AdminOrder[] | null>(null)
  const [error, setError] = useState('')

  // حساب مندوب اتفتح على '/' مباشرة (زي بعد تحديث الصفحة، مش بس أول تسجيل دخول) — يترجّع
  // لشاشته المبسّطة بدل ما يشوف لوحة التحكم الكاملة اللي مالهاش صلاحية عليها أصلاً.
  useEffect(() => {
    if (user?.roleId === 'role-rider') navigate('/rider', { replace: true })
  }, [user, navigate])

  useEffect(() => {
    setHeader({ crumb: 'لوحة التحكم', title: 'الرئيسية' })
  }, [setHeader])

  useEffect(() => {
    Promise.all([api.getAnalyticsHomeSummary(), api.listOrders({ limit: RECENT_ORDERS_LIMIT })])
      .then(([summaryRes, ordersRes]) => { setSummary(summaryRes); setRecentOrders(ordersRes.orders) })
      .catch(err => setError(err instanceof ApiError ? 'تعذر تحميل البيانات' : 'حدث خطأ، حاول مرة أخرى'))
  }, [])

  if (error) return <div className="admin-placeholder-card"><div className="admin-placeholder-note">{error}</div></div>
  if (!summary || !recentOrders) return null

  const maxDayRevenue = Math.max(1, ...summary.revenueByDay.map(d => d.revenue))
  const chart = summary.revenueByDay.map(d => ({
    label: DAY_NAMES[new Date(d.date).getDay()],
    value: d.revenue >= 1000 ? Math.round(d.revenue / 1000) + 'k' : String(Math.round(d.revenue)),
    h: Math.round((d.revenue / maxDayRevenue) * 100) + '%'
  }))

  return (
    <>
      <StatsGrid stats={[
        { label: 'مبيعات اليوم', value: formatMoney(summary.todayRevenue), note: `${summary.todayOrderCount} طلب اليوم`, icon: '💰', tint: '#EAF8EF' },
        { label: 'عدد الطلبات', value: String(summary.totalOrders), note: 'إجمالي كل الطلبات', icon: '🧾', tint: '#EAF2FF' },
        { label: 'متوسط قيمة الطلب', value: formatMoney(summary.todayOrderCount ? summary.todayRevenue / summary.todayOrderCount : 0), note: 'لطلبات اليوم', icon: '🛒', tint: '#FFF3E3' },
        { label: 'طلبات جديدة', value: String(summary.newOrdersCount), note: 'بانتظار القبول', icon: '🔔', tint: '#F3EEFB', noteColor: '#B45309' }
      ]} />

      <div className="admin-chart-card">
        <div className="admin-chart-head">
          <div>
            <div className="admin-chart-title">المبيعات</div>
            <div className="admin-chart-sub">آخر 7 أيام</div>
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
          orders={recentOrders}
          onRowClick={() => navigate('/orders/all')}
          footer="أحدث 5 طلبات — من صفحة الطلبات لعرض التفاصيل"
        />
        <div className="admin-side-panels">
          <div className="admin-side-card">
            <div className="admin-side-title">أكثر المنتجات مبيعاً</div>
            <div className="admin-side-rows">
              {summary.topProducts.length === 0 && <div style={{ color: '#8A948C', fontSize: 12.5, fontWeight: 600 }}>لا توجد بيانات بعد</div>}
              {summary.topProducts.map(p => (
                <div className="admin-side-row" key={p.productId}>
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
