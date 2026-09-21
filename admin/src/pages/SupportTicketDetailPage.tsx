import { useEffect, useState } from 'react'
import { useNavigate, useOutletContext, useParams } from 'react-router-dom'
import { api, ApiError, type AdminSupportTicketDetail, type AdminSupportTicketMessage } from '../utils/api'
import { formatDateTime } from '../utils/format'
import {
  TICKET_STATUS_LABEL, TICKET_STATUS_COLOR, TICKET_STATUS_ORDER,
  TICKET_PRIORITY_LABEL, TICKET_PRIORITY_ORDER, TICKET_CATEGORY_LABEL,
  type TicketStatus, type TicketPriority, type TicketCategory
} from '../supportTicket'
import type { LayoutContext } from '../components/AdminLayout'

export function SupportTicketDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { setHeader } = useOutletContext<LayoutContext>()

  const [detail, setDetail] = useState<AdminSupportTicketDetail | null>(null)
  const [staff, setStaff] = useState<{ id: string, fullName: string, email: string }[]>([])
  const [error, setError] = useState('')
  const [replyMessage, setReplyMessage] = useState('')
  const [internalNote, setInternalNote] = useState(false)
  const [sending, setSending] = useState(false)
  const [actionError, setActionError] = useState('')

  function load() {
    if (!id) return
    api.getSupportTicket(id)
      .then(setDetail)
      .catch(err => setError(err instanceof ApiError ? 'تعذر تحميل التذكرة' : 'حدث خطأ، حاول مرة أخرى'))
  }

  useEffect(load, [id])
  useEffect(() => { api.listAssignableSupportStaff().then(({ staff }) => setStaff(staff)).catch(() => {}) }, [])

  useEffect(() => {
    setHeader({ crumb: 'خدمة العملاء', title: detail ? `تذكرة ${detail.ticket.ticketNumber}` : 'تذكرة دعم' })
  }, [setHeader, detail])

  async function sendReply() {
    if (!id || !replyMessage.trim()) return
    setSending(true)
    setActionError('')
    try {
      await api.replyToSupportTicket(id, replyMessage.trim(), internalNote)
      setReplyMessage('')
      setInternalNote(false)
      load()
    } catch {
      setActionError('تعذر إرسال الرد')
    } finally {
      setSending(false)
    }
  }

  async function changeStatus(status: TicketStatus) {
    if (!id) return
    try {
      await api.updateSupportTicketStatus(id, status)
      load()
    } catch {
      window.alert('تعذر تحديث الحالة')
    }
  }

  async function changePriority(priority: TicketPriority) {
    if (!id) return
    try {
      await api.updateSupportTicketPriority(id, priority)
      load()
    } catch {
      window.alert('تعذر تحديث الأولوية')
    }
  }

  async function changeAssignee(assigneeId: string) {
    if (!id) return
    try {
      await api.assignSupportTicket(id, assigneeId || null)
      load()
    } catch {
      window.alert('تعذر تحديث التعيين')
    }
  }

  if (error) return <div className="admin-placeholder-card"><div className="admin-placeholder-note">{error}</div></div>
  if (!detail) return null

  const { ticket, customer, messages } = detail
  const statusTint = TICKET_STATUS_COLOR[ticket.status as TicketStatus]

  return (
    <div className="admin-form-grid" style={{ gridTemplateColumns: '2fr 1fr', alignItems: 'start' }}>
      <div className="admin-form-card">
        <div>
          <div className="admin-form-card-title">المحادثة</div>
          <div className="admin-form-card-sub">{TICKET_CATEGORY_LABEL[ticket.category as TicketCategory] ?? ticket.category} — {ticket.subject}</div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 480, overflowY: 'auto' }}>
          {messages.map((m: AdminSupportTicketMessage) => (
            <div
              key={m.id}
              style={{
                alignSelf: m.senderType === 'admin' ? 'flex-end' : 'flex-start',
                maxWidth: '85%',
                background: m.internalNote ? '#FFF3E3' : m.senderType === 'admin' ? '#EAF8EF' : '#F1F4F2',
                border: m.internalNote ? '1px dashed #B4740E' : '1px solid transparent',
                borderRadius: 12, padding: '10px 12px'
              }}
            >
              {m.internalNote && <div style={{ fontSize: 11, fontWeight: 800, color: '#B4740E', marginBottom: 4 }}>ملاحظة داخلية (مش ظاهرة للعميل)</div>}
              <div style={{ whiteSpace: 'pre-wrap', fontSize: 13.5 }}>{m.message}</div>
              {m.attachments.length > 0 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                  {m.attachments.map(a => (
                    <a key={a.id} href={a.fileUrl} target="_blank" rel="noreferrer">
                      <img src={a.fileUrl} alt="مرفق" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 8, border: '1px solid #dce4de' }} />
                    </a>
                  ))}
                </div>
              )}
              <div style={{ fontSize: 11, color: '#8A948C', marginTop: 6 }}>
                {m.senderType === 'admin' ? 'فريق الدعم' : 'العميل'} · {formatDateTime(m.createdAt)}
              </div>
            </div>
          ))}
        </div>

        {ticket.status === 'closed' ? (
          <div className="admin-form-help">التذكرة مغلقة — غيّر الحالة أولاً لو حابب ترد.</div>
        ) : (
          <>
            <label>الرد
              <textarea value={replyMessage} onChange={e => setReplyMessage(e.target.value)} rows={3} placeholder="اكتب ردك هنا..." />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}>
              <input type="checkbox" checked={internalNote} onChange={e => setInternalNote(e.target.checked)} style={{ width: 'auto' }} />
              ملاحظة داخلية (لن يراها العميل)
            </label>
            <button className="admin-form-save" disabled={sending || !replyMessage.trim()} onClick={sendReply}>
              {internalNote ? 'إضافة ملاحظة داخلية' : 'إرسال الرد'}
            </button>
          </>
        )}
        {actionError && <div className="admin-form-error">{actionError}</div>}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="admin-form-card">
          <div className="admin-form-card-title">العميل</div>
          <div className="admin-form-help">
            <a onClick={() => navigate(`/customers/${customer.id}`)} style={{ cursor: 'pointer', fontWeight: 800 }}>{customer.fullName}</a>
          </div>
          <div className="admin-form-help">{customer.email}</div>
          {customer.mobile && <div className="admin-form-help">{customer.mobile}</div>}
          {ticket.relatedOrderNumber && (
            <div className="admin-form-help">
              الطلب المرتبط: <a onClick={() => navigate(`/orders/all?highlight=${ticket.relatedOrderId}`)} style={{ cursor: 'pointer', fontWeight: 800 }}>{ticket.relatedOrderNumber}</a>
            </div>
          )}
        </div>

        <div className="admin-form-card">
          <div className="admin-form-card-title">الحالة والأولوية</div>
          <div><span className="admin-pill" style={{ background: statusTint?.[0], color: statusTint?.[1] }}>{TICKET_STATUS_LABEL[ticket.status as TicketStatus] ?? ticket.status}</span></div>
          <label>تغيير الحالة
            <select value={ticket.status} onChange={e => changeStatus(e.target.value as TicketStatus)}>
              {TICKET_STATUS_ORDER.map(s => <option key={s} value={s}>{TICKET_STATUS_LABEL[s]}</option>)}
            </select>
          </label>
          <label>الأولوية
            <select value={ticket.priority} onChange={e => changePriority(e.target.value as TicketPriority)}>
              {TICKET_PRIORITY_ORDER.map(p => <option key={p} value={p}>{TICKET_PRIORITY_LABEL[p]}</option>)}
            </select>
          </label>
        </div>

        <div className="admin-form-card">
          <div className="admin-form-card-title">التعيين</div>
          <label>مُعيَّنة إلى
            <select value={ticket.assignedAdminId ?? ''} onChange={e => changeAssignee(e.target.value)}>
              <option value="">غير معيَّنة</option>
              {staff.map(s => <option key={s.id} value={s.id}>{s.fullName}</option>)}
            </select>
          </label>
        </div>

        <div className="admin-form-card">
          <div className="admin-form-card-title">الجدول الزمني</div>
          <div className="admin-form-help">أُنشئت: {formatDateTime(ticket.createdAt)}</div>
          <div className="admin-form-help">آخر تحديث: {formatDateTime(ticket.updatedAt)}</div>
          {ticket.resolvedAt && <div className="admin-form-help">تم الحل: {formatDateTime(ticket.resolvedAt)}</div>}
        </div>
      </div>
    </div>
  )
}
