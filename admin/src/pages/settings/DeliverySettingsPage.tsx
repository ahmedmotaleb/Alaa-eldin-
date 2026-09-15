import { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import {
  api, ApiError, type AdminSettings, type AdminDeliveryZone, type AdminDeliverySlot,
  type AdminDeliveryCalendarSettings, type AdminDeliveryDateOverride
} from '../../utils/api'
import type { LayoutContext } from '../../components/AdminLayout'

const WEEKDAY_LABELS: Record<number, string> = {
  1: 'الاثنين', 2: 'الثلاثاء', 3: 'الأربعاء', 4: 'الخميس', 5: 'الجمعة', 6: 'السبت', 7: 'الأحد'
}
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 7]

// تاريخ "النهاردة" هنا بس لعرض قايمة الأيام في الواجهة (تقريب مريح، بيعتمد على توقيت
// جهاز الأدمن) — المرجع الفعلي والوحيد لكل قرار (سعة، إتاحة يوم) هو توقيت القاهرة على
// السيرفر نفسه (راجع server/src/cairoDate.ts)، مش أي حساب هنا في الواجهة.
function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function addDaysIso(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + days)
  return dt.toISOString().slice(0, 10)
}

function isoWeekday(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number)
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return day === 0 ? 7 : day
}

const ZONE_COLS = '2fr 1fr .6fr .8fr'

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
    <>
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
            <span className="admin-form-help">الطلبات فوق هذا المبلغ توصيلها مجاني تلقائياً، في كل المحافظات</span>
          </label>
          <label>تكلفة التوصيل الافتراضية ({form.currency})
            <input type="number" value={form.deliveryFee} onChange={e => set('deliveryFee', Number(e.target.value))} />
            <span className="admin-form-help">بتظهر بس كتقدير في سلة العميل قبل ما يختار محافظة — رسوم التوصيل الفعلية وقت الطلب بتتحدد من جدول المحافظات تحت</span>
          </label>

          {error && <div className="admin-form-error">{error}</div>}
          {success && <div className="admin-form-success">{success}</div>}
          <button className="admin-form-save" disabled={saving} onClick={save}>حفظ التعديلات</button>
        </div>
      </div>

      <DeliveryZonesSection />
      <DeliverySlotsSection />
      <DeliveryCalendarSection />
    </>
  )
}

function DeliveryZonesSection() {
  const [zones, setZones] = useState<AdminDeliveryZone[] | null>(null)
  const [drafts, setDrafts] = useState<Record<string, { deliveryFee: number, isActive: boolean }>>({})
  const [savingGovernorate, setSavingGovernorate] = useState('')
  const [error, setError] = useState('')

  function load() {
    api.listDeliveryZones()
      .then(({ zones }) => {
        setZones(zones)
        setDrafts(Object.fromEntries(zones.map(z => [z.governorate, { deliveryFee: z.deliveryFee, isActive: z.isActive }])))
      })
      .catch(() => setError('تعذر تحميل مناطق التوصيل'))
  }

  useEffect(() => { load() }, [])

  function setDraft(governorate: string, patch: Partial<{ deliveryFee: number, isActive: boolean }>) {
    setDrafts(current => ({ ...current, [governorate]: { ...current[governorate], ...patch } }))
  }

  async function saveZone(governorate: string) {
    const draft = drafts[governorate]
    if (!draft) return
    setSavingGovernorate(governorate)
    try {
      const { zone } = await api.updateDeliveryZone(governorate, draft)
      setZones(current => current?.map(z => z.governorate === zone.governorate ? zone : z) ?? current)
    } catch {
      setError('تعذر حفظ رسوم التوصيل لهذه المحافظة')
    } finally {
      setSavingGovernorate('')
    }
  }

  if (error && !zones) return <div className="admin-placeholder-card"><div className="admin-placeholder-note">{error}</div></div>
  if (!zones) return null

  return (
    <div className="admin-table-card" style={{ marginTop: 16 }}>
      <div className="admin-table-tools">
        <div className="admin-form-card-title">مناطق التوصيل (رسوم كل محافظة)</div>
      </div>
      <div className="admin-table-scroll">
        <div style={{ minWidth: 560 }}>
          <div className="admin-table-head" style={{ gridTemplateColumns: ZONE_COLS }}>
            <div>المحافظة</div><div>رسوم التوصيل</div><div>مفعّلة</div><div>إجراء</div>
          </div>
          {zones.map(z => {
            const draft = drafts[z.governorate] ?? { deliveryFee: z.deliveryFee, isActive: z.isActive }
            const dirty = draft.deliveryFee !== z.deliveryFee || draft.isActive !== z.isActive
            return (
              <div key={z.governorate} className="admin-table-row" style={{ gridTemplateColumns: ZONE_COLS }}>
                <div className="admin-cell-plain">{z.governorate}</div>
                <div>
                  <input
                    type="number"
                    style={{ width: 90 }}
                    value={draft.deliveryFee}
                    onChange={e => setDraft(z.governorate, { deliveryFee: Number(e.target.value) })}
                  />
                </div>
                <div>
                  <input
                    type="checkbox"
                    checked={draft.isActive}
                    onChange={e => setDraft(z.governorate, { isActive: e.target.checked })}
                  />
                </div>
                <div>
                  <button
                    className="admin-category-card-btn"
                    disabled={!dirty || savingGovernorate === z.governorate}
                    onClick={() => saveZone(z.governorate)}
                  >
                    {savingGovernorate === z.governorate ? 'جارِ الحفظ...' : 'حفظ'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>
      {error && <div className="admin-form-error" style={{ margin: '10px 14px' }}>{error}</div>}
      <div className="admin-table-footer">
        <span>{zones.length} محافظة</span>
        <span>محافظة موقوفة (غير مفعّلة) ميقدرش عميل يطلب توصيل ليها</span>
      </div>
    </div>
  )
}

const emptySlotForm = { id: '', label: '', note: '', isActive: true, maxOrdersPerDay: '' }

function DeliverySlotsSection() {
  const [slots, setSlots] = useState<AdminDeliverySlot[] | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState({ label: '', note: '', isActive: true, maxOrdersPerDay: '' })
  const [showCreate, setShowCreate] = useState(false)
  const [createForm, setCreateForm] = useState(emptySlotForm)
  const [error, setError] = useState('')
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)

  function load() {
    api.listDeliverySlots().then(({ slots }) => setSlots(slots)).catch(() => setError('تعذر تحميل مواعيد التوصيل'))
  }

  useEffect(() => { load() }, [])

  function startEdit(slot: AdminDeliverySlot) {
    setEditingId(slot.id)
    setEditForm({ label: slot.label, note: slot.note, isActive: slot.isActive, maxOrdersPerDay: slot.maxOrdersPerDay?.toString() ?? '' })
    setFormError('')
  }

  async function saveEdit() {
    if (!editingId) return
    if (!editForm.label.trim()) {
      setFormError('اسم الميعاد مطلوب')
      return
    }
    setSaving(true)
    setFormError('')
    try {
      const maxOrdersPerDay = editForm.maxOrdersPerDay.trim() ? Number(editForm.maxOrdersPerDay) : null
      await api.updateDeliverySlot(editingId, { label: editForm.label.trim(), note: editForm.note.trim(), isActive: editForm.isActive, maxOrdersPerDay })
      setEditingId(null)
      load()
    } catch {
      setFormError('تعذر حفظ التعديلات')
    } finally {
      setSaving(false)
    }
  }

  async function createSlot() {
    const id = createForm.id.trim()
    if (!/^[a-z0-9_-]{1,40}$/.test(id) || !createForm.label.trim()) {
      setFormError('المعرّف (بالإنجليزية الصغيرة فقط) والاسم مطلوبان')
      return
    }
    setSaving(true)
    setFormError('')
    try {
      const maxOrdersPerDay = createForm.maxOrdersPerDay.trim() ? Number(createForm.maxOrdersPerDay) : null
      await api.createDeliverySlot({ id, label: createForm.label.trim(), note: createForm.note.trim(), isActive: createForm.isActive, maxOrdersPerDay })
      setCreateForm(emptySlotForm)
      setShowCreate(false)
      load()
    } catch (err) {
      setFormError(err instanceof ApiError && err.code === 'delivery_slot_id_taken' ? 'هذا المعرّف مستخدم بالفعل' : 'تعذر إضافة الميعاد')
    } finally {
      setSaving(false)
    }
  }

  if (error && !slots) return <div className="admin-placeholder-card"><div className="admin-placeholder-note">{error}</div></div>
  if (!slots) return null

  return (
    <div className="admin-form-grid" style={{ marginTop: 16 }}>
      <div className="admin-form-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div className="admin-form-card-title">مواعيد التوصيل</div>
            <div className="admin-form-card-sub">اللي بيشوفهم العميل وقت اختيار ميعاد التوصيل عند الدفع</div>
          </div>
          <button className="admin-category-card-btn" onClick={() => { setShowCreate(v => !v); setFormError('') }}>
            {showCreate ? 'إلغاء' : 'إضافة ميعاد'}
          </button>
        </div>

        {slots.map(slot => (
          <div key={slot.id} className="admin-form-card" style={{ background: '#F7F8F7' }}>
            {editingId === slot.id ? (
              <>
                <label>اسم الميعاد
                  <input value={editForm.label} onChange={e => setEditForm(f => ({ ...f, label: e.target.value }))} />
                </label>
                <label>ملاحظة (اختياري)
                  <input value={editForm.note} onChange={e => setEditForm(f => ({ ...f, note: e.target.value }))} />
                </label>
                <label>الحد الأقصى للطلبات في اليوم (اختياري)
                  <input
                    type="number" min={1} value={editForm.maxOrdersPerDay}
                    onChange={e => setEditForm(f => ({ ...f, maxOrdersPerDay: e.target.value }))}
                    placeholder="بلا حد أقصى"
                  />
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, flexDirection: 'row' }}>
                  <input type="checkbox" checked={editForm.isActive} onChange={e => setEditForm(f => ({ ...f, isActive: e.target.checked }))} />
                  مفعّل (يظهر للعميل)
                </label>
                {formError && <div className="admin-form-error">{formError}</div>}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="admin-form-save" disabled={saving} onClick={saveEdit}>حفظ</button>
                  <button className="admin-category-card-btn" onClick={() => setEditingId(null)}>إلغاء</button>
                </div>
              </>
            ) : (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>
                  <span className="admin-category-card-title">{slot.label}{!slot.isActive && ' (متوقف)'}</span>
                  <span className="admin-category-card-sub">
                    {slot.note || 'بدون ملاحظة'}
                    {slot.maxOrdersPerDay !== null && ` — حد أقصى ${slot.maxOrdersPerDay} طلب/يوم`}
                  </span>
                </span>
                <button className="admin-category-card-btn" onClick={() => startEdit(slot)}>تعديل</button>
              </div>
            )}
          </div>
        ))}

        {showCreate && (
          <div className="admin-form-card" style={{ background: '#F7F8F7' }}>
            <div className="admin-row-2">
              <label>المعرّف (بالإنجليزية)
                <input value={createForm.id} onChange={e => setCreateForm(f => ({ ...f, id: e.target.value }))} placeholder="afternoon" />
              </label>
              <label>اسم الميعاد
                <input value={createForm.label} onChange={e => setCreateForm(f => ({ ...f, label: e.target.value }))} placeholder="بعد الظهر — 1:00 إلى 4:00" />
              </label>
            </div>
            <label>ملاحظة (اختياري)
              <input value={createForm.note} onChange={e => setCreateForm(f => ({ ...f, note: e.target.value }))} />
            </label>
            <label>الحد الأقصى للطلبات في اليوم (اختياري)
              <input
                type="number" min={1} value={createForm.maxOrdersPerDay}
                onChange={e => setCreateForm(f => ({ ...f, maxOrdersPerDay: e.target.value }))}
                placeholder="بلا حد أقصى"
              />
            </label>
            {formError && <div className="admin-form-error">{formError}</div>}
            <button className="admin-form-save" disabled={saving} onClick={createSlot}>حفظ الميعاد</button>
          </div>
        )}
      </div>
    </div>
  )
}

const CALENDAR_WINDOW_DAYS = 30

function DeliveryCalendarSection() {
  const [settings, setSettings] = useState<AdminDeliveryCalendarSettings | null>(null)
  const [draftDaysAhead, setDraftDaysAhead] = useState('7')
  const [draftClosedWeekdays, setDraftClosedWeekdays] = useState<number[]>([])
  const [overrides, setOverrides] = useState<Record<string, AdminDeliveryDateOverride>>({})
  const [error, setError] = useState('')
  const [savingSettings, setSavingSettings] = useState(false)
  const [savingDate, setSavingDate] = useState('')

  const today = todayIso()
  const windowEnd = addDaysIso(today, CALENDAR_WINDOW_DAYS)
  const days = Array.from({ length: CALENDAR_WINDOW_DAYS }, (_, i) => addDaysIso(today, i))

  function load() {
    Promise.all([api.getDeliveryCalendarSettings(), api.listDeliveryDateOverrides(today, windowEnd)])
      .then(([settingsRes, overridesRes]) => {
        setSettings(settingsRes.settings)
        setDraftDaysAhead(String(settingsRes.settings.daysAhead))
        setDraftClosedWeekdays(settingsRes.settings.closedWeekdays)
        setOverrides(Object.fromEntries(overridesRes.overrides.map(o => [o.date, o])))
      })
      .catch(() => setError('تعذر تحميل إعدادات تقويم التوصيل'))
  }

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function toggleWeekday(day: number) {
    setDraftClosedWeekdays(current => current.includes(day) ? current.filter(d => d !== day) : [...current, day])
  }

  async function saveCalendarSettings() {
    const daysAhead = Number(draftDaysAhead)
    if (!Number.isInteger(daysAhead) || daysAhead < 1 || daysAhead > 60) {
      setError('عدد الأيام لازم يكون رقم صحيح بين 1 و60')
      return
    }
    setSavingSettings(true)
    setError('')
    try {
      const { settings: updated } = await api.updateDeliveryCalendarSettings({ daysAhead, closedWeekdays: draftClosedWeekdays })
      setSettings(updated)
    } catch {
      setError('تعذر حفظ إعدادات التقويم')
    } finally {
      setSavingSettings(false)
    }
  }

  async function toggleDateOverride(date: string) {
    const existing = overrides[date]
    const weeklyOpen = settings ? !settings.closedWeekdays.includes(isoWeekday(date)) : true
    const currentlyOpen = existing ? existing.active : weeklyOpen
    setSavingDate(date)
    setError('')
    try {
      if (existing) {
        // إلغاء الاستثناء بالكامل بيرجّع اليوم لقاعدة أيام الأسبوع الافتراضية.
        await api.removeDeliveryDateOverride(date)
        setOverrides(current => { const next = { ...current }; delete next[date]; return next })
      } else {
        // مفيش استثناء لسه — بنعمل واحد جديد بعكس الحالة الحالية (المشتقة من قاعدة الأسبوع).
        const notes = window.prompt('ملاحظة (اختياري) — مثال: عطلة رسمية') ?? ''
        const { override } = await api.setDeliveryDateOverride(date, { active: !currentlyOpen, notes: notes.trim() })
        setOverrides(current => ({ ...current, [date]: override }))
      }
    } catch {
      setError('تعذر تحديث حالة اليوم ده')
    } finally {
      setSavingDate('')
    }
  }

  if (error && !settings) return <div className="admin-placeholder-card"><div className="admin-placeholder-note">{error}</div></div>
  if (!settings) return null

  return (
    <div className="admin-form-grid" style={{ marginTop: 16 }}>
      <div className="admin-form-card">
        <div>
          <div className="admin-form-card-title">مواعيد التوصيل — التقويم</div>
          <div className="admin-form-card-sub">أيام الأسبوع المتاحة افتراضياً، وعدد الأيام القادمة اللي يشوفها العميل عند الدفع</div>
        </div>
        <label>عدد الأيام القادمة المعروضة للعميل
          <input type="number" min={1} max={60} value={draftDaysAhead} onChange={e => setDraftDaysAhead(e.target.value)} style={{ width: 100 }} />
        </label>
        <label>أيام الأسبوع المقفولة افتراضياً (توصيل متوقف فيها كل أسبوع)
          <span className="admin-form-chips" style={{ flexWrap: 'wrap' }}>
            {WEEKDAY_ORDER.map(day => (
              <button
                key={day}
                type="button"
                className={`admin-form-chip ${draftClosedWeekdays.includes(day) ? 'active' : ''}`}
                onClick={() => toggleWeekday(day)}
              >
                {WEEKDAY_LABELS[day]}
              </button>
            ))}
          </span>
        </label>
        {error && <div className="admin-form-error">{error}</div>}
        <button className="admin-form-save" disabled={savingSettings} onClick={saveCalendarSettings}>حفظ إعدادات التقويم</button>
      </div>

      <div className="admin-table-card">
        <div className="admin-table-tools">
          <div className="admin-form-card-title">الأيام القادمة ({CALENDAR_WINDOW_DAYS} يوم)</div>
          <div style={{ color: '#68746B', fontWeight: 600, fontSize: 12 }}>فتح/قفل استثنائي ليوم بعينه — بيتغلّب على قاعدة الأسبوع فوق</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 14, maxHeight: 420, overflowY: 'auto' }}>
          {days.map(date => {
            const weekday = isoWeekday(date)
            const weeklyOpen = !settings.closedWeekdays.includes(weekday)
            const override = overrides[date]
            const effectiveOpen = override ? override.active : weeklyOpen
            const hasOverride = !!override
            return (
              <div
                key={date}
                className="admin-table-row"
                style={{ gridTemplateColumns: '1fr auto auto', alignItems: 'center', gap: 10, background: effectiveOpen ? undefined : '#FFF0EF' }}
              >
                <span style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontWeight: 800, fontSize: 13 }}>{WEEKDAY_LABELS[weekday]} — {date}</span>
                  {hasOverride && <span style={{ fontSize: 11, color: '#8A948C' }}>{override.notes || (override.active ? 'فتح استثنائي' : 'إغلاق استثنائي')}</span>}
                </span>
                <span className="admin-pill" style={{ background: effectiveOpen ? '#EAF8EF' : '#FFF0EF', color: effectiveOpen ? '#12813C' : '#B42318' }}>
                  {effectiveOpen ? 'مفتوح' : 'مقفول'}
                  {hasOverride && ' (استثناء)'}
                </span>
                <button
                  className="admin-category-card-btn"
                  disabled={savingDate === date}
                  onClick={() => toggleDateOverride(date)}
                >
                  {hasOverride ? 'إلغاء الاستثناء' : (effectiveOpen ? 'إغلاق استثنائي' : 'فتح استثنائي')}
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
