import { useEffect, useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { api, ApiError, type AdminCustomerReturn, type CustomerReturnStatus } from '../utils/api'
import { formatMoney } from '../utils/money'
import type { LayoutContext } from '../components/AdminLayout'

const COLS = '1fr 1fr 1fr 1fr 1fr'

const STATUS_LABEL: Record<CustomerReturnStatus, string> = {
  requested: 'مطلوب', approved: 'تمت الموافقة', received: 'تم الاستلام', refunded: 'تم الاسترداد', rejected: 'مرفوض', cancelled: 'ملغي'
}
const STATUS_TINT: Record<CustomerReturnStatus, { bg: string, fg: string }> = {
  requested: { bg: '#FFF3E3', fg: '#B4740E' },
  approved: { bg: '#EAF2FF', fg: '#1D5BBF' },
  received: { bg: '#EAF2FF', fg: '#1D5BBF' },
  refunded: { bg: '#EAF8EF', fg: '#12813C' },
  rejected: { bg: '#FFF0EF', fg: '#B42318' },
  cancelled: { bg: '#F1F4F2', fg: '#68746B' }
}

export function CustomerReturnsListPage() {
  const navigate = useNavigate()
  const { setHeader } = useOutletContext<LayoutContext>()
  const [returns, setReturns] = useState<AdminCustomerReturn[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    setHeader({ crumb: 'الطلبات', title: 'مرتجعات العملاء', action: { label: 'إنشاء مرتجع', onClick: () => navigate('/orders/returns/new') } })
  }, [setHeader, navigate])

  useEffect(() => {
    api.listCustomerReturns()
      .then(({ returns }) => setReturns(returns))
      .catch(err => setError(err instanceof ApiError ? 'تعذر تحميل المرتجعات' : 'حدث خطأ، حاول مرة أخرى'))
  }, [])

  if (error) return <div className="admin-placeholder-card"><div className="admin-placeholder-note">{error}</div></div>
  if (!returns) return null

  return (
    <div className="admin-table-card">
      <div className="admin-table-scroll">
        <div style={{ minWidth: 700 }}>
          <div className="admin-table-head" style={{ gridTemplateColumns: COLS }}>
            <div>رقم المرتجع</div><div>رقم الطلب</div><div>قيمة الاسترداد</div><div>الحالة</div><div>تاريخ الطلب</div>
          </div>
          {returns.map(r => {
            const tint = STATUS_TINT[r.status]
            return (
              <div key={r.id} className="admin-table-row clickable" style={{ gridTemplateColumns: COLS }} onClick={() => navigate(`/orders/returns/${r.id}`)}>
                <div className="admin-cell-plain" style={{ fontWeight: 900 }}>{r.returnNumber}</div>
                <div className="admin-cell-plain" style={{ color: '#68746B' }}>{r.orderNumber}</div>
                <div className="admin-cell-plain" style={{ fontWeight: 800 }}>{formatMoney(r.refundAmount)}</div>
                <div><span className="admin-pill" style={{ background: tint.bg, color: tint.fg }}>{STATUS_LABEL[r.status]}</span></div>
                <div className="admin-cell-plain" style={{ color: '#8A948C', fontSize: 12 }}>{r.createdAt.slice(0, 10)}</div>
              </div>
            )
          })}
          {returns.length === 0 && <div className="admin-table-empty">مفيش مرتجعات عملاء بعد</div>}
        </div>
      </div>
    </div>
  )
}
