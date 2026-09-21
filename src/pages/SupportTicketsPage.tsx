import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../store/AuthContext'
import { api, ApiError, type ApiSupportTicket } from '../utils/api'
import { formatDate } from '../utils/format'
import { ar } from '../i18n/ar'

const MAX_ATTACHMENTS = 3

export function SupportTicketsPage() {
  const navigate = useNavigate()
  const { user, loading: authLoading } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [tickets, setTickets] = useState<ApiSupportTicket[] | null>(null)
  const [error, setError] = useState('')

  const [showForm, setShowForm] = useState(searchParams.has('new') || searchParams.has('orderNumber'))
  const [category, setCategory] = useState('order_issue')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [orderNumber, setOrderNumber] = useState(searchParams.get('orderNumber') ?? '')
  const [attachments, setAttachments] = useState<File[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState('')

  function load() {
    if (!user) return
    api.listSupportTickets()
      .then(({ tickets }) => setTickets(tickets))
      .catch(err => setError(err instanceof ApiError ? ar.errors.forCode(err.code) : ar.errors.generic))
  }

  useEffect(load, [user])

  function onFilesChange(files: FileList | null) {
    setAttachments(Array.from(files ?? []).slice(0, MAX_ATTACHMENTS))
  }

  async function submit() {
    if (!subject.trim() || !message.trim()) return
    setSubmitting(true)
    setFormError('')
    try {
      const { ticket } = await api.createSupportTicket(
        { category, subject: subject.trim(), message: message.trim(), orderNumber: orderNumber.trim() || undefined },
        attachments
      )
      navigate(`/account/support/${ticket.id}`)
    } catch (err) {
      setFormError(err instanceof ApiError ? ar.errors.forCode(err.code) : ar.errors.generic)
    } finally {
      setSubmitting(false)
    }
  }

  if (authLoading || (user && tickets === null && !error)) return null

  if (!user) {
    return (
      <div className="account-guest-card">
        <h2>{ar.account.guestTitle}</h2>
        <p>{ar.support.guestNote}</p>
        <div className="account-guest-actions">
          <Link className="secondary-button" to="/register" state={{ from: '/account/support' }}>{ar.auth.registerCta}</Link>
          <Link className="primary-button" to="/login" state={{ from: '/account/support' }}>{ar.auth.loginCta}</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="order-list">
      {!showForm && (
        <button className="primary-button" onClick={() => { setShowForm(true); setSearchParams({}) }}>
          {ar.support.newTicketButton}
        </button>
      )}

      {showForm && (
        <div className="form-card">
          <strong>{ar.support.newTicketTitle}</strong>
          <label>{ar.support.categoryLabel}
            <select value={category} onChange={e => setCategory(e.target.value)}>
              {Object.entries(ar.support.categories).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </label>
          <label>{ar.support.subjectLabel}
            <input value={subject} onChange={e => setSubject(e.target.value)} maxLength={200} placeholder={ar.support.subjectPlaceholder} />
          </label>
          <label>{ar.support.messageLabel}
            <textarea value={message} onChange={e => setMessage(e.target.value)} rows={4} maxLength={5000} placeholder={ar.support.messagePlaceholder} />
          </label>
          <label>{ar.support.relatedOrderLabel}
            <input value={orderNumber} onChange={e => setOrderNumber(e.target.value)} placeholder={ar.support.relatedOrderNone} />
          </label>
          <label>{ar.support.attachmentsLabel}
            <input type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={e => onFilesChange(e.target.files)} />
          </label>
          {formError && <div className="admin-form-error">{formError}</div>}
          <button className="primary-button" disabled={submitting || !subject.trim() || !message.trim()} onClick={submit}>
            {submitting ? ar.support.submitting : ar.support.submitButton}
          </button>
        </div>
      )}

      {error && <div className="empty-card">{error}</div>}
      {!error && tickets && tickets.length === 0 && !showForm && <div className="empty-card">{ar.support.emptyList}</div>}

      {tickets && tickets.length > 0 && (
        <div className="order-list">
          {tickets.map(t => (
            <button key={t.id} className="order-row-main order-row" onClick={() => navigate(`/account/support/${t.id}`)}>
              <span className="order-row-icon">🎧</span>
              <span className="order-row-info">
                <span className="order-row-id">{t.ticketNumber}</span>
                <span className="order-row-date">{ar.support.categories[t.category] ?? t.category} · {formatDate(t.updatedAt)}</span>
              </span>
              <span className="order-row-end">
                <span className={`order-status-badge ${t.status === 'resolved' || t.status === 'closed' ? 'delivered' : 'active'}`}>
                  {ar.support.statusLabels[t.status] ?? t.status}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
