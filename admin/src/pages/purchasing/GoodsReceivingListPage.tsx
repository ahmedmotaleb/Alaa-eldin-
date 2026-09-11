import { useEffect, useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { api, ApiError, type AdminPurchaseOrder } from '../../utils/api'
import { formatMoney } from '../../utils/money'
import type { LayoutContext } from '../../components/AdminLayout'

const COLS = '1fr 1.3fr 1fr 1fr'

export function GoodsReceivingListPage() {
  const navigate = useNavigate()
  const { setHeader } = useOutletContext<LayoutContext>()
  const [orders, setOrders] = useState<AdminPurchaseOrder[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    setHeader({ crumb: 'المشتريات', title: 'استلام بضاعة' })
  }, [setHeader])

  useEffect(() => {
    Promise.all([
      api.listPurchaseOrders({ status: 'submitted' }),
      api.listPurchaseOrders({ status: 'partially_received' })
    ])
      .then(([submitted, partial]) => setOrders([...submitted.orders, ...partial.orders]))
      .catch(err => setError(err instanceof ApiError ? 'تعذر تحميل أوامر الشراء' : 'حدث خطأ، حاول مرة أخرى'))
  }, [])

  if (error) return <div className="admin-placeholder-card"><div className="admin-placeholder-note">{error}</div></div>
  if (!orders) return null

  return (
    <div className="admin-table-card">
      <div className="admin-table-scroll">
        <div style={{ minWidth: 640 }}>
          <div className="admin-table-head" style={{ gridTemplateColumns: COLS }}>
            <div>رقم الأمر</div><div>المورد</div><div>الإجمالي</div><div>الحالة</div>
          </div>
          {orders.map(o => (
            <div key={o.id} className="admin-table-row clickable" style={{ gridTemplateColumns: COLS }} onClick={() => navigate(`/purchasing/receiving/${o.id}`)}>
              <div className="admin-cell-plain" style={{ fontWeight: 900 }}>{o.poNumber}</div>
              <div className="admin-cell-plain" style={{ color: '#68746B' }}>{o.supplierName}</div>
              <div className="admin-cell-plain" style={{ fontWeight: 800 }}>{formatMoney(o.total)}</div>
              <div className="admin-cell-plain" style={{ color: '#68746B' }}>{o.status === 'submitted' ? 'مُرسل للمورد' : 'استلام جزئي'}</div>
            </div>
          ))}
          {orders.length === 0 && <div className="admin-table-empty">مفيش أوامر شراء في انتظار الاستلام</div>}
        </div>
      </div>
    </div>
  )
}
