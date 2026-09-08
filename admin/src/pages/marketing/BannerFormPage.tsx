import { useEffect, useState } from 'react'
import { useNavigate, useOutletContext, useParams } from 'react-router-dom'
import { api, ApiError, type AdminBannerInput } from '../../utils/api'
import type { LayoutContext } from '../../components/AdminLayout'

const emptyForm: AdminBannerInput = {
  kicker: '', title: '', note: '', emoji: '🛍️', ctaLabel: 'تسوق الآن', link: '/', active: true
}

export function BannerFormPage() {
  const { id } = useParams()
  const isEdit = Boolean(id)
  const navigate = useNavigate()
  const { setHeader } = useOutletContext<LayoutContext>()
  const [form, setForm] = useState<AdminBannerInput>(emptyForm)
  const [loading, setLoading] = useState(isEdit)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setHeader({ crumb: 'التسويق', title: isEdit ? 'تعديل بانر' : 'إضافة بانر' })
  }, [setHeader, isEdit])

  useEffect(() => {
    if (!id) return
    api.getBanner(Number(id))
      .then(({ banner }) => setForm(banner))
      .catch(() => setError('تعذر تحميل بيانات البانر'))
      .finally(() => setLoading(false))
  }, [id])

  function set<K extends keyof AdminBannerInput>(key: K, value: AdminBannerInput[K]) {
    setForm(current => ({ ...current, [key]: value }))
  }

  async function save() {
    setError('')
    setSuccess('')
    setSaving(true)
    try {
      if (isEdit && id) {
        const { banner } = await api.updateBanner(Number(id), form)
        setForm(banner)
        setSuccess('تم حفظ التعديلات')
      } else {
        const { banner } = await api.createBanner(form)
        setSuccess('تم إنشاء البانر')
        navigate(`/marketing/banners/edit/${banner.id}`, { replace: true })
      }
    } catch {
      setError('تعذر حفظ البانر، تحقق من البيانات وحاول مرة أخرى')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return null

  return (
    <div className="admin-form-grid">
      <div className="admin-form-card">
        <div>
          <div className="admin-form-card-title">محتوى البانر</div>
          <div className="admin-form-card-sub">النص الظاهر للعميل في الصفحة الرئيسية</div>
        </div>
        <label>الشارة العلوية (اختياري)
          <input value={form.kicker} onChange={e => set('kicker', e.target.value)} placeholder="🔥 عرض الأسبوع" />
        </label>
        <label>العنوان
          <input value={form.title} onChange={e => set('title', e.target.value)} placeholder="خصم 20% على الألبان والأجبان" />
        </label>
        <label>ملاحظة (اختياري)
          <input value={form.note} onChange={e => set('note', e.target.value)} placeholder="صالح حتى نهاية الأسبوع" />
        </label>
        <label>الإيموجي
          <input value={form.emoji} onChange={e => set('emoji', e.target.value)} placeholder="🧀" />
        </label>
      </div>

      <div className="admin-form-card">
        <div>
          <div className="admin-form-card-title">الإجراء والحالة</div>
          <div className="admin-form-card-sub">زر البانر ووجهته</div>
        </div>
        <label>نص الزر
          <input value={form.ctaLabel} onChange={e => set('ctaLabel', e.target.value)} placeholder="تسوق العرض" />
        </label>
        <label>الرابط عند الضغط
          <input value={form.link} onChange={e => set('link', e.target.value)} placeholder="/category/dairy" />
          <span className="admin-form-help">مسار داخل التطبيق، مثال: /category/dairy أو /offers</span>
        </label>
        <label>الحالة
          <span className="admin-form-chips">
            <button type="button" className={`admin-form-chip ${form.active ? 'active' : ''}`} onClick={() => set('active', true)}>ظاهر للعملاء</button>
            <button type="button" className={`admin-form-chip ${!form.active ? 'active' : ''}`} onClick={() => set('active', false)}>مخفي</button>
          </span>
        </label>

        {error && <div className="admin-form-error">{error}</div>}
        {success && <div className="admin-form-success">{success}</div>}
        <button className="admin-form-save" disabled={saving} onClick={save}>{isEdit ? 'حفظ التعديلات' : 'إنشاء البانر'}</button>
      </div>
    </div>
  )
}
