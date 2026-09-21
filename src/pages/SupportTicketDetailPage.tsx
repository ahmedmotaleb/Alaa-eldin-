import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useRequireAuth } from '../hooks/useRequireAuth'
import { api, ApiError, type ApiSupportMessage, type ApiSupportTicketDetail } from '../utils/api'
import { formatDateTime } from '../utils/format'
import { ar } from '../i18n/ar'

const MAX_ATTACHMENTS = 3

export function SupportTicketDetailPage() {
  const { id } = useParams()
  const { user, loading: authLoading } = useRequireAuth()
  const [detail, setDetail] = useState<ApiSupportTicketDetail | null>(null)
  const [error, setError] = useState('')
  const [reply, setReply] = useState('')
  const [attachments, setAttachments] = useState<File[]>([])
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')

  function load() {
    if (!id || !user) return
    api.getSupportTicket(id)
      .then(setDetail)
      .catch(err => setError(err instanceof ApiError ? ar.errors.forCode(err.code) : ar.errors.generic))
  }

  useEffect(load, [id, user])

  async function sendReply() {
    if (!id || !reply.trim()) return
    setSending(true)
    setSendError('')
    try {
      await api.replyToSupportTicket(id, reply.trim(), attachments)
      setReply('')
      setAttachments([])
      load()
    } catch (err) {
      setSendError(err instanceof ApiError ? ar.errors.forCode(err.code) : ar.errors.generic)
    } finally {
      setSending(false)
    }
  }

  if (authLoading || (user && !detail && !error)) return null
  if (error) return <div className="empty-card">{error}</div>
  if (!detail) return null

  const { ticket, messages } = detail

  return (
    <div className="form-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong>{ticket.ticketNumber}</strong>
        <span className={`order-status-badge ${ticket.status === 'resolved' || ticket.status === 'closed' ? 'delivered' : 'active'}`}>
          {ar.support.statusLabels[ticket.status] ?? ticket.status}
        </span>
      </div>
      <div className="admin-form-help">{ar.support.categories[ticket.category] ?? ticket.category} — {ticket.subject}</div>
      {ticket.relatedOrderNumber && <div className="admin-form-help">{ar.support.relatedOrderPrefix} {ticket.relatedOrderNumber}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 420, overflowY: 'auto' }}>
        {messages.map((m: ApiSupportMessage) => (
          <div
            key={m.id}
            style={{
              alignSelf: m.senderType === 'admin' ? 'flex-start' : 'flex-end',
              maxWidth: '85%',
              background: m.senderType === 'admin' ? '#F1F4F2' : '#EAF8EF',
              borderRadius: 12, padding: '10px 12px'
            }}
          >
            <div style={{ whiteSpace: 'pre-wrap', fontSize: 13.5 }}>{m.message}</div>
            {m.attachments.length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                {m.attachments.map(a => (
                  <a key={a.id} href={a.fileUrl} target="_blank" rel="noreferrer">
                    <img src={a.fileUrl} alt="مرفق" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 8 }} />
                  </a>
                ))}
              </div>
            )}
            <div style={{ fontSize: 11, color: '#8A948C', marginTop: 6 }}>
              {m.senderType === 'admin' ? ar.support.supportTeam : ar.support.you} · {formatDateTime(m.createdAt)}
            </div>
          </div>
        ))}
      </div>

      {ticket.status === 'closed' ? (
        <div className="admin-form-help">{ar.support.closedNote}</div>
      ) : (
        <>
          <label>{ar.support.conversationTitle}
            <textarea value={reply} onChange={e => setReply(e.target.value)} rows={3} placeholder={ar.support.replyPlaceholder} />
          </label>
          <input
            type="file" accept="image/png,image/jpeg,image/webp" multiple
            onChange={e => setAttachments(Array.from(e.target.files ?? []).slice(0, MAX_ATTACHMENTS))}
          />
          {sendError && <div className="admin-form-error">{sendError}</div>}
          <button className="primary-button" disabled={sending || !reply.trim()} onClick={sendReply}>{ar.support.sendButton}</button>
        </>
      )}
    </div>
  )
}
