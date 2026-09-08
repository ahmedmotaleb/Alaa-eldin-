import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../store/AuthContext'
import { ApiError } from '../utils/api'
import { ar } from '../i18n/ar'

export function RegisterPage() {
  const { register } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function submit() {
    setError('')
    if (password !== confirmPassword) {
      setError(ar.auth.passwordsDontMatch)
      return
    }
    setSubmitting(true)
    try {
      await register(email, password, fullName)
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
        <h2>{ar.auth.registerTitle}</h2>
        <label>{ar.auth.fullNameLabel}
          <input value={fullName} onChange={e => setFullName(e.target.value)} placeholder={ar.auth.fullNamePlaceholder} />
        </label>
        <label>{ar.auth.emailLabel}
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder={ar.auth.emailPlaceholder} />
        </label>
        <label>{ar.auth.passwordLabel}
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} />
        </label>
        <label>{ar.auth.confirmPasswordLabel}
          <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} />
        </label>
        {error && <div className="form-error-banner">{error}</div>}
        <button className="primary-button" disabled={submitting} onClick={submit}>{ar.auth.registerSubmit}</button>
      </div>
      <div className="auth-switch">
        <span>{ar.auth.alreadyHaveAccount}</span>
        <Link to="/login" state={location.state}>{ar.auth.loginLink}</Link>
      </div>
    </div>
  )
}
