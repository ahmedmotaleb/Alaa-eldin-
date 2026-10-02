import { useState } from 'react'
import { api, ApiError, type AdminUser } from '../utils/api'
import { PasswordField } from './PasswordField'

// إعادة تعيين كلمة مرور مستخدم تاني — Drawer مستقل صغير بدل window.prompt، عشان كلمة
// المرور تتكتب بحقل مقنّع فعلي (زي باقي حقول كلمة المرور في اللوحة)، مش نص عادي.
export function ResetAdminPasswordDrawer({
  user,
  onClose,
  onDone
}: {
  user: AdminUser
  onClose: () => void
  onDone: (user: AdminUser) => void
}) {
  const [temporaryPassword, setTemporaryPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function submit() {
    setError('')
    if (temporaryPassword !== confirmPassword) { setError('كلمة المرور وتأكيدها غير متطابقين'); return }
    setSubmitting(true)
    try {
      const { user: updated } = await api.resetAdminPassword(user.id, temporaryPassword)
      onDone(updated)
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'weak_password'
        ? 'كلمة المرور ضعيفة — 8 أحرف على الأقل، وفيها حرف ورقم'
        : 'تعذر إعادة تعيين كلمة المرور')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="admin-drawer-overlay" onClick={onClose}>
      <div className="admin-drawer" onClick={e => e.stopPropagation()}>
        <div className="admin-drawer-head">
          <div className="admin-drawer-title">إعادة تعيين كلمة المرور</div>
          <button className="admin-drawer-close" onClick={onClose}>×</button>
        </div>
        <div className="admin-form-card">
          <div style={{ fontSize: 12.5, fontWeight: 600, color: '#4C5B51' }}>
            هيتم تعيين كلمة مرور مؤقتة جديدة لـ "{user.fullName}"، وإنهاء كل جلساته الحالية، وإجباره على تغييرها عند أول تسجيل دخول.
          </div>
          <PasswordField label="كلمة المرور المؤقتة الجديدة" value={temporaryPassword} onChange={setTemporaryPassword} autoComplete="new-password" helpText="8 أحرف على الأقل، وفيها حرف ورقم" />
          <PasswordField label="تأكيد كلمة المرور" value={confirmPassword} onChange={setConfirmPassword} autoComplete="new-password" />
          {error && <div className="admin-form-error">{error}</div>}
          <button className="admin-form-save" disabled={submitting} onClick={submit}>
            {submitting ? 'جارٍ الحفظ...' : 'إعادة تعيين كلمة المرور'}
          </button>
        </div>
      </div>
    </div>
  )
}
