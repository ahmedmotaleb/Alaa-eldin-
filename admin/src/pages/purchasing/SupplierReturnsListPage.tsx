import { useEffect, useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { api, ApiError, type AdminSupplierReturn, type SupplierReturnStatus } from '../../utils/api'
import type { LayoutContext } from '../../components/AdminLayout'

const COLS = '1fr 1.3fr 1fr 1fr'

const STATUS_LABEL: Record<SupplierReturnStatus, string> = {
  draft: 'مسودة', approved: 'تمت الموافقة', sent: 'تم الإرسال', completed: 'مكتمل', cancelled: 'ملغي'
}
const STATUS_TINT: Record<SupplierReturnStatus, { bg: string, fg: string }> = {
  draft: { bg: '#F1F4F2', fg: '#68746B' },
  approved: { bg: '#EAF2FF', fg: '#1D5BBF' },
  sent: { bg: '#FFF3E3', fg: '#B4740E' },
  completed: { bg: '#EAF8EF', fg: '#12813C' },
  cancelled: { bg: '#FFF0EF', fg: '#B42318' }
}

export function SupplierReturnsListPage() {
  const navigate = useNavigate()
  const { setHeader } = useOutletContext<LayoutContext>()
  const [returns, setReturns] = useState<AdminSupplierReturn[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    setHeader({ crumb: 'المشتريات', title: 'مرتجعات الموردين', action: { label: 'إنشاء مرتجع', onClick: () => navigate('/purchasing/supplier-returns/new') } })
  }, [setHeader, navigate])

  useEffect(() => {
    api.listSupplierReturns()
      .then(({ returns }) => setReturns(returns))
      .catch(err => setError(err instanceof ApiError ? 'تعذر تحميل المرتجعات' : 'حدث خطأ، حاول مرة أخرى'))
  }, [])

  if (error) return <div className="admin-placeholder-card"><div className="admin-placeholder-note">{error}</div></div>
  if (!returns) return null

  return (
    <div className="admin-table-card">
      <div className="admin-table-scroll">
        <div style={{ minWidth: 640 }}>
          <div className="admin-table-head" style={{ gridTemplateColumns: COLS }}>
            <div>رقم المرتجع</div><div>المورد</div><div>الحالة</div><div>تاريخ الإنشاء</div>
          </div>
          {returns.map(r => {
            const tint = STATUS_TINT[r.status]
            return (
              <div key={r.id} className="admin-table-row clickable" style={{ gridTemplateColumns: COLS }} onClick={() => navigate(`/purchasing/supplier-returns/${r.id}`)}>
                <div className="admin-cell-plain" style={{ fontWeight: 900 }}>{r.returnNumber}</div>
                <div className="admin-cell-plain" style={{ color: '#68746B' }}>{r.supplierName}</div>
                <div><span className="admin-pill" style={{ background: tint.bg, color: tint.fg }}>{STATUS_LABEL[r.status]}</span></div>
                <div className="admin-cell-plain" style={{ color: '#8A948C', fontSize: 12 }}>{r.createdAt.slice(0, 10)}</div>
              </div>
            )
          })}
          {returns.length === 0 && <div className="admin-table-empty">مفيش مرتجعات موردين بعد</div>}
        </div>
      </div>
    </div>
  )
}
