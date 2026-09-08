import { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { api, type AdminSettings } from '../../utils/api'
import type { LayoutContext } from '../../components/AdminLayout'

export function DeliverySettingsPage() {
  const { setHeader } = useOutletContext<LayoutContext>()
  const [form, setForm] = useState<AdminSettings | null>(null)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setHeader({ crumb: 'الإعدادات', title: 'التوصيل' })
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
          <div className="admin-form-card-title">الحد الأدنى والشحن</div>
          <div className="admin-form-card-sub">تُطبَّق على تطبيق العميل فوراً بعد الحفظ</div>
        </div>
        <label>الحد الأدنى للطلب ({form.currency})
          <input type="number" value={form.minimumOrder} onChange={e => set('minimumOrder', Number(e.target.value))} />
        </label>
        <label>حد الشحن المجاني ({form.currency})
          <input type="number" value={form.freeShippingThreshold} onChange={e => set('freeShippingThreshold', Number(e.target.value))} />
          <span className="admin-form-help">الطلبات فوق هذا المبلغ توصيلها مجاني تلقائياً</span>
        </label>
        <label>تكلفة التوصيل الافتراضية ({form.currency})
          <input type="number" value={form.deliveryFee} onChange={e => set('deliveryFee', Number(e.target.value))} />
        </label>

        {error && <div className="admin-form-error">{error}</div>}
        {success && <div className="admin-form-success">{success}</div>}
        <button className="admin-form-save" disabled={saving} onClick={save}>حفظ التعديلات</button>
      </div>
    </div>
  )
}
