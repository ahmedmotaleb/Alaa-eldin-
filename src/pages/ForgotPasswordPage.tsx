import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../utils/api'
import { ar } from '../i18n/ar'

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  async function submit() {
    if (!email.trim()) return
    setSubmitting(true)
    try {
      await api.forgotPassword(email.trim())
    } catch {
      // نفس الرسالة تظهر حتى لو حصل خطأ — الـ endpoint نفسه لا يفرّق حتى لا يكشف إيميلات مسجّلة
    } finally {
      setSubmitting(false)
      setSent(true)
    }
  }

  return (
    <div className="auth-page">
      <div className="form-card">
        <h2>{ar.auth.forgotPasswordTitle}</h2>
        {sent ? (
          <p>{ar.auth.forgotPasswordSent}</p>
        ) : (
          <>
            <p>{ar.auth.forgotPasswordNote}</p>
            <label>{ar.auth.emailLabel}
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder={ar.auth.emailPlaceholder} />
            </label>
            <button className="primary-button" disabled={submitting} onClick={submit}>{ar.auth.forgotPasswordSubmit}</button>
          </>
        )}
      </div>
      <div className="auth-switch">
        <Link to="/login">{ar.auth.backToLogin}</Link>
      </div>
    </div>
  )
}
