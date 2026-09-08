import { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { api, type AdminSettings } from '../../utils/api'
import type { LayoutContext } from '../../components/AdminLayout'

export function StoreSettingsPage() {
  const { setHeader } = useOutletContext<LayoutContext>()
  const [form, setForm] = useState<AdminSettings | null>(null)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setHeader({ crumb: 'الإعدادات', title: 'المتجر' })
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
      setError('تعذر حفظ الإعدادات، تحقق من البيانات وحاول مرة أخرى')
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
          <div className="admin-form-card-title">بيانات المتجر</div>
          <div className="admin-form-card-sub">الاسم يظهر في رسالة واتساب عند إتمام الطلب</div>
        </div>
        <label>اسم المتجر
          <input value={form.name} onChange={e => set('name', e.target.value)} />
        </label>
        <label>رمز العملة
          <input value={form.currency} onChange={e => set('currency', e.target.value)} placeholder="ج.م" />
        </label>
      </div>

      <div className="admin-form-card">
        <div>
          <div className="admin-form-card-title">واتساب</div>
          <div className="admin-form-card-sub">الرقم اللي بتوصل عليه طلبات العملاء</div>
        </div>
        <label>رقم واتساب المتجر
          <input value={form.whatsappNumber} onChange={e => set('whatsappNumber', e.target.value)} placeholder="2010XXXXXXXX" />
          <span className="admin-form-help">بصيغة دولية بدون علامة + — مثال مصر: 2010XXXXXXXX</span>
        </label>

        {error && <div className="admin-form-error">{error}</div>}
        {success && <div className="admin-form-success">{success}</div>}
        <button className="admin-form-save" disabled={saving} onClick={save}>حفظ التعديلات</button>
      </div>
    </div>
  )
}
