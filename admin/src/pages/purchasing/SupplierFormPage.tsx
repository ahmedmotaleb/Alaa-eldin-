import { useEffect, useState } from 'react'
import { useNavigate, useOutletContext, useParams } from 'react-router-dom'
import { api, ApiError, type AdminSupplierInput } from '../../utils/api'
import type { LayoutContext } from '../../components/AdminLayout'

const emptyForm: AdminSupplierInput = {
  name: '', contactPerson: '', mobile: '', whatsapp: '', email: '', address: '', taxNumber: '', notes: ''
}

export function SupplierFormPage() {
  const { id } = useParams()
  const isEdit = Boolean(id)
  const navigate = useNavigate()
  const { setHeader } = useOutletContext<LayoutContext>()
  const [form, setForm] = useState<AdminSupplierInput>(emptyForm)
  const [active, setActive] = useState(true)
  const [loading, setLoading] = useState(isEdit)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setHeader({ crumb: 'المشتريات', title: isEdit ? 'تعديل مورد' : 'إضافة مورد' })
  }, [setHeader, isEdit])

  useEffect(() => {
    if (!id) return
    api.getSupplier(id)
      .then(({ supplier }) => {
        setForm(supplier)
        setActive(supplier.active)
      })
      .catch(() => setError('تعذر تحميل بيانات المورد'))
      .finally(() => setLoading(false))
  }, [id])

  function set<K extends keyof AdminSupplierInput>(key: K, value: AdminSupplierInput[K]) {
    setForm(current => ({ ...current, [key]: value }))
  }

  async function save() {
    if (!form.name.trim()) { setError('اسم المورد مطلوب'); return }
    setError('')
    setSuccess('')
    setSaving(true)
    try {
      if (isEdit && id) {
        const { supplier } = await api.updateSupplier(id, form)
        setForm(supplier)
        setSuccess('تم حفظ التعديلات')
      } else {
        const { supplier } = await api.createSupplier(form)
        setSuccess('تم إضافة المورد')
        navigate(`/purchasing/suppliers/edit/${supplier.id}`, { replace: true })
      }
    } catch (err) {
      setError(err instanceof ApiError ? 'تعذر حفظ المورد، تحقق من البيانات' : 'حدث خطأ، حاول مرة أخرى')
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive() {
    if (!id) return
    try {
      const { supplier } = await api.setSupplierActive(id, !active)
      setActive(supplier.active)
    } catch {
      window.alert('تعذر تحديث حالة المورد')
    }
  }

  if (loading) return null

  return (
    <div className="admin-form-grid">
      <div className="admin-form-card">
        <div>
          <div className="admin-form-card-title">بيانات المورد</div>
          <div className="admin-form-card-sub">الاسم مطلوب، باقي البيانات اختيارية</div>
        </div>
        <label>اسم المورد
          <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="مثال: شركة النور للمواد الغذائية" />
        </label>
        <label>مسؤول التواصل
          <input value={form.contactPerson} onChange={e => set('contactPerson', e.target.value)} />
        </label>
        <label>الموبايل
          <input value={form.mobile} onChange={e => set('mobile', e.target.value)} />
        </label>
        <label>واتساب
          <input value={form.whatsapp} onChange={e => set('whatsapp', e.target.value)} placeholder="لو مختلف عن الموبايل" />
        </label>
        <label>البريد الإلكتروني
          <input value={form.email} onChange={e => set('email', e.target.value)} />
        </label>
      </div>

      <div className="admin-form-card">
        <div>
          <div className="admin-form-card-title">تفاصيل إضافية</div>
          <div className="admin-form-card-sub">العنوان والرقم الضريبي وملاحظات</div>
        </div>
        <label>العنوان
          <input value={form.address} onChange={e => set('address', e.target.value)} />
        </label>
        <label>الرقم الضريبي
          <input value={form.taxNumber} onChange={e => set('taxNumber', e.target.value)} />
        </label>
        <label>ملاحظات
          <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={3} />
        </label>

        {isEdit && (
          <label>الحالة
            <span className="admin-form-chips">
              <button type="button" className={`admin-form-chip ${active ? 'active' : ''}`} onClick={() => !active && toggleActive()}>مفعّل</button>
              <button type="button" className={`admin-form-chip ${!active ? 'active' : ''}`} onClick={() => active && toggleActive()}>معطّل</button>
            </span>
          </label>
        )}

        {error && <div className="admin-form-error">{error}</div>}
        {success && <div className="admin-form-success">{success}</div>}
        <button className="admin-form-save" disabled={saving} onClick={save}>{isEdit ? 'حفظ التعديلات' : 'إضافة المورد'}</button>
      </div>
    </div>
  )
}
