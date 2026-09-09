import { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { api, type AdminSettings } from '../../utils/api'
import { isValidEgyptianMobile } from '../../utils/phone'
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
    if (!isValidEgyptianMobile(form.whatsappNumber.trim())) {
      setError('أدخل رقم واتساب مصري صحيح مكون من 11 رقم ويبدأ بـ 010 أو 011 أو 012 أو 015')
      return
    }
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
          <input
            value={form.whatsappNumber}
            onChange={e => set('whatsappNumber', e.target.value.replace(/[^0-9]/g, '').slice(0, 11))}
            placeholder="01012345678"
            inputMode="numeric"
            autoComplete="tel"
            maxLength={11}
          />
          <span className="admin-form-help">بالصيغة المحلية المصرية فقط — مثال: 01012345678 (بدون +20)</span>
        </label>
      </div>

      <div className="admin-form-card">
        <div>
          <div className="admin-form-card-title">عرض المخزون للعميل</div>
          <div className="admin-form-card-sub">لما المخزون يبقى منخفض، هل نعرض الكمية الدقيقة المتبقية للعميل؟</div>
        </div>
        <label>الكمية الدقيقة عند المخزون المنخفض
          <span className="admin-form-chips">
            <button type="button" className={`admin-form-chip ${form.showExactLowStock ? 'active' : ''}`} onClick={() => set('showExactLowStock', true)}>نعم — "متبقي 3 فقط"</button>
            <button type="button" className={`admin-form-chip ${!form.showExactLowStock ? 'active' : ''}`} onClick={() => set('showExactLowStock', false)}>لا — "مخزون منخفض" فقط</button>
          </span>
        </label>

        {error && <div className="admin-form-error">{error}</div>}
        {success && <div className="admin-form-success">{success}</div>}
        <button className="admin-form-save" disabled={saving} onClick={save}>حفظ التعديلات</button>
      </div>
    </div>
  )
}
