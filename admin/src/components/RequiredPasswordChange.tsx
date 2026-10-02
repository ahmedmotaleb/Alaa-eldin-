import { useState, type FormEvent } from 'react'
import { api, ApiError } from '../utils/api'
import { useAuth } from '../store/AuthContext'
import { PasswordField } from './PasswordField'

// شاشة تغيير كلمة مرور إجباري — بتظهر بدل لوحة التحكم بالكامل (مفيش شريط جانبي ولا أي صفحة
// تانية متاحة) لحساب لوحة تحكم must_change_password=1، وتفضل كده لحد ما يغيّرها بنجاح. السيرفر
// نفسه بيرفض أي مسار إداري تاني بـ password_change_required طول ما العلم ده شغال (راجع
// requireAdmin في auth.ts) — الشاشة دي واجهة لقفلة حقيقية على مستوى السيرفر، مش مجرد UX.
export function RequiredPasswordChange() {
  const { updateUser, logout } = useAuth()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (newPassword !== confirmPassword) { setError('كلمة المرور الجديدة وتأكيدها غير متطابقين'); return }
    setSubmitting(true)
    try {
      const { user } = await api.changeRequiredPassword(currentPassword, newPassword)
      updateUser(user)
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'invalid_password'
        ? 'كلمة المرور الحالية غير صحيحة'
        : err instanceof ApiError && err.code === 'weak_password'
          ? 'كلمة المرور الجديدة ضعيفة — 8 أحرف على الأقل، وفيها حرف ورقم'
          : 'حدث خطأ، حاول مرة أخرى')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="admin-login-page">
      <form className="admin-login-card" onSubmit={submit}>
        <div className="admin-login-brand">
          <img src={`${import.meta.env.BASE_URL}images/logo-wordmark.png`} alt="علاء الدين" />
          <h1>لازم تغيّر كلمة المرور</h1>
          <p>حسابك اتعمل بكلمة مرور مؤقتة — لازم تغيّرها قبل ما تقدر تستخدم لوحة التحكم</p>
        </div>
        <PasswordField label="كلمة المرور الحالية" value={currentPassword} onChange={setCurrentPassword} autoComplete="current-password" />
        <PasswordField label="كلمة المرور الجديدة" value={newPassword} onChange={setNewPassword} autoComplete="new-password" helpText="8 أحرف على الأقل، وفيها حرف ورقم" />
        <PasswordField label="تأكيد كلمة المرور الجديدة" value={confirmPassword} onChange={setConfirmPassword} autoComplete="new-password" />
        {error && <div className="admin-login-error">{error}</div>}
        <button type="submit" className="admin-login-submit" disabled={submitting}>تغيير كلمة المرور</button>
        <button type="button" className="admin-login-forgot" style={{ border: 0, background: 'none', cursor: 'pointer' }} onClick={() => logout()}>تسجيل الخروج</button>
      </form>
    </div>
  )
}
