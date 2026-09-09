import { useEffect, useMemo, useState } from 'react'
import { useOutletContext, useParams } from 'react-router-dom'
import { StatsGrid } from '../components/StatsGrid'
import {
  api, ApiError, type AdminCustomer,
  type AnalyticsOverview, type AnalyticsSales, type AnalyticsProducts, type AnalyticsRegions, type AnalyticsOrdersBreakdown,
  type AnalyticsRevenueDay, type AnalyticsCategoryRevenue
} from '../utils/api'
import { formatMoney } from '../utils/money'
import { ORDER_STATUS_COLOR, ORDER_STATUS_LABEL, ORDER_STATUS_ORDER } from '../orderStatus'
import { NAV } from '../nav'
import type { LayoutContext } from '../components/AdminLayout'

const ANALYTICS_NAV = NAV.find(g => g.id === 'analytics')!

const DELIVERY_SLOT_LABEL: Record<string, string> = {
  now: 'أقرب وقت (خلال ساعتين)',
  evening: 'اليوم مساءً',
  tomorrow: 'بكرة صباحاً'
}

// كل الحسابات (إيراد يومي/منتج/قسم/محافظة/موعد) بتتحسب دلوقتي في السيرفر مباشرة (SQL)
// بدل ما الواجهة تجيب كل الطلبات التاريخية وتحسبها بنفسها — نفس قاعدة استبعاد الطلبات
// الملغاة من الإيراد لسه سارية، بس دلوقتي مطبّقة في الاستعلام نفسه.
function useAnalyticsData() {
  const [overview, setOverview] = useState<AnalyticsOverview | null>(null)
  const [sales, setSales] = useState<AnalyticsSales | null>(null)
  const [products, setProducts] = useState<AnalyticsProducts | null>(null)
  const [regions, setRegions] = useState<AnalyticsRegions | null>(null)
  const [ordersBreakdown, setOrdersBreakdown] = useState<AnalyticsOrdersBreakdown | null>(null)
  const [customers, setCustomers] = useState<AdminCustomer[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([
      api.getAnalyticsOverview(), api.getAnalyticsSales(), api.getAnalyticsProducts(),
      api.getAnalyticsRegions(), api.getAnalyticsOrdersBreakdown(), api.listCustomers()
    ])
      .then(([overview, sales, products, regions, ordersBreakdown, customersRes]) => {
        setOverview(overview); setSales(sales); setProducts(products)
        setRegions(regions); setOrdersBreakdown(ordersBreakdown); setCustomers(customersRes.customers)
      })
      .catch(err => setError(err instanceof ApiError ? 'تعذر تحميل بيانات التحليلات' : 'حدث خطأ، حاول مرة أخرى'))
  }, [])

  return { overview, sales, products, regions, ordersBreakdown, customers, error }
}

function toCategoryRows(rows: AnalyticsCategoryRevenue[]) {
  const max = Math.max(1, ...rows.map(r => r.revenue))
  const grandTotal = Math.max(1, rows.reduce((a, r) => a + r.revenue, 0))
  return rows
    .map(r => ({
      label: r.categoryName,
      value: formatMoney(r.revenue),
      pct: Math.round((r.revenue / max) * 100),
      note: `${Math.round((r.revenue / grandTotal) * 100)}% من إيراد المنتجات`
    }))
    .filter(r => r.pct > 0)
}

function RevenueChart({ revenueByDay, days }: { revenueByDay: AnalyticsRevenueDay[], days: number }) {
  const buckets = useMemo(() => {
    const max = Math.max(1, ...revenueByDay.map(d => d.revenue))
    return revenueByDay.map(d => ({
      label: String(new Date(d.date).getDate()),
      value: d.revenue >= 1000 ? Math.round(d.revenue / 1000) + 'k' : String(Math.round(d.revenue)),
      h: Math.round((d.revenue / max) * 100) + '%'
    }))
  }, [revenueByDay])

  return (
    <div className="admin-chart-card">
      <div className="admin-chart-head">
        <div>
          <div className="admin-chart-title">المبيعات</div>
          <div className="admin-chart-sub">آخر {days} يوم</div>
        </div>
      </div>
      <div className="admin-chart-bars">
        {buckets.map((d, i) => (
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
  )
}

function BreakdownCard({ title, rows }: { title: string, rows: { label: string, note: string, value: string, pct: number, color?: string }[] }) {
  return (
    <div className="admin-side-card">
      <div className="admin-side-title">{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {rows.length === 0 && <div style={{ color: '#8A948C', fontSize: 12.5, fontWeight: 600 }}>لا توجد بيانات بعد</div>}
        {rows.map(r => (
          <div className="admin-breakdown-row" key={r.label}>
            <div className="admin-breakdown-head">
              <span>{r.label}</span>
              <span style={{ color: '#68746B', fontWeight: 700 }}>{r.value}</span>
            </div>
            <div className="admin-breakdown-track">
              <div className="admin-breakdown-fill" style={{ width: `${r.pct}%`, background: r.color ?? '#16A34A' }} />
            </div>
            <div style={{ fontSize: 10.5, fontWeight: 600, color: '#8A948C' }}>{r.note}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function AnalyticsPage() {
  const { tab } = useParams()
  const { setHeader } = useOutletContext<LayoutContext>()
  const activeTab = tab && ANALYTICS_NAV.children.find(c => c.id === tab) ? tab : 'overview'
  const tabLabel = ANALYTICS_NAV.children.find(c => c.id === activeTab)?.label ?? 'نظرة عامة'
  const { overview, sales, products, regions, ordersBreakdown, customers, error } = useAnalyticsData()

  useEffect(() => {
    setHeader({ crumb: 'التحليلات', title: tabLabel })
  }, [tabLabel, setHeader])

  if (error) return <div className="admin-placeholder-card"><div className="admin-placeholder-note">{error}</div></div>
  if (!overview || !sales || !products || !regions || !ordersBreakdown) return null

  if (activeTab === 'regions') {
    const regionRows = regions.regions
    const maxRegionRevenue = Math.max(1, ...regionRows.map(r => r.revenue))
    const definedRegionCount = regionRows.filter(r => r.governorate !== 'غير محدد').length
    const totalRegionRevenue = regionRows.reduce((sum, r) => sum + r.revenue, 0)

    return (
      <>
        <StatsGrid stats={[
          { label: 'محافظات لها طلبات', value: String(definedRegionCount), note: 'من إجمالي المحافظات', icon: '🗺️', tint: '#EAF2FF' },
          { label: 'الأكثر مبيعاً', value: regionRows[0]?.governorate ?? '—', note: regionRows[0] ? formatMoney(regionRows[0].revenue) : '', icon: '🏆', tint: '#EAF8EF' },
          { label: 'متوسط الطلب لكل محافظة', value: formatMoney(regionRows.length ? totalRegionRevenue / regionRows.length : 0), note: 'على مستوى المحافظات', icon: '📊', tint: '#FFF3E3' }
        ]} />
        <div className="admin-layout-with-side has-side">
          <div className="admin-table-card">
            <div className="admin-table-scroll">
              <div style={{ minWidth: 560 }}>
                <div className="admin-table-head" style={{ gridTemplateColumns: '2fr .8fr 1fr' }}>
                  <div>المحافظة</div><div>عدد الطلبات</div><div>الإيراد</div>
                </div>
                {regionRows.map(r => (
                  <div key={r.governorate} className="admin-table-row" style={{ gridTemplateColumns: '2fr .8fr 1fr' }}>
                    <div className="admin-cell-plain" style={{ color: r.governorate === 'غير محدد' ? '#8A948C' : undefined }}>{r.governorate}</div>
                    <div className="admin-cell-plain" style={{ fontWeight: 800 }}>{r.count}</div>
                    <div className="admin-cell-plain" style={{ fontWeight: 800, color: '#12813C' }}>{formatMoney(r.revenue)}</div>
                  </div>
                ))}
                {regionRows.length === 0 && <div className="admin-table-empty">لا توجد طلبات بعد</div>}
              </div>
            </div>
            <div className="admin-table-footer">
              <span>{regionRows.length} محافظة</span>
              <span>"غير محدد" = طلبات قبل إضافة حقل المحافظة</span>
            </div>
          </div>
          <div className="admin-side-panels">
            <BreakdownCard
              title="الإيراد حسب المحافظة"
              rows={regionRows.slice(0, 6).map(r => ({
                label: r.governorate,
                value: formatMoney(r.revenue),
                pct: Math.round((r.revenue / maxRegionRevenue) * 100),
                note: `${r.count} طلب`
              }))}
            />
          </div>
        </div>
      </>
    )
  }

  if (activeTab === 'overview') {
    return (
      <>
        <StatsGrid stats={[
          { label: 'إجمالي المبيعات', value: formatMoney(overview.totalRevenue), note: 'بدون الطلبات الملغاة', icon: '💰', tint: '#EAF8EF' },
          { label: 'عدد الطلبات', value: String(overview.totalOrders), note: 'منذ البداية', icon: '🧾', tint: '#EAF2FF' },
          { label: 'عدد العملاء', value: String(customers.length), note: 'حساب مسجّل', icon: '👥', tint: '#F3EEFB' },
          { label: 'متوسط قيمة الطلب', value: formatMoney(overview.avgOrderValue), note: 'بدون الطلبات الملغاة', icon: '🛒', tint: '#FFF3E3' }
        ]} />
        <div className="admin-layout-with-side has-side">
          <RevenueChart revenueByDay={overview.revenueByDay} days={14} />
          <div className="admin-side-panels">
            <BreakdownCard title="أكثر الأقسام مبيعاً" rows={toCategoryRows(overview.revenueByCategory).slice(0, 5)} />
          </div>
        </div>
      </>
    )
  }

  if (activeTab === 'sales') {
    const slotRows = sales.revenueBySlot
    const maxSlotRevenue = Math.max(1, ...slotRows.map(v => v.revenue))

    return (
      <>
        <StatsGrid stats={[
          { label: 'إجمالي المبيعات', value: formatMoney(sales.totalRevenue), note: 'بدون الطلبات الملغاة', icon: '💰', tint: '#EAF8EF' },
          { label: 'متوسط قيمة الطلب', value: formatMoney(sales.avgOrderValue), note: 'بدون الطلبات الملغاة', icon: '🛒', tint: '#FFF3E3' },
          { label: 'أعلى طلب', value: formatMoney(sales.maxOrderValue), note: 'أعلى قيمة طلب واحد', icon: '📈', tint: '#EAF2FF' }
        ]} />
        <div className="admin-layout-with-side has-side">
          <RevenueChart revenueByDay={sales.revenueByDay} days={14} />
          <div className="admin-side-panels">
            <BreakdownCard
              title="حسب موعد التوصيل"
              rows={slotRows.map(v => ({
                label: DELIVERY_SLOT_LABEL[v.slot] ?? v.slot,
                value: formatMoney(v.revenue),
                pct: Math.round((v.revenue / maxSlotRevenue) * 100),
                note: `${v.count} طلب`
              }))}
            />
          </div>
        </div>
      </>
    )
  }

  if (activeTab === 'products') {
    const topProducts = products.topProducts
    return (
      <>
        <StatsGrid stats={[
          { label: 'منتجات باعت فعلاً', value: String(products.soldProductCount), note: `من ${products.totalProductCount} في الكتالوج`, icon: '📦', tint: '#EAF2FF' },
          { label: 'أكثر منتج مبيعاً', value: topProducts[0]?.name ?? '—', note: topProducts[0] ? `${topProducts[0].qty} وحدة` : '', icon: '🏆', tint: '#EAF8EF' },
          { label: 'إيراد أفضل منتج', value: formatMoney(topProducts[0]?.revenue ?? 0), note: 'أعلى إيراد لمنتج واحد', icon: '💰', tint: '#FFF3E3' }
        ]} />
        <div className="admin-layout-with-side has-side">
          <div className="admin-table-card">
            <div className="admin-table-scroll">
              <div style={{ minWidth: 560 }}>
                <div className="admin-table-head" style={{ gridTemplateColumns: '2fr .8fr 1fr' }}>
                  <div>المنتج</div><div>الكمية المباعة</div><div>الإيراد</div>
                </div>
                {topProducts.slice(0, 10).map(p => (
                  <div key={p.productId} className="admin-table-row" style={{ gridTemplateColumns: '2fr .8fr 1fr' }}>
                    <div className="admin-cell-plain">{p.name}</div>
                    <div className="admin-cell-plain" style={{ fontWeight: 800 }}>{p.qty}</div>
                    <div className="admin-cell-plain" style={{ fontWeight: 800, color: '#12813C' }}>{formatMoney(p.revenue)}</div>
                  </div>
                ))}
                {topProducts.length === 0 && <div className="admin-table-empty">لا توجد مبيعات بعد</div>}
              </div>
            </div>
            <div className="admin-table-footer">
              <span>أعلى 10 منتجات إيراداً</span>
              <span>من كل الطلبات</span>
            </div>
          </div>
          <div className="admin-side-panels">
            <BreakdownCard title="الإيراد حسب القسم" rows={toCategoryRows(products.revenueByCategory)} />
          </div>
        </div>
      </>
    )
  }

  if (activeTab === 'customers') {
    const repeatCustomers = customers.filter(c => c.orderCount > 1).length
    const topCustomers = customers.slice().sort((a, b) => b.totalSpent - a.totalSpent).slice(0, 10)
    return (
      <>
        <StatsGrid stats={[
          { label: 'عدد العملاء', value: String(customers.length), note: 'حساب مسجّل', icon: '👥', tint: '#EAF2FF' },
          { label: 'عملاء بطلبات متكررة', value: String(repeatCustomers), note: 'أكتر من طلب واحد', icon: '🔁', tint: '#EAF8EF' },
          { label: 'متوسط الطلبات لكل عميل', value: customers.length ? (overview.totalOrders / customers.length).toFixed(1) : '0', note: 'لكل حساب مسجّل', icon: '🧾', tint: '#FFF3E3' }
        ]} />
        <div className="admin-table-card">
          <div className="admin-table-scroll">
            <div style={{ minWidth: 560 }}>
              <div className="admin-table-head" style={{ gridTemplateColumns: '2fr .8fr 1fr' }}>
                <div>العميل</div><div>عدد الطلبات</div><div>إجمالي الإنفاق</div>
              </div>
              {topCustomers.map(c => (
                <div key={c.id} className="admin-table-row" style={{ gridTemplateColumns: '2fr .8fr 1fr' }}>
                  <div className="admin-cell-plain">{c.fullName}</div>
                  <div className="admin-cell-plain" style={{ fontWeight: 800 }}>{c.orderCount}</div>
                  <div className="admin-cell-plain" style={{ fontWeight: 800, color: '#12813C' }}>{formatMoney(c.totalSpent)}</div>
                </div>
              ))}
              {topCustomers.length === 0 && <div className="admin-table-empty">لا يوجد عملاء بعد</div>}
            </div>
          </div>
          <div className="admin-table-footer">
            <span>أعلى 10 عملاء إنفاقاً</span>
            <span>من صفحة العملاء لعرض التفاصيل الكاملة</span>
          </div>
        </div>
      </>
    )
  }

  // activeTab === 'orders'
  const statusCounts = ORDER_STATUS_ORDER.map(status => ({
    status,
    count: ordersBreakdown.statusCounts.find(s => s.status === status)?.count ?? 0
  }))
  const maxStatusCount = Math.max(1, ...statusCounts.map(s => s.count))
  const cancelRate = ordersBreakdown.totalOrders ? Math.round((ordersBreakdown.cancelledCount / ordersBreakdown.totalOrders) * 100) : 0

  return (
    <>
      <StatsGrid stats={[
        { label: 'عدد الطلبات', value: String(ordersBreakdown.totalOrders), note: 'منذ البداية', icon: '🧾', tint: '#EAF2FF' },
        { label: 'نسبة الإلغاء', value: `${cancelRate}%`, note: `${ordersBreakdown.cancelledCount} طلب ملغي`, icon: '🚫', tint: '#FFECEC', noteColor: '#B42318' },
        { label: 'متوسط عدد المنتجات', value: ordersBreakdown.avgItemsPerOrder.toFixed(1), note: 'لكل طلب', icon: '📦', tint: '#FFF3E3' }
      ]} />
      <BreakdownCard
        title="حسب الحالة"
        rows={statusCounts.map(s => ({
          label: ORDER_STATUS_LABEL[s.status],
          value: String(s.count),
          pct: Math.round((s.count / maxStatusCount) * 100),
          note: ordersBreakdown.totalOrders ? `${Math.round((s.count / ordersBreakdown.totalOrders) * 100)}% من الطلبات` : '',
          color: ORDER_STATUS_COLOR[s.status][1]
        }))}
      />
    </>
  )
}
