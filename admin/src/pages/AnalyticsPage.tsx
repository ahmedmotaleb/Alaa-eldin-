import { useEffect, useMemo, useState } from 'react'
import { useOutletContext, useParams } from 'react-router-dom'
import { StatsGrid } from '../components/StatsGrid'
import {
  api, ApiError, type AdminCustomer, type AdminCategory, type AdminSupplier,
  type AnalyticsOverview, type AnalyticsSales, type AnalyticsProducts, type AnalyticsRegions, type AnalyticsOrdersBreakdown,
  type AnalyticsRevenueDay, type AnalyticsCategoryRevenue, type RiderPerformance, type PurchasingInventoryAnalytics
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
  const [riders, setRiders] = useState<RiderPerformance[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([
      api.getAnalyticsOverview(), api.getAnalyticsSales(), api.getAnalyticsProducts(),
      api.getAnalyticsRegions(), api.getAnalyticsOrdersBreakdown(), api.listCustomers(), api.getAnalyticsRiders()
    ])
      .then(([overview, sales, products, regions, ordersBreakdown, customersRes, ridersRes]) => {
        setOverview(overview); setSales(sales); setProducts(products)
        setRegions(regions); setOrdersBreakdown(ordersBreakdown); setCustomers(customersRes.customers)
        setRiders(ridersRes.riders)
      })
      .catch(err => setError(err instanceof ApiError ? 'تعذر تحميل بيانات التحليلات' : 'حدث خطأ، حاول مرة أخرى'))
  }, [])

  return { overview, sales, products, regions, ordersBreakdown, customers, riders, error }
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

const PURCHASING_DAY_OPTIONS = [7, 30, 90]

function PercentCell({ value }: { value: number | null }) {
  if (value === null) return <span style={{ color: '#8A948C' }}>—</span>
  return <span style={{ color: value >= 0 ? '#12813C' : '#B42318' }}>{value}%</span>
}

function PurchasingInventoryTab() {
  const [days, setDays] = useState(30)
  const [categoryId, setCategoryId] = useState('')
  const [supplierId, setSupplierId] = useState('')
  const [categories, setCategories] = useState<AdminCategory[]>([])
  const [suppliers, setSuppliers] = useState<AdminSupplier[]>([])
  const [data, setData] = useState<PurchasingInventoryAnalytics | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api.listCategories().then(({ categories }) => setCategories(categories)).catch(() => {})
    api.listSuppliers().then(({ suppliers }) => setSuppliers(suppliers)).catch(() => {})
  }, [])

  useEffect(() => {
    setError('')
    api.getPurchasingInventoryAnalytics({ days, categoryId: categoryId || undefined, supplierId: supplierId || undefined })
      .then(setData)
      .catch(err => setError(err instanceof ApiError ? 'تعذر تحميل التحليلات' : 'حدث خطأ، حاول مرة أخرى'))
  }, [days, categoryId, supplierId])

  if (error) return <div className="admin-placeholder-card"><div className="admin-placeholder-note">{error}</div></div>
  if (!data) return null

  return (
    <>
      <div className="admin-table-tools" style={{ justifyContent: 'flex-start', gap: 8 }}>
        <span className="admin-form-chips">
          {PURCHASING_DAY_OPTIONS.map(d => (
            <button key={d} type="button" className={`admin-form-chip ${days === d ? 'active' : ''}`} onClick={() => setDays(d)}>{d} يوم</button>
          ))}
        </span>
        <select value={categoryId} onChange={e => setCategoryId(e.target.value)}>
          <option value="">كل الأقسام</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={supplierId} onChange={e => setSupplierId(e.target.value)}>
          <option value="">كل الموردين</option>
          {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>

      <StatsGrid stats={[
        { label: 'معدّل دوران المخزون', value: data.turnover.turnoverRatio !== null ? data.turnover.turnoverRatio.toFixed(2) : '—', note: 'تقديري — تكلفة المبيعات ÷ قيمة المخزون الحالية', icon: '🔄', tint: '#EAF2FF' },
        { label: 'متوسط أيام التغطية', value: data.daysOfCoverAverage !== null ? String(data.daysOfCoverAverage) : '—', note: 'للمنتجات اللي ليها مبيعات في الفترة', icon: '📅', tint: '#EAF8EF' },
        { label: 'قيمة منتهية/قريبة الانتهاء', value: formatMoney(data.expiry.expiredValue + data.expiry.nearExpiryValue), note: `منتهية: ${formatMoney(data.expiry.expiredValue)}`, icon: '⛔', tint: '#FFF0EF', noteColor: '#B42318' },
        { label: 'مؤشر مبيعات ضائعة', value: formatMoney(data.lostSales.estimatedValue), note: `${data.lostSales.incidentCount} حالة عدم توفر وقت التجهيز`, icon: '⚠️', tint: '#FFF3E3', noteColor: '#B45309' }
      ]} />

      <div className="admin-placeholder-card">
        <div className="admin-placeholder-note">
          كل الأرقام هنا تقديرات تشغيلية للفترة المختارة ({data.fromDate} إلى {data.toDate})، مش تقييم محاسبي معتمد.
          تكلفة البضاعة المباعة وهامش الربح بيستخدموا تكلفة المنتج الحالية (مش تكلفة تاريخية وقت البيع الفعلي).
        </div>
      </div>

      <div className="admin-table-card">
        <div className="admin-table-scroll">
          <div style={{ minWidth: 640 }}>
            <div className="admin-table-head" style={{ gridTemplateColumns: '2fr .8fr .8fr .8fr' }}>
              <div>راكد (Dead Stock)</div><div>المخزون</div><div>مبيعات/يوم</div><div>أيام تغطية</div>
            </div>
            {data.deadStock.map(r => (
              <div key={r.productId} className="admin-table-row" style={{ gridTemplateColumns: '2fr .8fr .8fr .8fr' }}>
                <div className="admin-cell-plain">{r.name}</div>
                <div className="admin-cell-plain">{r.sellableStock}</div>
                <div className="admin-cell-plain">{r.avgDailySales}</div>
                <div className="admin-cell-plain">{r.daysOfCover ?? '—'}</div>
              </div>
            ))}
            {data.deadStock.length === 0 && <div className="admin-table-empty">مفيش مخزون راكد في هذه الفترة</div>}
          </div>
        </div>
      </div>

      <div className="admin-table-card">
        <div className="admin-table-scroll">
          <div style={{ minWidth: 640 }}>
            <div className="admin-table-head" style={{ gridTemplateColumns: '2fr .8fr .8fr .8fr' }}>
              <div>بطيء الحركة (Slow Stock)</div><div>المخزون</div><div>مبيعات/يوم</div><div>أيام تغطية</div>
            </div>
            {data.slowStock.map(r => (
              <div key={r.productId} className="admin-table-row" style={{ gridTemplateColumns: '2fr .8fr .8fr .8fr' }}>
                <div className="admin-cell-plain">{r.name}</div>
                <div className="admin-cell-plain">{r.sellableStock}</div>
                <div className="admin-cell-plain">{r.avgDailySales}</div>
                <div className="admin-cell-plain">{r.daysOfCover ?? '—'}</div>
              </div>
            ))}
            {data.slowStock.length === 0 && <div className="admin-table-empty">مفيش مخزون بطيء الحركة في هذه الفترة</div>}
          </div>
        </div>
      </div>

      <div className="admin-table-card">
        <div className="admin-table-scroll">
          <div style={{ minWidth: 640 }}>
            <div className="admin-table-head" style={{ gridTemplateColumns: '2fr .8fr .8fr .8fr' }}>
              <div>سريع الحركة (Fast Stock)</div><div>المخزون</div><div>مبيعات/يوم</div><div>أيام تغطية</div>
            </div>
            {data.fastStock.slice(0, 10).map(r => (
              <div key={r.productId} className="admin-table-row" style={{ gridTemplateColumns: '2fr .8fr .8fr .8fr' }}>
                <div className="admin-cell-plain">{r.name}</div>
                <div className="admin-cell-plain">{r.sellableStock}</div>
                <div className="admin-cell-plain">{r.avgDailySales}</div>
                <div className="admin-cell-plain">{r.daysOfCover ?? '—'}</div>
              </div>
            ))}
            {data.fastStock.length === 0 && <div className="admin-table-empty">مفيش مبيعات في هذه الفترة</div>}
          </div>
        </div>
      </div>

      <div className="admin-table-card">
        <div className="admin-table-scroll">
          <div style={{ minWidth: 560 }}>
            <div className="admin-table-head" style={{ gridTemplateColumns: '2fr 1fr' }}>
              <div>تواتر عدم التوفر وقت التجهيز</div><div>عدد المرات</div>
            </div>
            {data.stockouts.byProduct.map(r => (
              <div key={r.productId} className="admin-table-row" style={{ gridTemplateColumns: '2fr 1fr' }}>
                <div className="admin-cell-plain">{r.name}</div>
                <div className="admin-cell-plain" style={{ fontWeight: 800, color: '#B42318' }}>{r.incidentCount}</div>
              </div>
            ))}
            {data.stockouts.byProduct.length === 0 && <div className="admin-table-empty">مفيش حالات عدم توفر مسجّلة</div>}
          </div>
        </div>
      </div>

      <div className="admin-table-card">
        <div className="admin-table-scroll">
          <div style={{ minWidth: 700 }}>
            <div className="admin-table-head" style={{ gridTemplateColumns: '1.6fr 1fr 1fr 1fr' }}>
              <div>المورد</div><div>قيمة المشتريات</div><div>معدّل التنفيذ</div><div>متوسط مهلة التوريد</div>
            </div>
            {data.suppliers.map(s => (
              <div key={s.supplierId} className="admin-table-row" style={{ gridTemplateColumns: '1.6fr 1fr 1fr 1fr' }}>
                <div className="admin-cell-plain" style={{ fontWeight: 700 }}>{s.supplierName}</div>
                <div className="admin-cell-plain">{formatMoney(s.purchaseValue)}</div>
                <div className="admin-cell-plain">{s.fillRatePercent !== null ? `${s.fillRatePercent}%` : '—'}</div>
                <div className="admin-cell-plain">{s.avgLeadTimeDays !== null ? `${s.avgLeadTimeDays} يوم` : '—'}</div>
              </div>
            ))}
            {data.suppliers.length === 0 && <div className="admin-table-empty">لا توجد أوامر شراء في هذه الفترة</div>}
          </div>
        </div>
      </div>

      <div className="admin-table-card">
        <div className="admin-table-scroll">
          <div style={{ minWidth: 640 }}>
            <div className="admin-table-head" style={{ gridTemplateColumns: '2fr 1fr 1fr .8fr' }}>
              <div>تغيّر التكلفة</div><div>الأقدم</div><div>الأحدث</div><div>النسبة</div>
            </div>
            {data.priceChanges.map(r => (
              <div key={r.productId} className="admin-table-row" style={{ gridTemplateColumns: '2fr 1fr 1fr .8fr' }}>
                <div className="admin-cell-plain">{r.name}</div>
                <div className="admin-cell-plain">{formatMoney(r.oldestCost)}</div>
                <div className="admin-cell-plain">{formatMoney(r.newestCost)}</div>
                <div className="admin-cell-plain"><PercentCell value={r.percentChange} /></div>
              </div>
            ))}
            {data.priceChanges.length === 0 && <div className="admin-table-empty">مفيش تغيّر تكلفة مسجّل في هذه الفترة</div>}
          </div>
        </div>
      </div>

      <div className="admin-layout-with-side has-side">
        <div className="admin-table-card">
          <div className="admin-table-scroll">
            <div style={{ minWidth: 480 }}>
              <div className="admin-table-head" style={{ gridTemplateColumns: '2fr .8fr' }}>
                <div>هامش الربح لكل منتج</div><div>الهامش</div>
              </div>
              {data.marginByProduct.slice(0, 15).map(r => (
                <div key={r.productId} className="admin-table-row" style={{ gridTemplateColumns: '2fr .8fr' }}>
                  <div className="admin-cell-plain">{r.name}</div>
                  <div className="admin-cell-plain"><PercentCell value={r.marginPercent} /></div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="admin-side-panels">
          <div className="admin-side-card">
            <div className="admin-side-title">هامش الربح لكل قسم</div>
            {data.marginByCategory.map(r => (
              <div key={r.categoryId} className="admin-breakdown-row">
                <div className="admin-breakdown-head">
                  <span>{r.categoryName}</span>
                  <span style={{ fontWeight: 700 }}><PercentCell value={r.marginPercent} /></span>
                </div>
                <div style={{ fontSize: 10.5, fontWeight: 600, color: '#8A948C' }}>
                  إيراد {formatMoney(r.revenue)} — تكلفة تقديرية {formatMoney(r.approxCogs)}
                </div>
              </div>
            ))}
            {data.marginByCategory.length === 0 && <div style={{ color: '#8A948C', fontSize: 12.5, fontWeight: 600 }}>لا توجد بيانات بعد</div>}
          </div>
        </div>
      </div>
    </>
  )
}

export function AnalyticsPage() {
  const { tab } = useParams()
  const { setHeader } = useOutletContext<LayoutContext>()
  const activeTab = tab && ANALYTICS_NAV.children.find(c => c.id === tab) ? tab : 'overview'
  const tabLabel = ANALYTICS_NAV.children.find(c => c.id === activeTab)?.label ?? 'نظرة عامة'

  useEffect(() => {
    setHeader({ crumb: 'التحليلات', title: tabLabel })
  }, [tabLabel, setHeader])

  if (activeTab === 'inventory-purchasing') return <PurchasingInventoryTab />

  return <AnalyticsMainTabs activeTab={activeTab} />
}

function AnalyticsMainTabs({ activeTab }: { activeTab: string }) {
  const { overview, sales, products, regions, ordersBreakdown, customers, riders, error } = useAnalyticsData()

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

  if (activeTab === 'riders') {
    const totalDelivered = riders.reduce((a, r) => a + r.deliveredCount, 0)
    const totalUnsettled = riders.reduce((a, r) => a + r.unsettledAmount, 0)
    const ridersWithAvg = riders.filter(r => r.avgDeliveryMinutes !== null)
    const overallAvg = ridersWithAvg.length ? ridersWithAvg.reduce((a, r) => a + (r.avgDeliveryMinutes ?? 0), 0) / ridersWithAvg.length : 0

    return (
      <>
        <StatsGrid stats={[
          { label: 'طلبات تم تسليمها', value: String(totalDelivered), note: 'كل المناديب النشطين', icon: '🛵', tint: '#EAF2FF' },
          { label: 'متوسط وقت التوصيل', value: ridersWithAvg.length ? `${Math.round(overallAvg)} دقيقة` : '—', note: 'من خروج المندوب لحد التسليم', icon: '⏱️', tint: '#EAF8EF' },
          { label: 'كاش غير مُسوّى', value: formatMoney(totalUnsettled), note: 'مستحق على المناديب', icon: '💵', tint: '#FFF3E3', noteColor: '#B45309' }
        ]} />
        <div className="admin-table-card">
          <div className="admin-table-scroll">
            <div style={{ minWidth: 640 }}>
              <div className="admin-table-head" style={{ gridTemplateColumns: '1.6fr 1fr 1fr 1fr' }}>
                <div>المندوب</div><div>طلبات مُسلَّمة</div><div>متوسط وقت التوصيل</div><div>كاش غير مُسوّى</div>
              </div>
              {riders.map(r => (
                <div key={r.riderId} className="admin-table-row" style={{ gridTemplateColumns: '1.6fr 1fr 1fr 1fr' }}>
                  <div className="admin-cell-plain" style={{ fontWeight: 800 }}>{r.riderName}</div>
                  <div className="admin-cell-plain">{r.deliveredCount}</div>
                  <div className="admin-cell-plain">{r.avgDeliveryMinutes === null ? '—' : `${Math.round(r.avgDeliveryMinutes)} دقيقة`}</div>
                  <div className="admin-cell-plain" style={{ fontWeight: 800, color: r.unsettledAmount > 0 ? '#B4740E' : '#12813C' }}>{formatMoney(r.unsettledAmount)}</div>
                </div>
              ))}
              {riders.length === 0 && <div className="admin-table-empty">لا يوجد مناديب نشطين بعد</div>}
            </div>
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
