import { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { api, type AdminSettings } from '../../utils/api'
import type { LayoutContext } from '../../components/AdminLayout'

export function PaymentSettingsPage() {
  const { setHeader } = useOutletContext<LayoutContext>()
  const [form, setForm] = useState<AdminSettings | null>(null)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setHeader({ crumb: 'الإعدادات', title: 'الدفع' })
  }, [setHeader])

  useEffect(() => {
    api.getSettings().then(({ settings }) => setForm(settings)).catch(() => setError('تعذر تحميل الإعدادات'))
  }, [])

  function set<K extends keyof AdminSettings>(key: K, value: AdminSettings[K]) {
    setForm(current => current ? { ...current, [key]: value } : current)
  }

  async function save() {
    if (!form) return
    setError('')
    setSuccess('')
    setSaving(true)
    try {
      const { settings } = await api.updateSettings(form)
      setForm(settings)
      setSuccess('تم حفظ التعديلات')
    } catch {
      setError('تعذر حفظ الإعدادات، حاول مرة أخرى')
    } finally {
      setSaving(false)
    }
  }

  if (error && !form) return <div className="admin-placeholder-card"><div className="admin-placeholder-note">{error}</div></div>
  if (!form) return null

  return (
    <div className="admin-form-grid">
      <div className="admin-form-card">
        <div>
          <div className="admin-form-card-title">وسائل الدفع</div>
          <div className="admin-form-card-sub">الدفع عند الاستلام هو الوسيلة الوحيدة المتاحة حالياً — مفيش بوابة دفع إلكتروني متصلة بعد</div>
        </div>
        <label>الدفع عند الاستلام (COD)
          <span className="admin-form-chips">
            <button type="button" className={`admin-form-chip ${form.codEnabled ? 'active' : ''}`} onClick={() => set('codEnabled', true)}>مفعّل</button>
            <button type="button" className={`admin-form-chip ${!form.codEnabled ? 'active' : ''}`} onClick={() => set('codEnabled', false)}>متوقف</button>
          </span>
          <span className="admin-form-help">تعطيله يمنع العملاء من إتمام أي طلب جديد لحد ما يترفع التفعيل تاني، لأنه وسيلة الدفع الوحيدة المتاحة</span>
        </label>

        {error && <div className="admin-form-error">{error}</div>}
        {success && <div className="admin-form-success">{success}</div>}
        <button className="admin-form-save" disabled={saving} onClick={save}>حفظ التعديلات</button>
      </div>
    </div>
  )
}
