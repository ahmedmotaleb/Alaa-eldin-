import { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { api, type AdminSettings } from '../../utils/api'
import type { LayoutContext } from '../../components/AdminLayout'

export function HomeSectionsPage() {
  const { setHeader } = useOutletContext<LayoutContext>()
  const [form, setForm] = useState<AdminSettings | null>(null)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setHeader({ crumb: 'التسويق', title: 'الصفحة الرئيسية' })
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
          <div className="admin-form-card-title">أقسام الصفحة الرئيسية</div>
          <div className="admin-form-card-sub">تحكم في الأقسام الاختيارية اللي تظهر للعميل — الأقسام الأساسية (الأقسام وشريط التوصيل) تظهر دايماً</div>
        </div>
        <label>عروض اليوم
          <span className="admin-form-chips">
            <button type="button" className={`admin-form-chip ${form.showTodaysOffers ? 'active' : ''}`} onClick={() => set('showTodaysOffers', true)}>ظاهر</button>
            <button type="button" className={`admin-form-chip ${!form.showTodaysOffers ? 'active' : ''}`} onClick={() => set('showTodaysOffers', false)}>مخفي</button>
          </span>
          <span className="admin-form-help">قسم "عروض اليوم" في الرئيسية — صفحة `/offers` نفسها تفضل متاحة دايماً حتى لو مخفي هنا</span>
        </label>
        <label>الأكثر مبيعاً
          <span className="admin-form-chips">
            <button type="button" className={`admin-form-chip ${form.showBestSellers ? 'active' : ''}`} onClick={() => set('showBestSellers', true)}>ظاهر</button>
            <button type="button" className={`admin-form-chip ${!form.showBestSellers ? 'active' : ''}`} onClick={() => set('showBestSellers', false)}>مخفي</button>
          </span>
          <span className="admin-form-help">قسم "الأكثر مبيعاً" في الرئيسية — صفحة `/best-sellers` نفسها تفضل متاحة دايماً حتى لو مخفي هنا</span>
        </label>

        {error && <div className="admin-form-error">{error}</div>}
        {success && <div className="admin-form-success">{success}</div>}
        <button className="admin-form-save" disabled={saving} onClick={save}>حفظ التعديلات</button>
      </div>
    </div>
  )
}
