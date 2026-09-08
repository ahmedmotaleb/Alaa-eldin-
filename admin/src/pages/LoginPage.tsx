import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../store/AuthContext'
import { ApiError } from '../utils/api'

export function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function submit() {
    setSubmitting(true)
    setError('')
    try {
      await login(email, password)
      navigate('/', { replace: true })
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
        <p className="admin-login-note">هذا الحساب يجب أن يكون مسجّلاً كعميل أولاً ثم مرقّى لصلاحية مدير عبر: npm run make-admin --prefix server -- email</p>
      </div>
    </div>
  )
}
