import { useEffect, useState } from 'react'
import { useNavigate, useOutletContext, useParams } from 'react-router-dom'
import { api, ApiError, type AdminDiscountInput } from '../../utils/api'
import type { LayoutContext } from '../../components/AdminLayout'

const emptyForm: AdminDiscountInput = {
  code: '', type: 'percentage', value: 10, minOrder: 0, maxUses: null, active: true, expiresAt: null
}

export function DiscountFormPage() {
  const { code } = useParams()
  const isEdit = Boolean(code)
  const navigate = useNavigate()
  const { setHeader } = useOutletContext<LayoutContext>()
  const [form, setForm] = useState<AdminDiscountInput>(emptyForm)
  const [usedCount, setUsedCount] = useState(0)
  const [loading, setLoading] = useState(isEdit)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setHeader({ crumb: 'الخصومات', title: isEdit ? 'تعديل خصم' : 'إنشاء خصم' })
  }, [setHeader, isEdit])

  useEffect(() => {
    if (!code) return
    api.listDiscounts()
      .then(({ discounts }) => {
        const found = discounts.find(d => d.code === code)
        if (found) { setForm(found); setUsedCount(found.usedCount) }
        else setError('كود الخصم غير موجود')
      })
      .catch(() => setError('تعذر تحميل بيانات الخصم'))
      .finally(() => setLoading(false))
  }, [code])

  function set<K extends keyof AdminDiscountInput>(key: K, value: AdminDiscountInput[K]) {
    setForm(current => ({ ...current, [key]: value }))
  }

  async function save() {
    setError('')
    setSuccess('')
    setSaving(true)
    try {
      if (isEdit && code) {
        const { discount } = await api.updateDiscount(code, form)
        setForm(discount)
        setUsedCount(discount.usedCount)
        setSuccess('تم حفظ التعديلات')
      } else {
        const { discount } = await api.createDiscount({ ...form, code: form.code.trim().toUpperCase() })
        setSuccess('تم إنشاء كود الخصم')
        navigate(`/discounts/edit/${discount.code}`, { replace: true })
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === 'code_taken') setError('هذا الكود مستخدم بالفعل')
      else setError('تعذر حفظ الخصم، تحقق من البيانات وحاول مرة أخرى')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return null

  return (
    <div className="admin-form-grid">
      <div className="admin-form-card">
        <div>
          <div className="admin-form-card-title">بيانات الكود</div>
          <div className="admin-form-card-sub">الكود ونوع الخصم</div>
        </div>
        <label>كود الخصم
          <input
            value={form.code}
            disabled={isEdit}
            onChange={e => set('code', e.target.value.toUpperCase())}
            placeholder="مثال: SAVE10"
          />
        </label>
        <label>نوع الخصم
          <span className="admin-form-chips">
            <button type="button" className={`admin-form-chip ${form.type === 'percentage' ? 'active' : ''}`} onClick={() => set('type', 'percentage')}>نسبة مئوية</button>
            <button type="button" className={`admin-form-chip ${form.type === 'fixed' ? 'active' : ''}`} onClick={() => set('type', 'fixed')}>قيمة ثابتة</button>
          </span>
        </label>
        <label>{form.type === 'percentage' ? 'النسبة (%)' : 'القيمة (ج.م)'}
          <input type="number" value={form.value} onChange={e => set('value', Number(e.target.value))} />
        </label>
        <label>الحالة
          <span className="admin-form-chips">
            <button type="button" className={`admin-form-chip ${form.active ? 'active' : ''}`} onClick={() => set('active', true)}>مفعّل</button>
            <button type="button" className={`admin-form-chip ${!form.active ? 'active' : ''}`} onClick={() => set('active', false)}>معطّل</button>
          </span>
        </label>
      </div>

      <div className="admin-form-card">
        <div>
          <div className="admin-form-card-title">الشروط والحدود</div>
          <div className="admin-form-card-sub">الحد الأدنى وعدد مرات الاستخدام</div>
        </div>
        <label>الحد الأدنى للطلب (ج.م)
          <input type="number" value={form.minOrder} onChange={e => set('minOrder', Number(e.target.value))} />
        </label>
        <label>الحد الأقصى لعدد مرات الاستخدام
          <input
            type="number"
            value={form.maxUses ?? ''}
            onChange={e => set('maxUses', e.target.value ? Number(e.target.value) : null)}
            placeholder="بلا حدود"
          />
        </label>
        <label>تاريخ انتهاء الصلاحية
          <input
            type="date"
            value={form.expiresAt ? form.expiresAt.slice(0, 10) : ''}
            onChange={e => set('expiresAt', e.target.value || null)}
          />
          <span className="admin-form-help">اتركه فارغاً لخصم بلا تاريخ انتهاء</span>
        </label>
        {isEdit && (
          <span className="admin-form-help">عدد مرات الاستخدام حتى الآن: {usedCount}</span>
        )}

        {error && <div className="admin-form-error">{error}</div>}
        {success && <div className="admin-form-success">{success}</div>}
        <button className="admin-form-save" disabled={saving} onClick={save}>{isEdit ? 'حفظ التعديلات' : 'إنشاء الكود'}</button>
      </div>
    </div>
  )
}
