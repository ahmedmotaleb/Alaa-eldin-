import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../store/AuthContext'
import { ApiError } from '../utils/api'
import { ar } from '../i18n/ar'
import { PasswordField } from '../components/PasswordField'
import { TurnstileWidget } from '../components/TurnstileWidget'
import { getCaptchaSiteKey } from '../store/settingsStore'

export function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  // مش زي التسجيل — المفروض ما يظهرش الـ widget من غير داعي على كل محاولة دخول عادية،
  // بس بعد ما السيرفر يرفض المحاولة برسالة captcha_required (سياسة تكيّفية بعد محاولات فاشلة).
  const [captchaRequired, setCaptchaRequired] = useState(false)
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)
  const [captchaAttempt, setCaptchaAttempt] = useState(0)
  const captchaSiteKey = getCaptchaSiteKey()

  async function submit(e: FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      await login(email, password, captchaRequired ? (captchaToken ?? undefined) : undefined)
      const from = (location.state as { from?: string } | null)?.from ?? '/'
      navigate(from, { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? ar.errors.forCode(err.code) : ar.errors.generic)
      if (err instanceof ApiError && err.code === 'captcha_required') {
        setCaptchaRequired(true)
        setCaptchaToken(null)
        setCaptchaAttempt(a => a + 1)
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="auth-page">
      <form className="form-card" onSubmit={submit}>
        <h2>{ar.auth.loginTitle}</h2>
        <label>{ar.auth.emailLabel}
          <input type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder={ar.auth.emailPlaceholder} />
        </label>
        <PasswordField label={ar.auth.passwordLabel} value={password} onChange={setPassword} autoComplete="current-password" />
        {captchaRequired && captchaSiteKey && <TurnstileWidget key={captchaAttempt} siteKey={captchaSiteKey} onToken={setCaptchaToken} />}
        {error && <div className="form-error-banner">{error}</div>}
        <button type="submit" className="primary-button" disabled={submitting || (captchaRequired && !captchaToken)}>{ar.auth.loginSubmit}</button>
        <Link to="/forgot-password" className="auth-forgot-link">{ar.auth.forgotPasswordLink}</Link>
      </form>
      <div className="auth-switch">
        <span>{ar.auth.noAccountYet}</span>
        <Link to="/register" state={location.state}>{ar.auth.createAccountLink}</Link>
      </div>
    </div>
  )
}
