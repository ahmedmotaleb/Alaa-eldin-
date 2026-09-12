import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../store/AuthContext'
import { ApiError } from '../utils/api'

export function LoginPage() {
  const { login, verifyTwoFactorLogin } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [pendingToken, setPendingToken] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function submit() {
    setSubmitting(true)
    setError('')
    try {
      const result = await login(email, password)
      if ('requiresTwoFactor' in result) {
        setPendingToken(result.pendingToken)
        return
      }
      navigate(result.roleId === 'role-rider' ? '/rider' : '/', { replace: true })
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.code === 'invalid_credentials' ? 'البريد الإلكتروني أو كلمة المرور غير صحيحة' : 'حدث خطأ، حاول مرة أخرى')
      } else {
        setError('هذا الحساب لا يملك صلاحية الدخول للوحة التحكم')
      }
    } finally {
      setSubmitting(false)
    }
  }

  async function submitTwoFactor() {
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
        <div className="admin-login-card">
          <div className="admin-login-brand">
            <img src={`${import.meta.env.BASE_URL}images/logo.png`} alt="علاء الدين" />
            <h1>التحقق بخطوتين</h1>
            <p>ادخل الكود من تطبيق المصادقة، أو استخدم كود احتياطي</p>
          </div>
          <label>الكود
            <input
              type="text"
              inputMode="numeric"
              autoFocus
              value={code}
              onChange={e => setCode(e.target.value.trim())}
              placeholder="000000"
            />
          </label>
          {error && <div className="admin-login-error">{error}</div>}
          <button className="admin-login-submit" disabled={submitting || !code} onClick={submitTwoFactor}>تأكيد</button>
        </div>
      </div>
    )
  }

  return (
    <div className="admin-login-page">
      <div className="admin-login-card">
        <div className="admin-login-brand">
          <img src={`${import.meta.env.BASE_URL}images/logo.png`} alt="علاء الدين" />
          <h1>لوحة تحكم علاء الدين</h1>
          <p>تسجيل الدخول لإدارة المتجر</p>
        </div>
        <label>البريد الإلكتروني
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="admin@example.com" />
        </label>
        <label>كلمة المرور
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} />
        </label>
        {error && <div className="admin-login-error">{error}</div>}
        <button className="admin-login-submit" disabled={submitting} onClick={submit}>تسجيل الدخول</button>
        <a className="admin-login-forgot" href="/forgot-password">نسيت كلمة المرور؟</a>
        <p className="admin-login-note">هذا الحساب يجب أن يكون مسجّلاً كعميل أولاً ثم مرقّى لصلاحية مدير عبر: npm run make-admin --prefix server -- email</p>
      </div>
    </div>
  )
}
