import { useEffect, useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { api, ApiError, type AdminSupportTicket } from '../utils/api'
import { formatDate } from '../utils/format'
import { useDebouncedValue } from '../utils/useDebouncedValue'
import {
  TICKET_STATUS_LABEL, TICKET_STATUS_COLOR, TICKET_STATUS_ORDER,
  TICKET_PRIORITY_LABEL, TICKET_PRIORITY_ORDER,
  TICKET_CATEGORY_LABEL, TICKET_CATEGORY_ORDER,
  type TicketStatus, type TicketPriority, type TicketCategory
} from '../supportTicket'
import type { LayoutContext } from '../components/AdminLayout'

const COLS = '1fr 1.4fr 1fr 1fr 1fr 1fr'
const LIMIT = 20

const STATUS_TABS: Array<{ id: string, label: string, status?: TicketStatus }> = [
  { id: 'all', label: 'الكل' },
  ...TICKET_STATUS_ORDER.map(s => ({ id: s, label: TICKET_STATUS_LABEL[s], status: s }))
]

export function SupportTicketsListPage() {
  const navigate = useNavigate()
  const { setHeader } = useOutletContext<LayoutContext>()
  const [tickets, setTickets] = useState<AdminSupportTicket[] | null>(null)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [statusTab, setStatusTab] = useState('all')
  const [priority, setPriority] = useState('')
  const [category, setCategory] = useState('')
  const debouncedQuery = useDebouncedValue(query)

  useEffect(() => {
    setHeader({ crumb: 'خدمة العملاء', title: 'تذاكر الدعم' })
  }, [setHeader])

  useEffect(() => { setPage(1) }, [debouncedQuery, statusTab, priority, category])

  useEffect(() => {
    const status = STATUS_TABS.find(t => t.id === statusTab)?.status
    api.listSupportTickets({
      page, limit: LIMIT, status, priority: priority || undefined, category: category || undefined,
      search: debouncedQuery.trim() || undefined
    })
      .then(({ tickets, pagination }) => {
        setTickets(tickets)
        setTotalPages(pagination.pages)
        setTotal(pagination.total)
      })
      .catch(err => setError(err instanceof ApiError ? 'تعذر تحميل تذاكر الدعم' : 'حدث خطأ، حاول مرة أخرى'))
  }, [page, statusTab, priority, category, debouncedQuery])

  if (error) return <div className="admin-placeholder-card"><div className="admin-placeholder-note">{error}</div></div>
  if (!tickets) return null

  return (
    <div className="admin-table-card">
      <div className="admin-table-tools" style={{ flexWrap: 'wrap', gap: 10 }}>
        <span className="admin-form-chips">
          {STATUS_TABS.map(t => (
            <button key={t.id} type="button" className={`admin-form-chip ${statusTab === t.id ? 'active' : ''}`} onClick={() => setStatusTab(t.id)}>{t.label}</button>
          ))}
        </span>
        <select value={priority} onChange={e => setPriority(e.target.value)} className="admin-form-select">
          <option value="">كل الأولويات</option>
          {TICKET_PRIORITY_ORDER.map(p => <option key={p} value={p}>{TICKET_PRIORITY_LABEL[p as TicketPriority]}</option>)}
        </select>
        <select value={category} onChange={e => setCategory(e.target.value)} className="admin-form-select">
          <option value="">كل الفئات</option>
          {TICKET_CATEGORY_ORDER.map(c => <option key={c} value={c}>{TICKET_CATEGORY_LABEL[c as TicketCategory]}</option>)}
        </select>
        <div className="admin-search">
          <span style={{ color: '#8A948C', fontSize: 13 }}>🔎</span>
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="ابحث برقم التذكرة أو اسم العميل أو الهاتف أو رقم الطلب..." />
        </div>
      </div>
      <div className="admin-table-scroll">
        <div style={{ minWidth: 820 }}>
          <div className="admin-table-head" style={{ gridTemplateColumns: COLS }}>
            <div>رقم التذكرة</div><div>الفئة</div><div>الطلب المرتبط</div><div>الحالة</div><div>الأولوية</div><div>آخر تحديث</div>
          </div>
          {tickets.map(t => {
            const statusTint = TICKET_STATUS_COLOR[t.status as TicketStatus]
            return (
              <div key={t.id} className="admin-table-row clickable" style={{ gridTemplateColumns: COLS }} onClick={() => navigate(`/support/tickets/${t.id}`)}>
                <div className="admin-cell-plain" style={{ fontWeight: 900 }}>{t.ticketNumber}</div>
                <div className="admin-cell-plain" style={{ color: '#68746B' }}>{TICKET_CATEGORY_LABEL[t.category as TicketCategory] ?? t.category}</div>
                <div className="admin-cell-plain" style={{ color: '#68746B' }}>{t.relatedOrderNumber ?? '—'}</div>
                <div><span className="admin-pill" style={{ background: statusTint?.[0], color: statusTint?.[1] }}>{TICKET_STATUS_LABEL[t.status as TicketStatus] ?? t.status}</span></div>
                <div className="admin-cell-plain" style={{ fontWeight: 700 }}>{TICKET_PRIORITY_LABEL[t.priority as TicketPriority] ?? t.priority}</div>
                <div className="admin-cell-plain" style={{ color: '#8A948C', fontSize: 12 }}>{formatDate(t.updatedAt)}</div>
              </div>
            )
          })}
          {tickets.length === 0 && <div className="admin-table-empty">مفيش تذاكر دعم مطابقة</div>}
        </div>
      </div>
      <div className="admin-table-footer">
        <span>{total} تذكرة</span>
        <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span>صفحة {page} من {totalPages}</span>
          <button className="admin-form-chip" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>السابق</button>
          <button className="admin-form-chip" disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>التالي</button>
        </span>
      </div>
    </div>
  )
}
