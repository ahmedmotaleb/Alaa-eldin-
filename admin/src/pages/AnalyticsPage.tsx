import { useEffect, useMemo, useState } from 'react'
import { useOutletContext, useParams } from 'react-router-dom'
import { StatsGrid } from '../components/StatsGrid'
import { api, ApiError, type AdminCategory, type AdminCustomer, type AdminOrder, type AdminProduct } from '../utils/api'
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

function startOfDay(date: Date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

function useAnalyticsData() {
  const [orders, setOrders] = useState<AdminOrder[] | null>(null)
  const [products, setProducts] = useState<AdminProduct[]>([])
  const [categories, setCategories] = useState<AdminCategory[]>([])
  const [customers, setCustomers] = useState<AdminCustomer[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([api.listOrders(), api.listProducts(), api.listCategories(), api.listCustomers()])
      .then(([o, p, c, cu]) => { setOrders(o.orders); setProducts(p.products); setCategories(c.categories); setCustomers(cu.customers) })
      .catch(err => setError(err instanceof ApiError ? 'تعذر تحميل بيانات التحليلات' : 'حدث خطأ، حاول مرة أخرى'))
  }, [])

  return { orders, products, categories, customers, error }
}

function RevenueChart({ orders, days }: { orders: AdminOrder[], days: number }) {
  const buckets = useMemo(() => {
    const today = startOfDay(new Date())
    const list: { date: Date, total: number, count: number }[] = []
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today)
      d.setDate(d.getDate() - i)
      list.push({ date: d, total: 0, count: 0 })
    }
    for (const order of orders) {
      const day = startOfDay(new Date(order.createdAt)).getTime()
      const bucket = list.find(b => b.date.getTime() === day)
      if (bucket) { bucket.total += order.total; bucket.count += 1 }
    }
    const max = Math.max(1, ...list.map(b => b.total))
    return list.map(b => ({
      label: String(b.date.getDate()),
      value: b.total >= 1000 ? Math.round(b.total / 1000) + 'k' : String(Math.round(b.total)),
      h: Math.round((b.total / max) * 100) + '%'
    }))
  }, [orders, days])

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
  const { orders, products, categories, customers, error } = useAnalyticsData()

  useEffect(() => {
    setHeader({ crumb: 'التحليلات', title: tabLabel })
  }, [tabLabel, setHeader])

  // الطلبات الملغاة لا تحسب كإيراد فعلي — تُستبعد من كل حسابات المبيعات/المنتجات/الأقسام،
  // وتبقى فقط ضمن "عدد الطلبات" وتفصيل الحالات في تبويب الطلبات.
  const revenueOrders = useMemo(() => (orders ?? []).filter(o => o.status !== 'cancelled'), [orders])

  const categoryRevenue = useMemo(() => {
    if (!orders) return []
    const byProduct = new Map(products.map(p => [p.id, p]))
    const totals = new Map<string, number>()
    for (const order of revenueOrders) {
      for (const item of order.items) {
        const categoryId = byProduct.get(item.productId)?.categoryId
        if (!categoryId) continue
        totals.set(categoryId, (totals.get(categoryId) ?? 0) + item.lineTotal)
      }
    }
    const max = Math.max(1, ...totals.values())
    const grandTotal = Math.max(1, Array.from(totals.values()).reduce((a, v) => a + v, 0))
    return categories
      .map(c => {
        const revenue = totals.get(c.id) ?? 0
        return {
          label: c.name,
          value: formatMoney(revenue),
          pct: Math.round((revenue / max) * 100),
          note: `${Math.round((revenue / grandTotal) * 100)}% من إيراد المنتجات`
        }
      })
      .filter(r => r.pct > 0)
      .sort((a, b) => b.pct - a.pct)
  }, [orders, products, categories, revenueOrders])

  const topProducts = useMemo(() => {
    const totals = new Map<string, { name: string, qty: number, revenue: number }>()
    for (const order of revenueOrders) {
      for (const item of order.items) {
        const current = totals.get(item.productId) ?? { name: item.name, qty: 0, revenue: 0 }
        current.qty += item.quantity
        current.revenue += item.lineTotal
        totals.set(item.productId, current)
      }
    }
    return Array.from(totals.values()).sort((a, b) => b.revenue - a.revenue)
  }, [revenueOrders])

  if (error) return <div className="admin-placeholder-card"><div className="admin-placeholder-note">{error}</div></div>
  if (!orders) return null

  const totalRevenue = revenueOrders.reduce((sum, o) => sum + o.total, 0)

  if (activeTab === 'regions') {
    const byGovernorate = new Map<string, { count: number, revenue: number }>()
    for (const order of revenueOrders) {
      const key = order.customer.governorate.trim() || 'غير محدد'
      const current = byGovernorate.get(key) ?? { count: 0, revenue: 0 }
      current.count += 1
      current.revenue += order.total
      byGovernorate.set(key, current)
    }
    const regionRows = Array.from(byGovernorate.entries())
      .map(([governorate, v]) => ({ governorate, ...v }))
      .sort((a, b) => b.revenue - a.revenue)
    const maxRegionRevenue = Math.max(1, ...regionRows.map(r => r.revenue))

    return (
      <>
        <StatsGrid stats={[
          { label: 'محافظات لها طلبات', value: String(regionRows.filter(r => r.governorate !== 'غير محدد').length), note: 'من إجمالي المحافظات', icon: '🗺️', tint: '#EAF2FF' },
          { label: 'الأكثر مبيعاً', value: regionRows[0]?.governorate ?? '—', note: regionRows[0] ? formatMoney(regionRows[0].revenue) : '', icon: '🏆', tint: '#EAF8EF' },
          { label: 'متوسط الطلب لكل محافظة', value: formatMoney(regionRows.length ? totalRevenue / regionRows.length : 0), note: 'على مستوى المحافظات', icon: '📊', tint: '#FFF3E3' }
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
  const avgOrder = revenueOrders.length ? totalRevenue / revenueOrders.length : 0

  if (activeTab === 'overview') {
    return (
      <>
        <StatsGrid stats={[
          { label: 'إجمالي المبيعات', value: formatMoney(totalRevenue), note: 'بدون الطلبات الملغاة', icon: '💰', tint: '#EAF8EF' },
          { label: 'عدد الطلبات', value: String(orders.length), note: 'منذ البداية', icon: '🧾', tint: '#EAF2FF' },
          { label: 'عدد العملاء', value: String(customers.length), note: 'حساب مسجّل', icon: '👥', tint: '#F3EEFB' },
          { label: 'متوسط قيمة الطلب', value: formatMoney(avgOrder), note: 'بدون الطلبات الملغاة', icon: '🛒', tint: '#FFF3E3' }
        ]} />
        <div className="admin-layout-with-side has-side">
          <RevenueChart orders={revenueOrders} days={14} />
          <div className="admin-side-panels">
            <BreakdownCard title="أكثر الأقسام مبيعاً" rows={categoryRevenue.slice(0, 5)} />
          </div>
        </div>
      </>
    )
  }

  if (activeTab === 'sales') {
    const bySlot = Object.entries(
      revenueOrders.reduce<Record<string, { count: number, revenue: number }>>((acc, o) => {
        const key = o.deliverySlot
        acc[key] = acc[key] ?? { count: 0, revenue: 0 }
        acc[key].count += 1
        acc[key].revenue += o.total
        return acc
      }, {})
    )
    const maxSlotRevenue = Math.max(1, ...bySlot.map(([, v]) => v.revenue))

    return (
      <>
        <StatsGrid stats={[
          { label: 'إجمالي المبيعات', value: formatMoney(totalRevenue), note: 'بدون الطلبات الملغاة', icon: '💰', tint: '#EAF8EF' },
          { label: 'متوسط قيمة الطلب', value: formatMoney(avgOrder), note: 'بدون الطلبات الملغاة', icon: '🛒', tint: '#FFF3E3' },
          { label: 'أعلى طلب', value: formatMoney(Math.max(0, ...revenueOrders.map(o => o.total))), note: 'أعلى قيمة طلب واحد', icon: '📈', tint: '#EAF2FF' }
        ]} />
        <div className="admin-layout-with-side has-side">
          <RevenueChart orders={revenueOrders} days={14} />
          <div className="admin-side-panels">
            <BreakdownCard
              title="حسب موعد التوصيل"
              rows={bySlot.map(([slot, v]) => ({
                label: DELIVERY_SLOT_LABEL[slot] ?? slot,
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
    const soldProducts = topProducts.length
    return (
      <>
        <StatsGrid stats={[
          { label: 'منتجات باعت فعلاً', value: String(soldProducts), note: `من ${products.length} في الكتالوج`, icon: '📦', tint: '#EAF2FF' },
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
                  <div key={p.name} className="admin-table-row" style={{ gridTemplateColumns: '2fr .8fr 1fr' }}>
                    <div className="admin-cell-plain">{p.name}</div>
                    <div className="admin-cell-plain" style={{ fontWeight: 800 }}>{p.qty}</div>
                    <div className="admin-cell-plain" style={{ fontWeight: 800, color: '#12813C' }}>{formatMoney(p.revenue)}</div>
                  </div>
                ))}
                {topProducts.length === 0 && <div className="admin-table-empty">لا توجد مبيعات بعد</div>}
              </div>
            </div>
            <div className="admin-table-footer">
              <span>أعلى ١٠ منتجات إيراداً</span>
              <span>من كل الطلبات</span>
            </div>
          </div>
          <div className="admin-side-panels">
            <BreakdownCard title="الإيراد حسب القسم" rows={categoryRevenue} />
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
          { label: 'متوسط الطلبات لكل عميل', value: (customers.length ? (orders.length / customers.length).toFixed(1) : '0'), note: 'لكل حساب مسجّل', icon: '🧾', tint: '#FFF3E3' }
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
            <span>أعلى ١٠ عملاء إنفاقاً</span>
            <span>من صفحة العملاء لعرض التفاصيل الكاملة</span>
          </div>
        </div>
      </>
    )
  }

  // activeTab === 'orders'
  const statusCounts = ORDER_STATUS_ORDER.map(status => ({
    status,
    count: orders.filter(o => o.status === status).length
  }))
  const maxStatusCount = Math.max(1, ...statusCounts.map(s => s.count))
  const avgItems = orders.length ? orders.reduce((a, o) => a + o.items.reduce((s, i) => s + i.quantity, 0), 0) / orders.length : 0
  const cancelled = orders.filter(o => o.status === 'cancelled').length
  const cancelRate = orders.length ? Math.round((cancelled / orders.length) * 100) : 0

  return (
    <>
      <StatsGrid stats={[
        { label: 'عدد الطلبات', value: String(orders.length), note: 'منذ البداية', icon: '🧾', tint: '#EAF2FF' },
        { label: 'نسبة الإلغاء', value: `${cancelRate}%`, note: `${cancelled} طلب ملغي`, icon: '🚫', tint: '#FFECEC', noteColor: '#B42318' },
        { label: 'متوسط عدد المنتجات', value: avgItems.toFixed(1), note: 'لكل طلب', icon: '📦', tint: '#FFF3E3' }
      ]} />
      <BreakdownCard
        title="حسب الحالة"
        rows={statusCounts.map(s => ({
          label: ORDER_STATUS_LABEL[s.status],
          value: String(s.count),
          pct: Math.round((s.count / maxStatusCount) * 100),
          note: orders.length ? `${Math.round((s.count / orders.length) * 100)}% من الطلبات` : '',
          color: ORDER_STATUS_COLOR[s.status][1]
        }))}
      />
    </>
  )
}
