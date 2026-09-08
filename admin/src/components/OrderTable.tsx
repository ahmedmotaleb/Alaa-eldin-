import type { ReactNode } from 'react'
import type { AdminOrder } from '../utils/api'
import { formatMoney } from '../utils/money'
import { ORDER_STATUS_COLOR, ORDER_STATUS_LABEL } from '../orderStatus'

const COLS = '.85fr 1.1fr 1.3fr .8fr .9fr .9fr 1fr'

function relativeTime(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.round(diffMs / 60000)
  if (mins < 1) return 'الآن'
  if (mins < 60) return `من ${mins} دقيقة`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `من ${hours} ساعة`
  return new Date(iso).toLocaleDateString('ar-EG')
}

export function OrderTable({
  orders,
  onRowClick,
  emptyNote = 'مفيش بيانات في هذا العرض',
  footer,
  toolbar
}: {
  orders: AdminOrder[]
  onRowClick: (order: AdminOrder) => void
  emptyNote?: string
  footer?: string
  toolbar?: ReactNode
}) {
  return (
    <div className="admin-table-card">
      {toolbar && <div className="admin-table-tools">{toolbar}</div>}
      <div className="admin-table-scroll">
        <div style={{ minWidth: 760 }}>
          <div className="admin-table-head" style={{ gridTemplateColumns: COLS }}>
            <div>رقم الطلب</div>
            <div>العميل</div>
            <div>العنوان</div>
            <div>المنتجات</div>
            <div>الإجمالي</div>
            <div>الوقت</div>
            <div>الحالة</div>
          </div>
          {orders.map(order => {
            const [bg, fg] = ORDER_STATUS_COLOR[order.status]
            return (
              <div
                key={order.id}
                className="admin-table-row clickable"
                style={{ gridTemplateColumns: COLS }}
                onClick={() => onRowClick(order)}
              >
                <div className="admin-cell-plain" style={{ fontWeight: 900 }}>{order.id}</div>
                <div className="admin-cell-plain">{order.customer.fullName}</div>
                <div className="admin-cell-plain" style={{ color: '#68746B' }}>{order.customer.address}</div>
                <div className="admin-cell-plain" style={{ color: '#68746B' }}>{order.items.length} منتج</div>
                <div className="admin-cell-plain" style={{ fontWeight: 900, color: '#12813C' }}>{formatMoney(order.total)}</div>
                <div className="admin-cell-plain" style={{ color: '#8A948C' }}>{relativeTime(order.createdAt)}</div>
                <div><span className="admin-pill" style={{ background: bg, color: fg }}>{ORDER_STATUS_LABEL[order.status]}</span></div>
              </div>
            )
          })}
          {orders.length === 0 && <div className="admin-table-empty">{emptyNote}</div>}
        </div>
      </div>
      <div className="admin-table-footer">
        <span>{orders.length} طلب</span>
        <span>{footer ?? 'اضغط على أي طلب لعرض التفاصيل والإجراءات'}</span>
      </div>
    </div>
  )
}
