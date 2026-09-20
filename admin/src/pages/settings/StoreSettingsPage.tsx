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
            onChange={e => set('whatsappNumber', e.target.value)}
            placeholder="01012345678"
            inputMode="numeric"
            autoComplete="tel"
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
      </div>

      <div className="admin-form-card">
        <div>
          <div className="admin-form-card-title">الولاء والإحالة — الاكتساب</div>
          <div className="admin-form-card-sub">معدّل اكتساب النقاط بعد تسليم الطلب فعلياً، ومكافأة إحالة صديق</div>
        </div>
        <label>نقاط لكل جنيه من قيمة الطلب (بعد خصم رسوم التوصيل)
          <input type="number" step="0.01" min={0} value={form.loyaltyPointsPerEgp} onChange={e => set('loyaltyPointsPerEgp', Number(e.target.value))} />
          <span className="admin-form-help">مثال: 0.1 تعني نقطة واحدة عن كل 10 ج.م</span>
        </label>
        <label>مكافأة إحالة صديق (نقاط تُمنح للمُحيل عند أول طلب فعلي للمُحال)
          <input type="number" min={0} step={1} value={form.referralBonusPoints} onChange={e => set('referralBonusPoints', Math.round(Number(e.target.value)))} />
        </label>
      </div>

      <div className="admin-form-card">
        <div>
          <div className="admin-form-card-title">برنامج الولاء — استبدال النقاط</div>
          <div className="admin-form-card-sub">تفعيل استبدال النقاط بخصم عند الدفع، وقواعد الحد الأدنى والأقصى</div>
        </div>
        <label>الحالة
          <span className="admin-form-chips">
            <button type="button" className={`admin-form-chip ${form.loyaltyEnabled ? 'active' : ''}`} onClick={() => set('loyaltyEnabled', true)}>مفعّل</button>
            <button type="button" className={`admin-form-chip ${!form.loyaltyEnabled ? 'active' : ''}`} onClick={() => set('loyaltyEnabled', false)}>معطّل</button>
          </span>
          <span className="admin-form-help">تعطيل البرنامج لا يحذف أرصدة أو سجل النقاط أو بيانات الإحالة القائمة — بيمنع الاستبدال والمكافآت الجديدة فقط</span>
        </label>
        <label>قيمة النقطة الواحدة (ج.م)
          <input type="number" step="0.0001" min={0} value={form.loyaltyPointValueEgp} onChange={e => set('loyaltyPointValueEgp', Number(e.target.value))} />
          <span className="admin-form-help">مثال: 0.05 تعني كل نقطة = 5 قروش</span>
        </label>
        <label>أقل عدد نقاط يمكن استبداله في الطلب الواحد
          <input type="number" min={0} step={1} value={form.loyaltyMinRedeemPoints} onChange={e => set('loyaltyMinRedeemPoints', Math.round(Number(e.target.value)))} />
        </label>
        <label>أقصى نسبة من قيمة الطلب يمكن تغطيتها بالنقاط (%)
          <input type="number" min={0} max={100} step={1} value={form.loyaltyMaxRedemptionPercent} onChange={e => set('loyaltyMaxRedemptionPercent', Number(e.target.value))} />
        </label>
        <label>أقل قيمة طلب لإتاحة الاستبدال (ج.م)
          <input type="number" min={0} step={1} value={form.loyaltyMinOrderForRedemption} onChange={e => set('loyaltyMinOrderForRedemption', Number(e.target.value))} />
        </label>
      </div>

      <div className="admin-form-card">
        <div>
          <div className="admin-form-card-title">برنامج الولاء — انتهاء الصلاحية</div>
          <div className="admin-form-card-sub">هل تنتهي صلاحية النقاط بعد فترة من اكتسابها؟</div>
        </div>
        <label>الحالة
          <span className="admin-form-chips">
            <button type="button" className={`admin-form-chip ${form.loyaltyExpiryEnabled ? 'active' : ''}`} onClick={() => set('loyaltyExpiryEnabled', true)}>مفعّل</button>
            <button type="button" className={`admin-form-chip ${!form.loyaltyExpiryEnabled ? 'active' : ''}`} onClick={() => set('loyaltyExpiryEnabled', false)}>معطّل</button>
          </span>
        </label>
        <label>مدة الصلاحية (أيام من تاريخ الاكتساب)
          <input type="number" min={0} step={1} value={form.loyaltyExpiryDays} onChange={e => set('loyaltyExpiryDays', Math.round(Number(e.target.value)))} disabled={!form.loyaltyExpiryEnabled} />
        </label>
        <label>مدة التنبيه قبل الانتهاء (أيام)
          <input type="number" min={0} step={1} value={form.loyaltyExpiryWarningDays} onChange={e => set('loyaltyExpiryWarningDays', Math.round(Number(e.target.value)))} disabled={!form.loyaltyExpiryEnabled} />
          <span className="admin-form-help">يظهر للعميل تنبيه بالنقاط اللي هتنتهي قريباً خلال هذه المدة</span>
        </label>
      </div>

      <div className="admin-form-card">
        <div>
          <div className="admin-form-card-title">برنامج الإحالة</div>
          <div className="admin-form-card-sub">مكافأة العميل الجديد المُحال، وشرط الطلب المؤهِّل</div>
        </div>
        <label>الحالة
          <span className="admin-form-chips">
            <button type="button" className={`admin-form-chip ${form.referralEnabled ? 'active' : ''}`} onClick={() => set('referralEnabled', true)}>مفعّل</button>
            <button type="button" className={`admin-form-chip ${!form.referralEnabled ? 'active' : ''}`} onClick={() => set('referralEnabled', false)}>معطّل</button>
          </span>
          <span className="admin-form-help">تعطيل البرنامج يمنع تأهيل إحالات جديدة فقط — لا يؤثر على المكافآت الممنوحة بالفعل</span>
        </label>
        <label>مكافأة العميل الجديد المُحال (نقاط تُمنح له عند أول طلب مؤهِّل)
          <input type="number" min={0} step={1} value={form.referralReferredBonusPoints} onChange={e => set('referralReferredBonusPoints', Math.round(Number(e.target.value)))} />
        </label>
        <label>أقل قيمة طلب لاعتباره طلباً مؤهِّلاً للإحالة (ج.م)
          <input type="number" min={0} step={1} value={form.referralMinQualifyingOrder} onChange={e => set('referralMinQualifyingOrder', Number(e.target.value))} />
        </label>
      </div>

      <div className="admin-form-card">
        <div>
          <div className="admin-form-card-title">حماية الهامش</div>
          <div className="admin-form-card-sub">أقل نسبة هامش مقبولة — أي تحديث سعر أو تكلفة (فردي أو بالجملة) بيحذّر لو الهامش الناتج أقل منها</div>
        </div>
        <label>الحد الأدنى للهامش (%)
          <input type="number" min={0} max={100} step={0.5} value={form.minMarginPercent} onChange={e => set('minMarginPercent', Number(e.target.value))} />
        </label>

        {error && <div className="admin-form-error">{error}</div>}
        {success && <div className="admin-form-success">{success}</div>}
        <button className="admin-form-save" disabled={saving} onClick={save}>حفظ التعديلات</button>
      </div>
    </div>
  )
}
