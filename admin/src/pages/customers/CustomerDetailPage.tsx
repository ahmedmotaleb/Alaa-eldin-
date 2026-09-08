import { useEffect, useState } from 'react'
import { useOutletContext, useParams } from 'react-router-dom'
import { StatsGrid } from '../../components/StatsGrid'
import { api, ApiError, type AdminCustomer, type AdminCustomerOrder } from '../../utils/api'
import { formatMoney } from '../../utils/money'
import { formatDate } from '../../utils/format'
import { ORDER_STATUS_COLOR, ORDER_STATUS_LABEL } from '../../orderStatus'
import type { LayoutContext } from '../../components/AdminLayout'

const COLS = '1.2fr 1fr 1fr 1fr'

export function CustomerDetailPage() {
  const { id } = useParams()
  const { setHeader } = useOutletContext<LayoutContext>()
  const [customer, setCustomer] = useState<AdminCustomer | null>(null)
  const [orders, setOrders] = useState<AdminCustomerOrder[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    setHeader({ crumb: 'العملاء', title: 'ملف العميل' })
  }, [setHeader])

  useEffect(() => {
    if (!id) return
    api.getCustomer(id)
      .then(({ customer, orders }) => { setCustomer(customer); setOrders(orders) })
      .catch(err => setError(err instanceof ApiError && err.status === 404 ? 'العميل غير موجود' : 'تعذر تحميل بيانات العميل'))
  }, [id])

  useEffect(() => {
    if (customer) setHeader({ crumb: 'العملاء', title: customer.fullName })
  }, [customer, setHeader])

  if (error) return <div className="admin-placeholder-card"><div className="admin-placeholder-note">{error}</div></div>
  if (!customer) return null

  return (
    <>
      <div className="admin-form-card" style={{ marginBottom: 16 }}>
        <div className="admin-form-card-title">{customer.fullName}</div>
        <div className="admin-form-card-sub">{customer.email}{customer.lastMobile ? ` · ${customer.lastMobile}` : ''}</div>
        <div className="admin-cell-plain" style={{ color: '#68746B' }}>
          عضو منذ {formatDate(customer.createdAt)}
        </div>
      </div>

      <StatsGrid stats={[
        { label: 'عدد الطلبات', value: String(customer.orderCount), note: 'منذ التسجيل', icon: '🧾', tint: '#EAF2FF' },
        { label: 'إجمالي الإنفاق', value: formatMoney(customer.totalSpent), note: 'كل الطلبات', icon: '💰', tint: '#EAF8EF' },
        { label: 'متوسط الطلب', value: formatMoney(customer.orderCount ? customer.totalSpent / customer.orderCount : 0), note: 'لكل طلب', icon: '🛒', tint: '#FFF3E3' }
      ]} />

      <div className="admin-table-card">
        <div className="admin-table-scroll">
          <div style={{ minWidth: 560 }}>
            <div className="admin-table-head" style={{ gridTemplateColumns: COLS }}>
              <div>رقم الطلب</div><div>التاريخ</div><div>الإجمالي</div><div>الحالة</div>
            </div>
            {orders.map(o => {
              const [bg, fg] = ORDER_STATUS_COLOR[o.status]
              return (
                <div key={o.id} className="admin-table-row" style={{ gridTemplateColumns: COLS }}>
                  <div className="admin-cell-plain" style={{ fontWeight: 900 }}>{o.id}</div>
                  <div className="admin-cell-plain" style={{ color: '#68746B' }}>{formatDate(o.createdAt)}</div>
                  <div className="admin-cell-plain" style={{ fontWeight: 800, color: '#12813C' }}>{formatMoney(o.total)}</div>
                  <div><span className="admin-pill" style={{ background: bg, color: fg }}>{ORDER_STATUS_LABEL[o.status]}</span></div>
                </div>
              )
            })}
            {orders.length === 0 && <div className="admin-table-empty">لا يوجد طلبات لهذا العميل بعد</div>}
          </div>
        </div>
        <div className="admin-table-footer">
          <span>{orders.length} طلب</span>
          <span>سجل طلبات العميل الكامل</span>
        </div>
      </div>
    </>
  )
}
