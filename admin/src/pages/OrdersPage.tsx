import { useEffect, useMemo, useState } from 'react'
import { useOutletContext, useParams } from 'react-router-dom'
import { OrderTable } from '../components/OrderTable'
import { OrderDrawer } from '../components/OrderDrawer'
import { StatsGrid } from '../components/StatsGrid'
import { api, ApiError, type AdminOrder, type AdminOrderStatus, type AdminRider } from '../utils/api'
import { formatMoney } from '../utils/money'
import { ORDER_TAB_STATUS, NAV } from '../nav'
import type { LayoutContext } from '../components/AdminLayout'

const ORDERS_NAV = NAV.find(g => g.id === 'orders')!

export function OrdersPage() {
  const { tab } = useParams()
  const { setHeader } = useOutletContext<LayoutContext>()
  const [orders, setOrders] = useState<AdminOrder[] | null>(null)
  const [riders, setRiders] = useState<AdminRider[]>([])
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<AdminOrder | null>(null)

  const activeTab = tab && ORDER_TAB_STATUS[tab] !== undefined ? tab : 'all'
  const tabLabel = ORDERS_NAV.children.find(c => c.id === activeTab)?.label ?? 'جميع الطلبات'
  const targetStatus = ORDER_TAB_STATUS[activeTab] ?? undefined

  function load() {
    api.listOrders()
      .then(({ orders }) => setOrders(orders))
      .catch(err => setError(err instanceof ApiError ? 'تعذر تحميل الطلبات' : 'حدث خطأ، حاول مرة أخرى'))
  }

  useEffect(() => { load() }, [])
  useEffect(() => { api.listRiders().then(({ riders }) => setRiders(riders)).catch(() => {}) }, [])

  useEffect(() => {
    setHeader({ crumb: 'الطلبات', title: activeTab === 'all' ? 'جميع الطلبات' : tabLabel })
  }, [activeTab, tabLabel, setHeader])

  const filtered = useMemo(() => {
    if (!orders) return []
    let list = orders
    if (targetStatus) list = list.filter(o => o.status === targetStatus)
    const q = query.trim()
    if (q) list = list.filter(o => o.id.includes(q) || o.customer.fullName.includes(q) || o.customer.mobile.includes(q))
    return list
  }, [orders, activeTab, targetStatus, query])

  const revenue = filtered.reduce((sum, o) => sum + o.total, 0)

  async function setStatus(order: AdminOrder, status: AdminOrderStatus) {
    setOrders(current => current?.map(o => o.id === order.id ? { ...o, status } : o) ?? current)
    setSelected(current => current && current.id === order.id ? { ...current, status } : current)
    try {
      await api.updateOrderStatus(order.id, status)
    } catch {
      // السيرفر رفض الانتقال (زي تعارض من تحديث متزامن من مدير تاني) — نرجّع القائمة
      // لحالتها الحقيقية من السيرفر، ونوضّح للمستخدم إن التحديث ما اتحفظش.
      load()
      window.alert('تعذر تحديث حالة الطلب — من المحتمل إن حد تاني حدّثها في نفس الوقت. جرّب تاني.')
    }
  }

  async function setRider(order: AdminOrder, riderId: string | null) {
    const riderName = riderId ? riders.find(r => r.id === riderId)?.name ?? null : null
    setOrders(current => current?.map(o => o.id === order.id ? { ...o, riderId, riderName } : o) ?? current)
    setSelected(current => current && current.id === order.id ? { ...current, riderId, riderName } : current)
    try {
      await api.setOrderRider(order.id, riderId)
    } catch {
      load()
    }
  }

  if (error) return <div className="admin-placeholder-card"><div className="admin-placeholder-note">{error}</div></div>
  if (!orders) return null

  return (
    <>
      <StatsGrid stats={[
        { label: 'عدد الطلبات', value: String(filtered.length), note: 'في هذا العرض', icon: '🧾', tint: '#EAF2FF' },
        { label: 'إجمالي القيمة', value: formatMoney(revenue), note: 'قبل المصروفات', icon: '💰', tint: '#EAF8EF' },
        { label: 'متوسط الطلب', value: formatMoney(filtered.length ? revenue / filtered.length : 0), note: 'لهذا الفلتر', icon: '🛒', tint: '#FFF3E3' }
      ]} />

      <OrderTable
        orders={filtered}
        onRowClick={setSelected}
        toolbar={
          <div className="admin-search">
            <span style={{ color: '#8A948C', fontSize: 13 }}>🔎</span>
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="ابحث برقم الطلب أو اسم العميل أو الهاتف..." />
          </div>
        }
      />

      {selected && (
        <OrderDrawer
          order={selected}
          onClose={() => setSelected(null)}
          onSetStatus={status => setStatus(selected, status)}
          riders={riders}
          onSetRider={riderId => setRider(selected, riderId)}
        />
      )}
    </>
  )
}
