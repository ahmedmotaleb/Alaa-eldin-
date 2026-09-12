import { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { api, ApiError, type WhatsAppTemplate, type WhatsAppTemplateInput } from '../../utils/api'
import { formatDateTime } from '../../utils/format'
import type { LayoutContext } from '../../components/AdminLayout'

const CATEGORY_LABEL: Record<string, string> = {
  order_confirmation: 'تأكيد الطلب',
  ready_for_delivery: 'جاهز للتوصيل',
  out_for_delivery: 'خرج للتوصيل',
  delivered: 'تم التوصيل',
  custom: 'مخصص'
}

const EMPTY_FORM: WhatsAppTemplateInput = { name: '', category: 'custom', content: '', active: true }

export function WhatsAppTemplatesPage() {
  const { setHeader } = useOutletContext<LayoutContext>()
  const [templates, setTemplates] = useState<WhatsAppTemplate[] | null>(null)
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [error, setError] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<WhatsAppTemplateInput>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  useEffect(() => {
    setHeader({ crumb: 'التسويق', title: 'قوالب واتساب' })
  }, [setHeader])

  function load() {
    api.listWhatsAppTemplates()
      .then(({ templates }) => setTemplates(templates))
      .catch(err => setError(err instanceof ApiError ? 'تعذر تحميل القوالب' : 'حدث خطأ، حاول مرة أخرى'))
    api.getWhatsAppStatus().then(({ configured }) => setConfigured(configured)).catch(() => setConfigured(false))
  }

  useEffect(load, [])

  function startNew() {
    setEditingId('new')
    setForm(EMPTY_FORM)
    setFormError('')
  }

  function startEdit(t: WhatsAppTemplate) {
    setEditingId(t.id)
    setForm({ name: t.name, category: t.category, content: t.content, active: t.active })
    setFormError('')
  }

  async function save() {
    if (!form.name.trim() || !form.content.trim()) {
      setFormError('اسم القالب والمحتوى مطلوبان')
      return
    }
    setSaving(true)
    setFormError('')
    try {
      if (editingId === 'new') {
        await api.createWhatsAppTemplate(form)
      } else if (editingId) {
        await api.updateWhatsAppTemplate(editingId, form)
      }
      setEditingId(null)
      load()
    } catch (err) {
      setFormError(err instanceof ApiError && err.code === 'name_taken' ? 'اسم القالب مستخدم بالفعل' : 'تعذر الحفظ، حاول مرة أخرى')
    } finally {
      setSaving(false)
    }
  }

  if (error) return <div className="admin-placeholder-card"><div className="admin-placeholder-note">{error}</div></div>
  if (!templates) return null

  return (
    <>
      {configured === false && (
        <div className="admin-placeholder-card" style={{ marginBottom: 16, background: '#FFF3E3' }}>
          <div className="admin-placeholder-note">
            الإرسال الفعلي عبر واتساب غير مفعّل حالياً — لازم تضبط WHATSAPP_ACCESS_TOKEN وWHATSAPP_PHONE_NUMBER_ID
            في متغيرات بيئة السيرفر (WhatsApp Business Cloud API من Meta) عشان الإرسال من القوالب يشتغل فعلياً.
            رابط "واتساب العميل" اليدوي من صفحة الطلب هيفضل شغال في كل الأحوال.
          </div>
        </div>
      )}

      <div className="admin-table-card" style={{ padding: 16, marginBottom: 16 }}>
        {editingId ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 520 }}>
            <input placeholder="اسم القالب" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
              {Object.entries(CATEGORY_LABEL).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
            <textarea
              placeholder="المحتوى — استخدم {{customerName}} و{{orderNumber}} كمتغيرات"
              value={form.content}
              onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
              rows={3}
            />
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
              <input type="checkbox" checked={form.active} onChange={e => setForm(f => ({ ...f, active: e.target.checked }))} />
              مفعّل
            </label>
            {formError && <div style={{ color: '#B42318', fontSize: 13 }}>{formError}</div>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="admin-category-card-btn" disabled={saving} onClick={save}>{saving ? 'جارٍ الحفظ...' : 'حفظ'}</button>
              <button className="admin-category-card-btn" disabled={saving} onClick={() => setEditingId(null)}>إلغاء</button>
            </div>
          </div>
        ) : (
          <button className="admin-category-card-btn" onClick={startNew}>+ قالب جديد</button>
        )}
      </div>

      <div className="admin-table-card">
        <div className="admin-table-scroll">
          <div style={{ minWidth: 640 }}>
            <div className="admin-table-head" style={{ gridTemplateColumns: '1.2fr 1fr 2fr .8fr' }}>
              <div>الاسم</div><div>الفئة</div><div>المحتوى</div><div>الحالة</div>
            </div>
            {templates.map(t => (
              <div key={t.id} className="admin-table-row clickable" style={{ gridTemplateColumns: '1.2fr 1fr 2fr .8fr' }} onClick={() => startEdit(t)}>
                <div className="admin-cell-plain" style={{ fontWeight: 900 }}>{t.name}</div>
                <div className="admin-cell-plain" style={{ color: '#68746B' }}>{CATEGORY_LABEL[t.category] ?? t.category}</div>
                <div className="admin-cell-plain" style={{ color: '#68746B', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.content}</div>
                <div>
                  <span className="admin-pill" style={{ background: t.active ? '#EAF8EF' : '#F1F4F2', color: t.active ? '#12813C' : '#68746B' }}>
                    {t.active ? 'مفعّل' : 'معطّل'}
                  </span>
                </div>
              </div>
            ))}
            {templates.length === 0 && <div className="admin-table-empty">مفيش قوالب بعد</div>}
          </div>
        </div>
      </div>
      {templates.length > 0 && (
        <div style={{ marginTop: 8, fontSize: 12, color: '#8A948C' }}>آخر تحديث: {formatDateTime(templates[0].updatedAt)}</div>
      )}
    </>
  )
}
