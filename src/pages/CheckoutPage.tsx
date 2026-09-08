import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { StickyActionBar } from '../components/StickyActionBar'
import { deliverySlots } from '../data/deliverySlots'
import { governorates } from '../data/governorates'
import { useCart } from '../store/CartContext'
import type { CustomerDetails, DeliverySlotId, Order } from '../types/models'
import { formatMoney } from '../utils/money'
import { buildWhatsAppUrl } from '../utils/order'
import { api, ApiError } from '../utils/api'
import { getSettings } from '../store/settingsStore'
import { isValidEgyptianMobile } from '../utils/phone'
import { ar } from '../i18n/ar'

const initialCustomer: CustomerDetails = { fullName: '', mobile: '', governorate: '', address: '' }

export function CheckoutPage() {
  const navigate = useNavigate()
  const { detailedItems, subtotal, deliveryFee, discount, total, clearCart } = useCart()
  const settings = getSettings()
  const [customer, setCustomer] = useState(initialCustomer)
  const [slot, setSlot] = useState<DeliverySlotId>('now')
  const [touched, setTouched] = useState(false)
  const [apiError, setApiError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const nameValid = customer.fullName.trim().length >= 2 && customer.fullName.trim().length <= 100
  const mobileValid = isValidEgyptianMobile(customer.mobile.trim())
  const governorateValid = customer.governorate.trim().length > 0
  const addressValid = customer.address.trim().length >= 5 && customer.address.trim().length <= 300
  const formValid = nameValid && mobileValid && governorateValid && addressValid

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

  useEffect(() => {
    if (cartWasEmptyOnEntry) navigate('/cart', { replace: true })
  }, [cartWasEmptyOnEntry, navigate])

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
        paymentMethod: 'COD',
        customer,
        items,
        discountCode: discount?.code
      }, idempotencyKey)

      const order = created as unknown as Order
      window.open(buildWhatsAppUrl(order), '_blank', 'noopener,noreferrer')
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
            onChange={e => update('mobile', e.target.value.replace(/[^0-9]/g, '').slice(0, 11))}
            placeholder={ar.checkout.mobilePlaceholder}
            inputMode="numeric"
            autoComplete="tel"
            maxLength={11}
            aria-invalid={!!mobileError}
          />
        </label>
        {mobileError && <div className="field-error">{mobileError}</div>}
        <label>{ar.checkout.governorateLabel}
          <select value={customer.governorate} onChange={e => update('governorate', e.target.value)} aria-invalid={!!governorateError}>
            <option value="" disabled>{ar.checkout.governoratePlaceholder}</option>
            {governorates.map(g => <option key={g} value={g}>{g}</option>)}
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
      </div>

      <div className="form-card">
        <h2>{ar.checkout.deliverySlotTitle}</h2>
        <div className="slot-list">
          {deliverySlots.map(option => (
            <button
              key={option.id}
              className={`slot-option ${slot === option.id ? 'active' : ''}`}
              onClick={() => setSlot(option.id)}
            >
              <span>
                <span className="slot-label">{option.label}</span>
                <span className="slot-note">{option.note}</span>
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
        <div><span>{ar.cart.delivery}</span><span>{deliveryFee ? formatMoney(deliveryFee) : ar.cart.free}</span></div>
        <div className="summary-total"><span>{ar.cart.total}</span><span>{formatMoney(total)}</span></div>
      </div>

      <Link to="/refund-exchange-policy" className="checkout-policy-link">{ar.checkout.policyLink}</Link>

      {touched && !formValid && <div className="form-error-banner">{ar.checkout.formError}</div>}
      {apiError && <div className="form-error-banner">{apiError}</div>}

      <StickyActionBar label={ar.checkout.submit} meta={formatMoney(total)} onClick={submit} disabled={submitting || !settings.codEnabled || !formValid} />
    </div>
  )
}
