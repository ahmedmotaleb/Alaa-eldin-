import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '../utils/api'
import { ar } from '../i18n/ar'
import { TurnstileWidget } from '../components/TurnstileWidget'
import { getCaptchaSiteKey } from '../store/settingsStore'

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)
  const [captchaAttempt, setCaptchaAttempt] = useState(0)
  const captchaSiteKey = getCaptchaSiteKey()

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!email.trim()) return
    setError('')
    setSubmitting(true)
    try {
      await api.forgotPassword(email.trim(), captchaToken ?? undefined)
      setSent(true)
    } catch (err) {
      // فشل CAPTCHA بس هو اللي بيتعامل معاه كخطأ منفصل — رده عام تماماً (نفسه سواء الحساب
      // موجود أو لأ)، فعرضه هنا بشكل مختلف عن "تم الإرسال" مايكشفش أي حاجة عن وجود الحساب.
      // أي خطأ تاني (حتى خطأ شبكة) بيتعامل معاه بنفس رسالة "تم الإرسال" العامة، بنفس مبدأ
      // عدم الكشف اللي الـ endpoint ده مبني عليه أصلاً.
      if (err instanceof ApiError && err.code === 'captcha_required') {
        setError(ar.errors.forCode('captcha_required'))
        setCaptchaToken(null)
        setCaptchaAttempt(a => a + 1)
      } else {
        setSent(true)
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="auth-page">
      <form className="form-card" onSubmit={submit}>
        <h2>{ar.auth.forgotPasswordTitle}</h2>
        {sent ? (
          <p>{ar.auth.forgotPasswordSent}</p>
        ) : (
          <>
            <p>{ar.auth.forgotPasswordNote}</p>
            <label>{ar.auth.emailLabel}
              <input type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder={ar.auth.emailPlaceholder} />
            </label>
            {captchaSiteKey && <TurnstileWidget key={captchaAttempt} siteKey={captchaSiteKey} onToken={setCaptchaToken} />}
            {error && <div className="form-error-banner">{error}</div>}
            <button type="submit" className="primary-button" disabled={submitting || (!!captchaSiteKey && !captchaToken)}>{ar.auth.forgotPasswordSubmit}</button>
          </>
        )}
      </form>
      <div className="auth-switch">
        <Link to="/login">{ar.auth.backToLogin}</Link>
      </div>
    </div>
  )
}
