import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../store/AuthContext'
import { ApiError } from '../utils/api'
import { ar } from '../i18n/ar'
import { PasswordField } from '../components/PasswordField'

export function RegisterPage() {
  const { register } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [referralCode, setReferralCode] = useState(() => searchParams.get('ref') ?? '')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (password !== confirmPassword) {
      setError(ar.auth.passwordsDontMatch)
      return
    }
    setSubmitting(true)
    try {
      await register(email, password, fullName, referralCode.trim() || undefined)
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
      <form className="form-card" onSubmit={submit}>
        <h2>{ar.auth.registerTitle}</h2>
        <label>{ar.auth.fullNameLabel}
          <input autoComplete="name" value={fullName} onChange={e => setFullName(e.target.value)} placeholder={ar.auth.fullNamePlaceholder} />
        </label>
        <label>{ar.auth.emailLabel}
          <input type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder={ar.auth.emailPlaceholder} />
        </label>
        <PasswordField
          label={ar.auth.passwordLabel} value={password} onChange={setPassword}
          autoComplete="new-password" helpText={ar.auth.passwordRequirementsHint}
        />
        <PasswordField label={ar.auth.confirmPasswordLabel} value={confirmPassword} onChange={setConfirmPassword} autoComplete="new-password" />
        <label>{ar.auth.referralCodeLabel}
          <input value={referralCode} onChange={e => setReferralCode(e.target.value)} placeholder={ar.auth.referralCodePlaceholder} />
        </label>
        {error && <div className="form-error-banner">{error}</div>}
        <button type="submit" className="primary-button" disabled={submitting}>{ar.auth.registerSubmit}</button>
      </form>
      <div className="auth-switch">
        <span>{ar.auth.alreadyHaveAccount}</span>
        <Link to="/login" state={location.state}>{ar.auth.loginLink}</Link>
      </div>
    </div>
  )
}
