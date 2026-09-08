import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../store/AuthContext'
import { ApiError } from '../utils/api'
import { ar } from '../i18n/ar'

export function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function submit() {
    setSubmitting(true)
    setError('')
    try {
      await login(email, password)
      const from = (location.state as { from?: string } | null)?.from ?? '/'
      navigate(from, { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? ar.errors.forCode(err.code) : ar.errors.generic)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="auth-page">
      <div className="form-card">
        <h2>{ar.auth.loginTitle}</h2>
        <label>{ar.auth.emailLabel}
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder={ar.auth.emailPlaceholder} />
        </label>
        <label>{ar.auth.passwordLabel}
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} />
        </label>
        {error && <div className="form-error-banner">{error}</div>}
        <button className="primary-button" disabled={submitting} onClick={submit}>{ar.auth.loginSubmit}</button>
        <Link to="/forgot-password" className="auth-forgot-link">{ar.auth.forgotPasswordLink}</Link>
      </div>
      <div className="auth-switch">
        <span>{ar.auth.noAccountYet}</span>
        <Link to="/register" state={location.state}>{ar.auth.createAccountLink}</Link>
      </div>
    </div>
  )
}
