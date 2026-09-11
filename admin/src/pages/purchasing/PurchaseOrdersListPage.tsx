import { useEffect, useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { api, ApiError, type AdminPurchaseOrder, type PurchaseOrderStatus } from '../../utils/api'
import { formatMoney } from '../../utils/money'
import { useDebouncedValue } from '../../utils/useDebouncedValue'
import type { LayoutContext } from '../../components/AdminLayout'

const COLS = '1fr 1.3fr 1fr 1fr 1fr'

const STATUS_LABEL: Record<PurchaseOrderStatus, string> = {
  draft: 'مسودة',
  submitted: 'مُرسل للمورد',
  partially_received: 'استلام جزئي',
  received: 'مكتمل',
  cancelled: 'ملغي'
}

const STATUS_TINT: Record<PurchaseOrderStatus, { bg: string, fg: string }> = {
  draft: { bg: '#F1F4F2', fg: '#68746B' },
  submitted: { bg: '#EAF2FF', fg: '#1D5BBF' },
  partially_received: { bg: '#FFF3E3', fg: '#B4740E' },
  received: { bg: '#EAF8EF', fg: '#12813C' },
  cancelled: { bg: '#FFF0EF', fg: '#B42318' }
}

const TABS: Array<{ id: string, label: string, status?: PurchaseOrderStatus }> = [
  { id: 'all', label: 'الكل' },
  { id: 'draft', label: 'مسودة', status: 'draft' },
  { id: 'submitted', label: 'مُرسلة', status: 'submitted' },
  { id: 'partially_received', label: 'استلام جزئي', status: 'partially_received' },
  { id: 'received', label: 'مكتملة', status: 'received' },
  { id: 'cancelled', label: 'ملغاة', status: 'cancelled' }
]

export function PurchaseOrdersListPage() {
  const navigate = useNavigate()
  const { setHeader } = useOutletContext<LayoutContext>()
  const [orders, setOrders] = useState<AdminPurchaseOrder[] | null>(null)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState('all')
  const debouncedQuery = useDebouncedValue(query)

  useEffect(() => {
    setHeader({ crumb: 'المشتريات', title: 'أوامر الشراء', action: { label: 'إنشاء أمر شراء', onClick: () => navigate('/purchasing/orders/new') } })
  }, [setHeader, navigate])

  useEffect(() => {
    const status = TABS.find(t => t.id === tab)?.status
    api.listPurchaseOrders({ status, search: debouncedQuery.trim() || undefined })
      .then(({ orders }) => setOrders(orders))
      .catch(err => setError(err instanceof ApiError ? 'تعذر تحميل أوامر الشراء' : 'حدث خطأ، حاول مرة أخرى'))
  }, [tab, debouncedQuery])

  if (error) return <div className="admin-placeholder-card"><div className="admin-placeholder-note">{error}</div></div>
  if (!orders) return null

  return (
    <div className="admin-table-card">
      <div className="admin-table-tools" style={{ flexWrap: 'wrap', gap: 10 }}>
        <span className="admin-form-chips">
          {TABS.map(t => (
            <button key={t.id} type="button" className={`admin-form-chip ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>{t.label}</button>
          ))}
        </span>
        <div className="admin-search">
          <span style={{ color: '#8A948C', fontSize: 13 }}>🔎</span>
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="ابحث برقم أمر الشراء..." />
        </div>
      </div>
      <div className="admin-table-scroll">
        <div style={{ minWidth: 780 }}>
          <div className="admin-table-head" style={{ gridTemplateColumns: COLS }}>
            <div>رقم الأمر</div><div>المورد</div><div>الإجمالي</div><div>الحالة</div><div>تاريخ الإنشاء</div>
          </div>
          {orders.map(o => {
            const tint = STATUS_TINT[o.status]
            return (
              <div key={o.id} className="admin-table-row clickable" style={{ gridTemplateColumns: COLS }} onClick={() => navigate(`/purchasing/orders/edit/${o.id}`)}>
                <div className="admin-cell-plain" style={{ fontWeight: 900 }}>{o.poNumber}</div>
                <div className="admin-cell-plain" style={{ color: '#68746B' }}>{o.supplierName}</div>
                <div className="admin-cell-plain" style={{ fontWeight: 800 }}>{formatMoney(o.total)}</div>
                <div><span className="admin-pill" style={{ background: tint.bg, color: tint.fg }}>{STATUS_LABEL[o.status]}</span></div>
                <div className="admin-cell-plain" style={{ color: '#8A948C', fontSize: 12 }}>{o.createdAt.slice(0, 10)}</div>
              </div>
            )
          })}
          {orders.length === 0 && <div className="admin-table-empty">مفيش أوامر شراء بعد</div>}
        </div>
      </div>
    </div>
  )
}
