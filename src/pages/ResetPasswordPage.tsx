import { useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ApiError, api } from '../utils/api'
import { ar } from '../i18n/ar'
import { PasswordField } from '../components/PasswordField'

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') ?? ''
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  if (!token) {
    return (
      <div className="auth-page">
        <div className="form-card">
          <h2>{ar.auth.resetPasswordTitle}</h2>
          <div className="form-error-banner">{ar.auth.resetPasswordInvalidLink}</div>
        </div>
        <div className="auth-switch">
          <Link to="/forgot-password">{ar.auth.forgotPasswordLink}</Link>
        </div>
      </div>
    )
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (password !== confirmPassword) {
      setError(ar.auth.passwordsDontMatch)
      return
    }
    setSubmitting(true)
    try {
      await api.resetPassword(token, password)
      setSuccess(true)
    } catch (err) {
      setError(err instanceof ApiError ? ar.errors.forCode(err.code) : ar.errors.generic)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="auth-page">
      <form className="form-card" onSubmit={submit}>
        <h2>{ar.auth.resetPasswordTitle}</h2>
        {success ? (
          <p>{ar.auth.resetPasswordSuccess}</p>
        ) : (
          <>
            <PasswordField
              label={ar.auth.newPasswordLabel} value={password} onChange={setPassword}
              autoComplete="new-password" helpText={ar.auth.passwordRequirementsHint}
            />
            <PasswordField label={ar.auth.confirmPasswordLabel} value={confirmPassword} onChange={setConfirmPassword} autoComplete="new-password" />
            {error && <div className="form-error-banner">{error}</div>}
            <button type="submit" className="primary-button" disabled={submitting}>{ar.auth.resetPasswordSubmit}</button>
          </>
        )}
      </form>
      {success && (
        <div className="auth-switch">
          <Link to="/login">{ar.auth.backToLogin}</Link>
        </div>
      )}
    </div>
  )
}
