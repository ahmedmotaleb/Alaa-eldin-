import { useState } from 'react'
import { api, ApiError, type AdminRole, type AdminUser } from '../utils/api'
import { PasswordField } from './PasswordField'

const ERROR_LABEL: Record<string, string> = {
  invalid_full_name: 'الاسم الكامل غير صالح (حرفين على الأقل)',
  invalid_email: 'البريد الإلكتروني غير صالح',
  weak_password: 'كلمة المرور ضعيفة — 8 أحرف على الأقل، وفيها حرف ورقم',
  role_required: 'اختر دور للمستخدم',
  role_not_found: 'الدور المختار غير موجود',
  email_taken: 'البريد الإلكتروني مستخدم بالفعل'
}

// نموذج إنشاء مسؤول/موظف جديد للوحة التحكم — أبداً عميل عادي. بيتبع نفس بنية الـ Drawer
// المستخدمة في باقي لوحة التحكم (admin-drawer-*)، وحقول النموذج بتستخدم تنسيق admin-form-card
// الموحّد (نفس المستخدم في SupplierFormPage/BannerFormPage..) عشان الحقول تبقى متسقة بصرياً.
export function CreateAdminUserDrawer({
  roles,
  onClose,
  onCreated
}: {
  roles: AdminRole[]
  onClose: () => void
  onCreated: (user: AdminUser) => void
}) {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [temporaryPassword, setTemporaryPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [roleId, setRoleId] = useState('')
  const [active, setActive] = useState(true)
  const [mustChangePassword, setMustChangePassword] = useState(true)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function submit() {
    setError('')
    if (!fullName.trim() || fullName.trim().length < 2) { setError('أدخل الاسم الكامل'); return }
    if (!email.trim()) { setError('أدخل البريد الإلكتروني'); return }
    if (!roleId) { setError(ERROR_LABEL.role_required); return }
    if (temporaryPassword !== confirmPassword) { setError('كلمة المرور وتأكيدها غير متطابقين'); return }

    setSubmitting(true)
    try {
      const { user } = await api.createAdminUser({
        fullName: fullName.trim(),
        email: email.trim(),
        temporaryPassword,
        roleId,
        active,
        mustChangePassword
      })
      onCreated(user)
    } catch (err) {
      setError(err instanceof ApiError ? (ERROR_LABEL[err.code] ?? 'تعذر إنشاء الحساب') : 'حدث خطأ، حاول مرة أخرى')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="admin-drawer-overlay" onClick={onClose}>
      <div className="admin-drawer" onClick={e => e.stopPropagation()}>
        <div className="admin-drawer-head">
          <div className="admin-drawer-title">إضافة مسؤول</div>
          <button className="admin-drawer-close" onClick={onClose}>×</button>
        </div>

        <div className="admin-form-card">
          <label>الاسم الكامل *
            <input value={fullName} onChange={e => setFullName(e.target.value)} placeholder="مثال: أحمد محمد" />
          </label>
          <label>البريد الإلكتروني *
            <input type="email" autoComplete="off" value={email} onChange={e => setEmail(e.target.value)} placeholder="name@example.com" />
          </label>
          <PasswordField label="كلمة المرور المؤقتة *" value={temporaryPassword} onChange={setTemporaryPassword} autoComplete="new-password" helpText="8 أحرف على الأقل، وفيها حرف ورقم" />
          <PasswordField label="تأكيد كلمة المرور *" value={confirmPassword} onChange={setConfirmPassword} autoComplete="new-password" />
          <label>نوع الحساب
            <input value="مسؤول لوحة تحكم" disabled />
          </label>
          <label>الدور *
            <select value={roleId} onChange={e => setRoleId(e.target.value)}>
              <option value="">اختر دوراً...</option>
              {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </label>
          <label style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} style={{ width: 'auto' }} />
            الحساب فعال
          </label>
          <label style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={mustChangePassword} onChange={e => setMustChangePassword(e.target.checked)} style={{ width: 'auto' }} />
            إجبار المستخدم على تغيير كلمة المرور عند أول تسجيل دخول
          </label>
          {error && <div className="admin-form-error">{error}</div>}
          <button className="admin-form-save" disabled={submitting} onClick={submit}>
            {submitting ? 'جارٍ الإضافة...' : 'إضافة المسؤول'}
          </button>
        </div>
      </div>
    </div>
  )
}
