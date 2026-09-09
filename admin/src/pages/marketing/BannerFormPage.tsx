import { useEffect, useRef, useState } from 'react'
import { useNavigate, useOutletContext, useParams } from 'react-router-dom'
import { api, type AdminBannerInput } from '../../utils/api'
import type { LayoutContext } from '../../components/AdminLayout'

const emptyForm: AdminBannerInput = {
  kicker: '', title: '', note: '', emoji: '🛍️', altText: '', ctaLabel: 'تسوق الآن', link: '/', active: true
}

// input[type=datetime-local] بياخد/بيرجع بصيغة "YYYY-MM-DDTHH:mm" محلية (من غير timezone)،
// والسيرفر بيخزّن/بيرجّع ISO كامل (UTC) — التحويلين دول بيتعاملوا مع الفرق ده.
function toLocalInput(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function fromLocalInput(value: string): string | undefined {
  return value ? new Date(value).toISOString() : undefined
}

export function BannerFormPage() {
  const { id } = useParams()
  const isEdit = Boolean(id)
  const navigate = useNavigate()
  const { setHeader } = useOutletContext<LayoutContext>()
  const [form, setForm] = useState<AdminBannerInput>(emptyForm)
  const [imageUrl, setImageUrl] = useState<string | undefined>()
  const [mobileImageUrl, setMobileImageUrl] = useState<string | undefined>()
  const [loading, setLoading] = useState(isEdit)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState<'desktop' | 'mobile' | null>(null)
  const desktopInputRef = useRef<HTMLInputElement>(null)
  const mobileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setHeader({ crumb: 'التسويق', title: isEdit ? 'تعديل بانر' : 'إضافة بانر' })
  }, [setHeader, isEdit])

  useEffect(() => {
    if (!id) return
    api.getBanner(Number(id))
      .then(({ banner }) => {
        setForm(banner)
        setImageUrl(banner.imageUrl)
        setMobileImageUrl(banner.mobileImageUrl)
      })
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

  async function onImagePicked(e: React.ChangeEvent<HTMLInputElement>, variant: 'desktop' | 'mobile') {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !id) return
    setUploading(variant)
    try {
      const { image } = await api.uploadBannerImage(Number(id), file, variant)
      if (variant === 'desktop') setImageUrl(image)
      else setMobileImageUrl(image)
    } catch {
      setError('تعذر رفع الصورة')
    } finally {
      setUploading(null)
    }
  }

  async function removeImage(variant: 'desktop' | 'mobile') {
    if (!id) return
    setUploading(variant)
    try {
      await api.deleteBannerImage(Number(id), variant)
      if (variant === 'desktop') setImageUrl(undefined)
      else setMobileImageUrl(undefined)
    } catch {
      setError('تعذر حذف الصورة')
    } finally {
      setUploading(null)
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
        <label>الإيموجي (اختياري — احتياط لو مفيش صورة مرفوعة)
          <input value={form.emoji} onChange={e => set('emoji', e.target.value)} placeholder="🧀" />
        </label>
      </div>

      {isEdit && (
        <div className="admin-form-card">
          <div>
            <div className="admin-form-card-title">صورة البانر</div>
            <div className="admin-form-card-sub">لو موجودة بتظهر بدل الإيموجي — صورة الموبايل اختيارية لعرض مختلف على الشاشات الصغيرة</div>
          </div>
          <input ref={desktopInputRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }} onChange={e => onImagePicked(e, 'desktop')} />
          <input ref={mobileInputRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }} onChange={e => onImagePicked(e, 'mobile')} />

          <label>الصورة الرئيسية
            {imageUrl && <img src={imageUrl} alt="" style={{ width: '100%', maxHeight: 140, objectFit: 'cover', borderRadius: 12, marginBottom: 8 }} />}
            <span className="admin-form-chips">
              <button type="button" className="admin-form-chip" disabled={uploading === 'desktop'} onClick={() => desktopInputRef.current?.click()}>
                {uploading === 'desktop' ? 'جارِ الرفع...' : imageUrl ? 'تغيير الصورة' : 'رفع صورة'}
              </button>
              {imageUrl && <button type="button" className="admin-form-chip" disabled={uploading === 'desktop'} onClick={() => removeImage('desktop')}>حذف</button>}
            </span>
          </label>

          <label>صورة الموبايل (اختياري)
            {mobileImageUrl && <img src={mobileImageUrl} alt="" style={{ width: '100%', maxHeight: 140, objectFit: 'cover', borderRadius: 12, marginBottom: 8 }} />}
            <span className="admin-form-chips">
              <button type="button" className="admin-form-chip" disabled={uploading === 'mobile'} onClick={() => mobileInputRef.current?.click()}>
                {uploading === 'mobile' ? 'جارِ الرفع...' : mobileImageUrl ? 'تغيير الصورة' : 'رفع صورة'}
              </button>
              {mobileImageUrl && <button type="button" className="admin-form-chip" disabled={uploading === 'mobile'} onClick={() => removeImage('mobile')}>حذف</button>}
            </span>
          </label>

          <label>الوصف البديل للصورة (alt)
            <input value={form.altText} onChange={e => set('altText', e.target.value)} placeholder="وصف قصير للصورة" />
          </label>
        </div>
      )}

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
        <div className="admin-row-2">
          <label>يبدأ العرض (اختياري)
            <input type="datetime-local" value={toLocalInput(form.startsAt)} onChange={e => set('startsAt', fromLocalInput(e.target.value))} />
          </label>
          <label>ينتهي العرض (اختياري)
            <input type="datetime-local" value={toLocalInput(form.endsAt)} onChange={e => set('endsAt', fromLocalInput(e.target.value))} />
          </label>
        </div>
        <span className="admin-form-help">لو مش محدّدين، البانر بيظهر طول ما "الحالة" ظاهر للعملاء</span>

        {error && <div className="admin-form-error">{error}</div>}
        {success && <div className="admin-form-success">{success}</div>}
        <button className="admin-form-save" disabled={saving} onClick={save}>{isEdit ? 'حفظ التعديلات' : 'إنشاء البانر'}</button>
        {!isEdit && <span className="admin-form-help">احفظ البانر أولاً قبل رفع الصور</span>}
      </div>
    </div>
  )
}
