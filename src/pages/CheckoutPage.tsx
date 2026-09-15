import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { StickyActionBar } from '../components/StickyActionBar'
import { useCart } from '../store/CartContext'
import { useAuth } from '../store/AuthContext'
import { useCatalog } from '../store/CatalogContext'
import type { CustomerDetails, Order } from '../types/models'
import { formatMoney } from '../utils/money'
import { buildWhatsAppUrl } from '../utils/order'
import { api, ApiError, type ApiAddress, type ApiDeliveryDayAvailability } from '../utils/api'
import { getSettings } from '../store/settingsStore'
import { isValidEgyptianMobile } from '../utils/phone'
import { ar } from '../i18n/ar'

// اسم اليوم ورقمه بيتاستخرجوا مباشرة من نص التاريخ (YYYY-MM-DD) من غير المرور بـ
// Date().toLocaleString أو أي حساب بيعتمد على توقيت جهاز العميل نفسه — ده بيضمن نفس اليوم
// اللي السيرفر قصده بالظبط (بتوقيت القاهرة)، وبيضمن كمان إن الأرقام تفضل غربية دايماً
// (مجرد جزء من النص الأصلي، مش تنسيق محلي ممكن يرجّع أرقام هندية).
function isoWeekdayIndex(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number)
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return day === 0 ? 6 : day - 1
}

function dayNumberOf(dateStr: string): string {
  return String(Number(dateStr.slice(8, 10)))
}

// أول عنصر في القايمة هو "النهاردة" وتاني عنصر "بكرة" دايماً — لأن السيرفر بيرجّع النافذة
// مبتدئة من تاريخ النهاردة بتوقيت القاهرة نفسه (راجع GET /api/delivery/availability)، فمفيش
// داعي نقارن بتاريخ جهاز العميل (ممكن يكون غلط أو منطقة زمنية مختلفة أثناء السفر مثلاً).
function dateChipLabel(dateStr: string, index: number): string {
  if (index === 0) return ar.checkout.deliveryDateToday
  if (index === 1) return ar.checkout.deliveryDateTomorrow
  return ar.checkout.deliveryDateWeekdayShort[isoWeekdayIndex(dateStr)]
}

// بيبني سطر عنوان واحد من الحقول المنفصلة للعنوان المحفوظ — الطلب نفسه لسه بياخد سطر
// عنوان واحد بس (نفس شكل الدفع الحالي)، من غير ما نغيّر شكل بيانات الطلب.
function addressLine(a: ApiAddress): string {
  const extra = [a.building && `عمارة ${a.building}`, a.floor && `دور ${a.floor}`, a.apartment && `شقة ${a.apartment}`, a.landmark]
    .filter(Boolean)
    .join('، ')
  const areaLine = a.area ? `${a.area}، ${a.address}` : a.address
  return extra ? `${areaLine} (${extra})` : areaLine
}

const initialCustomer: CustomerDetails = { fullName: '', mobile: '', governorate: '', address: '' }

export function CheckoutPage() {
  const navigate = useNavigate()
  const { detailedItems, hasBlockingIssues, subtotal, deliveryFee, discount, clearCart } = useCart()
  const { user } = useAuth()
  const { deliveryZones, deliverySlots } = useCatalog()
  const settings = getSettings()
  const [customer, setCustomer] = useState(initialCustomer)
  const [deliveryInstructions, setDeliveryInstructions] = useState('')
  const [availability, setAvailability] = useState<ApiDeliveryDayAvailability[] | null>(null)
  const [availabilityError, setAvailabilityError] = useState('')
  const [selectedDate, setSelectedDate] = useState('')
  const [slot, setSlot] = useState('')
  const [touched, setTouched] = useState(false)
  const [apiError, setApiError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [addresses, setAddresses] = useState<ApiAddress[]>([])
  const [selectedAddressId, setSelectedAddressId] = useState<string>('new')

  // العميل المسجّل بيشوف عناوينه المحفوظة كخيارات جاهزة (الافتراضي مُختار أوتوماتيك)، مع
  // خيار "عنوان جديد" دايماً متاح — العميل الزائر يفضل يستخدم الحقول العادية زي ما هي.
  useEffect(() => {
    if (!user) return
    api.listAddresses().then(({ addresses: list }) => {
      setAddresses(list)
      const defaultAddress = list.find(a => a.isDefault)
      if (defaultAddress) {
        setSelectedAddressId(defaultAddress.id)
        setCustomer({
          fullName: defaultAddress.fullName || user.fullName,
          mobile: defaultAddress.mobile || user.mobile || '',
          governorate: defaultAddress.governorate,
          address: addressLine(defaultAddress)
        })
      }
    }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  function pickAddress(id: string) {
    setSelectedAddressId(id)
    if (id === 'new') {
      setCustomer(initialCustomer)
      return
    }
    const address = addresses.find(a => a.id === id)
    if (!address) return
    setCustomer({
      fullName: address.fullName || user?.fullName || '',
      mobile: address.mobile || user?.mobile || '',
      governorate: address.governorate,
      address: addressLine(address)
    })
  }

  // رسوم التوصيل الفعلية بتختلف حسب المحافظة المختارة — قبل ما العميل يختار محافظة بيتعرض
  // التقدير العام من السلة، وبعد الاختيار بيتحدّث فوراً برسوم المنطقة الحقيقية (لسه السيرفر
  // هو اللي بيحسب ويثبّت الرقم الفعلي وقت إرسال الطلب).
  const zoneFee = deliveryZones.find(z => z.governorate === customer.governorate)?.deliveryFee
  const previewDeliveryFee = zoneFee !== undefined
    ? (subtotal === 0 || subtotal >= settings.freeShippingThreshold ? 0 : zoneFee)
    : deliveryFee
  const previewTotal = Math.max(0, subtotal - (discount?.amount ?? 0)) + previewDeliveryFee

  const nameValid = customer.fullName.trim().length >= 2 && customer.fullName.trim().length <= 100
  const mobileValid = isValidEgyptianMobile(customer.mobile.trim())
  const governorateValid = customer.governorate.trim().length > 0
  const addressValid = customer.address.trim().length >= 5 && customer.address.trim().length <= 300
  const selectedDay = availability?.find(d => d.date === selectedDate)
  const slotValid = !!selectedDay?.slots.find(s => s.id === slot && s.available)
  const formValid = nameValid && mobileValid && governorateValid && addressValid && slotValid

  const nameError = touched && !nameValid ? ar.checkout.nameError : ''
  const mobileError = touched && !customer.mobile.trim()
    ? ar.checkout.mobileRequiredError
    : touched && !mobileValid ? ar.checkout.mobileInvalidError : ''
  const governorateError = touched && !governorateValid ? ar.checkout.governorateError : ''
  const addressError = touched && !addressValid ? ar.checkout.addressError : ''
  const [cartWasEmptyOnEntry] = useState(() => detailedItems.length === 0)
  // ثابت طول محاولة الدفع دي (حتى لو submit() اتنادت أكتر من مرة بسبب retry/timeout) —
  // عشان لو نفس الطلب وصل السيرفر فعلاً قبل كده، يرجع نفس الطلب بدل ما يتكرر (idempotency).
  const [idempotencyKey] = useState(() => crypto.randomUUID())

  // لو العميل رجع للـ checkout مباشرة (زر الرجوع/رابط محفوظ) وفي السلة عنصر بقى غير متاح
  // أو الكمية بقت أكتر من المتاح — نرجّعه للسلة عشان يحل المشكلة الأول، مش نسيبه يكمل دفع
  // بمنتج مش هيتشحن فعلياً.
  useEffect(() => {
    if (cartWasEmptyOnEntry || hasBlockingIssues) navigate('/cart', { replace: true })
  }, [cartWasEmptyOnEntry, hasBlockingIssues, navigate])

  // بنجيب تقويم مواعيد التوصيل الحقيقي من السيرفر مرة واحدة عند فتح الصفحة — الأيام المقفولة
  // أو الممتلئة بالكامل بتوصل هنا بنفس الحالة، والسيرفر برضه هو اللي بيتأكد فعلياً وقت الدفع
  // (العرض هنا تجربة استخدام بس، مش مصدر الحقيقة).
  useEffect(() => {
    let cancelled = false
    api.getDeliveryAvailability().then(({ days }) => {
      if (cancelled) return
      setAvailability(days)
      const firstOpenDay = days.find(d => d.open && d.slots.some(s => s.available))
      if (firstOpenDay) {
        setSelectedDate(firstOpenDay.date)
        setSlot(firstOpenDay.slots.find(s => s.available)!.id)
      }
    }).catch(() => {
      if (!cancelled) setAvailabilityError(ar.checkout.deliveryDateLoadError)
    })
    return () => { cancelled = true }
  }, [])

  // لو العميل غيّر يوم التوصيل، أو التقويم لسه بيتحمّل، بنعيد اختيار الميعاد المناسب لليوم
  // الجديد ده تلقائياً لو الميعاد الحالي مش متاح فيه (بدل ما نسيبه محتفظ بميعاد يوم تاني).
  useEffect(() => {
    if (!availability) return
    const day = availability.find(d => d.date === selectedDate)
    const current = day?.slots.find(s => s.id === slot)
    if (!current || !current.available) {
      const firstAvailable = day?.slots.find(s => s.available)
      setSlot(firstAvailable?.id ?? '')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, availability])

  function update<K extends keyof CustomerDetails>(key: K, value: CustomerDetails[K]) {
    setCustomer(current => ({ ...current, [key]: value }))
  }

  async function submit() {
    if (!settings.codEnabled) return
    setTouched(true)
    if (!formValid) return

    setApiError('')
    setSubmitting(true)

    // السيرفر هو اللي بيحسب سعر الوحدة/الإجمالي الفرعي/الخصم/التوصيل/الإجمالي النهائي فعلياً —
    // بيبعت هنا بس المنتج والكمية، ومفيش أي قيمة فلوس بنثق فيها من الطرف ده.
    const items = detailedItems.map(item => ({
      productId: item.product.id,
      quantity: item.quantity
    }))

    try {
      const { order: created } = await api.createOrder({
        deliverySlot: slot,
        deliveryDate: selectedDate,
        paymentMethod: 'COD',
        customer,
        items,
        discountCode: discount?.code,
        deliveryInstructions: deliveryInstructions.trim() || undefined
      }, idempotencyKey)

      const order = created as unknown as Order
      window.open(buildWhatsAppUrl(order, deliverySlots), '_blank', 'noopener,noreferrer')
      clearCart()
      navigate(`/confirmation/${order.orderNumber}`, { state: { order } })
    } catch (err) {
      setApiError(err instanceof ApiError ? ar.errors.forCode(err.code) : ar.errors.generic)
      setSubmitting(false)
    }
  }

  return (
    <div className="checkout-page">
      <div className="checkout-steps">
        {ar.checkout.steps.map((label, i) => (
          <div className={`checkout-step ${i <= 1 ? 'active' : ''}`} key={label}>
            <div className="checkout-step-bar" />
            <div className="checkout-step-label">{label}</div>
          </div>
        ))}
      </div>

      {user && addresses.length > 0 && (
        <div className="form-card">
          <h2>{ar.checkout.savedAddressTitle}</h2>
          <div className="saved-address-list">
            {addresses.map(a => (
              <button
                key={a.id}
                type="button"
                className={`saved-address-option ${selectedAddressId === a.id ? 'active' : ''}`}
                onClick={() => pickAddress(a.id)}
              >
                <span className="saved-address-label">{a.label || a.governorate}{a.isDefault && ` · ${ar.addresses.defaultBadge}`}</span>
                <span className="saved-address-preview">{addressLine(a)}</span>
              </button>
            ))}
            <button
              type="button"
              className={`saved-address-option ${selectedAddressId === 'new' ? 'active' : ''}`}
              onClick={() => pickAddress('new')}
            >
              <span className="saved-address-label">{ar.checkout.newAddressOption}</span>
            </button>
          </div>
        </div>
      )}

      <div className="form-card">
        <h2>{ar.checkout.deliveryInfoTitle}</h2>
        <label>{ar.checkout.fullNameLabel}
          <input
            value={customer.fullName}
            onChange={e => update('fullName', e.target.value)}
            placeholder={ar.checkout.fullNamePlaceholder}
            maxLength={100}
            aria-invalid={!!nameError}
          />
        </label>
        {nameError && <div className="field-error">{nameError}</div>}
        <label>{ar.checkout.mobileLabel}
          <input
            value={customer.mobile}
            // بنحتفظ بالرقم اللي المستخدم كتبه بالظبط من غير أي قص أو تعديل صامت — لو الرقم
            // غلط (طويل، حروف، مسافات...) بيظهر له خطأ واضح بدل ما نحوّله بصمت لرقم تاني
            // (زي قص 010123456789 لـ 01012345678 من غير ما يعرف).
            onChange={e => update('mobile', e.target.value)}
            placeholder={ar.checkout.mobilePlaceholder}
            inputMode="numeric"
            autoComplete="tel"
            aria-invalid={!!mobileError}
          />
        </label>
        {mobileError && <div className="field-error">{mobileError}</div>}
        <label>{ar.checkout.governorateLabel}
          <select value={customer.governorate} onChange={e => update('governorate', e.target.value)} aria-invalid={!!governorateError}>
            <option value="" disabled>{ar.checkout.governoratePlaceholder}</option>
            {deliveryZones.map(z => <option key={z.governorate} value={z.governorate}>{z.governorate}</option>)}
          </select>
        </label>
        {governorateError && <div className="field-error">{governorateError}</div>}
        <label>{ar.checkout.addressLabel}
          <input
            value={customer.address}
            onChange={e => update('address', e.target.value)}
            placeholder={ar.checkout.addressPlaceholder}
            maxLength={300}
            aria-invalid={!!addressError}
          />
        </label>
        {addressError && <div className="field-error">{addressError}</div>}
        <label>{ar.checkout.deliveryInstructionsLabel}
          <textarea
            value={deliveryInstructions}
            onChange={e => setDeliveryInstructions(e.target.value)}
            placeholder={ar.checkout.deliveryInstructionsPlaceholder}
            maxLength={300}
            rows={2}
          />
        </label>
      </div>

      <div className="form-card">
        <h2>{ar.checkout.deliveryDateTitle}</h2>
        {availabilityError && <div className="field-error">{availabilityError}</div>}
        <div className="date-chip-row">
          {availability?.map((day, i) => (
            <button
              key={day.date}
              type="button"
              className={`date-chip ${selectedDate === day.date ? 'active' : ''}`}
              disabled={!day.open || !day.slots.some(s => s.available)}
              onClick={() => setSelectedDate(day.date)}
            >
              <span className="date-chip-weekday">{dateChipLabel(day.date, i)}</span>
              <span className="date-chip-day">{dayNumberOf(day.date)}</span>
              {(!day.open || !day.slots.some(s => s.available)) && (
                <span className="date-chip-note">{!day.open ? ar.checkout.deliveryDateClosed : ar.checkout.deliveryDateFullyBooked}</span>
              )}
            </button>
          ))}
        </div>

        <h2>{ar.checkout.deliverySlotTitle}</h2>
        {!selectedDate && <div className="field-error">{ar.checkout.deliverySlotPickDateFirst}</div>}
        <div className="slot-list">
          {(selectedDay?.slots ?? []).map(option => (
            <button
              key={option.id}
              className={`slot-option ${slot === option.id ? 'active' : ''}`}
              disabled={!option.available}
              onClick={() => option.available && setSlot(option.id)}
            >
              <span>
                <span className="slot-label">{option.label}</span>
                <span className="slot-note">{option.available ? option.note : ar.checkout.deliverySlotFull}</span>
              </span>
              <span className="slot-dot" />
            </button>
          ))}
        </div>
      </div>

      <div className="form-card">
        <h2>{ar.checkout.paymentTitle}</h2>
        <div className={`payment-option ${settings.codEnabled ? 'active' : 'disabled'}`}>
          <span className="payment-icon">💵</span>
          <span><span className="payment-label">{ar.checkout.cashOnDelivery}</span><span className="payment-note">{settings.codEnabled ? ar.checkout.cashOnDeliveryNote : ar.checkout.codDisabledNotice}</span></span>
          {settings.codEnabled && <span className="payment-dot" />}
        </div>
        <div className="payment-option disabled">
          <span className="payment-icon">💳</span>
          <span><span className="payment-label">{ar.checkout.cardPayment}</span><span className="payment-note">{ar.checkout.comingSoon}</span></span>
        </div>
      </div>

      <div className="summary-card">
        <div><span>{ar.checkout.orderSummaryItemsCount(detailedItems.reduce((sum, i) => sum + i.quantity, 0))}</span><span>{formatMoney(subtotal)}</span></div>
        {discount && <div className="summary-discount"><span>{ar.cart.discountApplied(discount.code)}</span><span>-{formatMoney(discount.amount)}</span></div>}
        <div><span>{ar.cart.delivery}</span><span>{previewDeliveryFee ? formatMoney(previewDeliveryFee) : ar.cart.free}</span></div>
        <div className="summary-total"><span>{ar.cart.total}</span><span>{formatMoney(previewTotal)}</span></div>
      </div>

      <Link to="/refund-exchange-policy" className="checkout-policy-link">{ar.checkout.policyLink}</Link>

      {touched && !formValid && <div className="form-error-banner">{ar.checkout.formError}</div>}
      {apiError && <div className="form-error-banner">{apiError}</div>}

      <StickyActionBar label={ar.checkout.submit} meta={formatMoney(previewTotal)} onClick={submit} disabled={submitting || !settings.codEnabled || !formValid} />
    </div>
  )
}
