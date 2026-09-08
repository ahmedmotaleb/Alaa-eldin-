import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ApiError, api } from '../utils/api'
import { ar } from '../i18n/ar'

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

  async function submit() {
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
      <div className="form-card">
        <h2>{ar.auth.resetPasswordTitle}</h2>
        {success ? (
          <p>{ar.auth.resetPasswordSuccess}</p>
        ) : (
          <>
            <label>{ar.auth.newPasswordLabel}
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} />
            </label>
            <label>{ar.auth.confirmPasswordLabel}
              <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} />
            </label>
            {error && <div className="form-error-banner">{error}</div>}
            <button className="primary-button" disabled={submitting} onClick={submit}>{ar.auth.resetPasswordSubmit}</button>
          </>
        )}
      </div>
      {success && (
        <div className="auth-switch">
          <Link to="/login">{ar.auth.backToLogin}</Link>
        </div>
      )}
    </div>
  )
}
