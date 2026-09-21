import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../store/AuthContext'
import { api, ApiError } from '../utils/api'
import { PasswordField } from '../components/PasswordField'
import { TurnstileWidget } from '../components/TurnstileWidget'

export function LoginPage() {
  const { login, verifyTwoFactorLogin } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [pendingToken, setPendingToken] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  // حساب الإدارة بيتطلّب CAPTCHA أبكر بكتير من العميل العادي (بعد محاولة فاشلة واحدة بس) —
  // بس برضه مش من أول محاولة دخول، فالـ widget بيظهر رد فعل لرسالة captcha_required من
  // السيرفر، مش من أول تحميل الصفحة.
  const [captchaRequired, setCaptchaRequired] = useState(false)
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)
  const [captchaAttempt, setCaptchaAttempt] = useState(0)
  const [captchaSiteKey, setCaptchaSiteKey] = useState<string | null>(null)

  useEffect(() => {
    // بدون مصادقة عمداً — الصفحة دي هي نفسها صفحة تسجيل الدخول، فمفيش جلسة لسه.
    api.getPublicCaptchaSiteKey().then(res => setCaptchaSiteKey(res.captcha.turnstileSiteKey)).catch(() => setCaptchaSiteKey(null))
  }, [])

  async function submit(e: FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      const result = await login(email, password, captchaRequired ? (captchaToken ?? undefined) : undefined)
      if ('requiresTwoFactor' in result) {
        setPendingToken(result.pendingToken)
        return
      }
      navigate(result.roleId === 'role-rider' ? '/rider' : '/', { replace: true })
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'captcha_required') {
          setError('تعذر التحقق الأمني. حاول مرة أخرى.')
          setCaptchaRequired(true)
          setCaptchaToken(null)
          setCaptchaAttempt(a => a + 1)
        } else {
          setError(err.code === 'invalid_credentials' ? 'البريد الإلكتروني أو كلمة المرور غير صحيحة' : 'حدث خطأ، حاول مرة أخرى')
        }
      } else {
        setError('هذا الحساب لا يملك صلاحية الدخول للوحة التحكم')
      }
    } finally {
      setSubmitting(false)
    }
  }

  async function submitTwoFactor(e: FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      const user = await verifyTwoFactorLogin(pendingToken, code)
      navigate(user.roleId === 'role-rider' ? '/rider' : '/', { replace: true })
    } catch (err) {
      if (err instanceof ApiError) {
        setError(
          err.code === 'invalid_code' ? 'الكود غير صحيح'
            : err.code === 'invalid_or_expired_login' ? 'انتهت صلاحية الجلسة، سجّل الدخول مرة أخرى'
              : 'حدث خطأ، حاول مرة أخرى'
        )
        if (err.code === 'invalid_or_expired_login') {
          setPendingToken('')
          setCode('')
        }
      } else {
        setError('حدث خطأ، حاول مرة أخرى')
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (pendingToken) {
    return (
      <div className="admin-login-page">
        <form className="admin-login-card" onSubmit={submitTwoFactor}>
          <div className="admin-login-brand">
            <img src={`${import.meta.env.BASE_URL}images/logo.png`} alt="علاء الدين" />
            <h1>التحقق بخطوتين</h1>
            <p>ادخل الكود من تطبيق المصادقة، أو استخدم كود احتياطي</p>
          </div>
          <label htmlFor="admin-2fa-code">الكود
            <input
              id="admin-2fa-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              value={code}
              onChange={e => setCode(e.target.value.trim())}
              placeholder="000000"
            />
          </label>
          {error && <div className="admin-login-error">{error}</div>}
          <button type="submit" className="admin-login-submit" disabled={submitting || !code}>تأكيد</button>
        </form>
      </div>
    )
  }

  return (
    <div className="admin-login-page">
      <form className="admin-login-card" onSubmit={submit}>
        <div className="admin-login-brand">
          <img src={`${import.meta.env.BASE_URL}images/logo.png`} alt="علاء الدين" />
          <h1>لوحة تحكم علاء الدين</h1>
          <p>تسجيل الدخول لإدارة المتجر</p>
        </div>
        <label htmlFor="admin-login-email">البريد الإلكتروني
          <input id="admin-login-email" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="admin@example.com" />
        </label>
        <PasswordField label="كلمة المرور" value={password} onChange={setPassword} autoComplete="current-password" />
        {captchaRequired && captchaSiteKey && <TurnstileWidget key={captchaAttempt} siteKey={captchaSiteKey} onToken={setCaptchaToken} />}
        {error && <div className="admin-login-error">{error}</div>}
        <button type="submit" className="admin-login-submit" disabled={submitting || (captchaRequired && !captchaToken)}>تسجيل الدخول</button>
        <a className="admin-login-forgot" href="/forgot-password">نسيت كلمة المرور؟</a>
        <p className="admin-login-note">هذا الحساب يجب أن يكون مسجّلاً كعميل أولاً ثم مرقّى لصلاحية مدير عبر: npm run make-admin --prefix server -- email</p>
      </form>
    </div>
  )
}
