import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { STORE_CONFIG } from '../config/store'
import { useCart } from '../store/CartContext'
import type { CustomerDetails, DeliverySlot, Order } from '../types/models'
import { buildWhatsAppUrl, createOrderId } from '../utils/order'

const initialCustomer: CustomerDetails = {
  fullName: '',
  mobile: '',
  area: '',
  address: '',
  landmark: '',
  notes: ''
}

export function CheckoutPage() {
  const navigate = useNavigate()
  const { detailedItems, subtotal, deliveryFee, total, clearCart } = useCart()
  const [customer, setCustomer] = useState(initialCustomer)
  const [deliverySlot, setDeliverySlot] = useState<DeliverySlot>('أقرب وقت')
  const [error, setError] = useState('')

  function update<K extends keyof CustomerDetails>(key: K, value: CustomerDetails[K]) {
    setCustomer(current => ({ ...current, [key]: value }))
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    setError('')

    if (subtotal < STORE_CONFIG.minimumOrder) {
      setError('الطلب أقل من الحد الأدنى المسموح.')
      return
    }
    if (!customer.fullName.trim() || !customer.area.trim() || !customer.address.trim()) {
      setError('يرجى إكمال الاسم والمنطقة والعنوان.')
      return
    }
    if (!/^01\d{9}$/.test(customer.mobile)) {
      setError('رقم الموبايل يجب أن يكون 11 رقم ويبدأ بـ 01.')
      return
    }

    const order: Order = {
      id: createOrderId(),
      createdAt: new Date().toISOString(),
      customer,
      deliverySlot,
      paymentMethod: 'الدفع عند الاستلام',
      items: detailedItems.map(item => ({
        productId: item.product.id,
        name: item.product.name,
        unit: item.product.unit,
        unitPrice: item.product.price,
        quantity: item.quantity,
        lineTotal: item.product.price * item.quantity
      })),
      subtotal,
      deliveryFee,
      total
    }

    localStorage.setItem('alaa-eldin-last-order', JSON.stringify(order))
    const whatsappUrl = buildWhatsAppUrl(order)
    window.open(whatsappUrl, '_blank', 'noopener,noreferrer')
    clearCart()
    navigate(`/confirmation/${order.id}`)
  }

  return (
    <section>
      <div className="page-title">
        <h1>إتمام الطلب</h1>
        <p>أكمل بيانات التوصيل ثم أرسل الطلب عبر واتساب.</p>
      </div>

      <form className="checkout-form" onSubmit={submit}>
        <div className="form-card">
          <h2>بيانات التوصيل</h2>
          <label>الاسم الكامل<input value={customer.fullName} onChange={e => update('fullName', e.target.value)} /></label>
          <label>رقم الموبايل<input inputMode="numeric" maxLength={11} value={customer.mobile} onChange={e => update('mobile', e.target.value.replace(/\D/g, ''))} placeholder="01*********" /></label>
          <label>المنطقة<input value={customer.area} onChange={e => update('area', e.target.value)} /></label>
          <label>العنوان التفصيلي<textarea rows={3} value={customer.address} onChange={e => update('address', e.target.value)} /></label>
          <label>علامة مميزة<input value={customer.landmark} onChange={e => update('landmark', e.target.value)} /></label>
          <label>ملاحظات<textarea rows={3} value={customer.notes} onChange={e => update('notes', e.target.value)} /></label>
        </div>

        <div className="form-card">
          <h2>موعد التوصيل</h2>
          {(['أقرب وقت', 'اليوم مساءً', 'غداً صباحاً'] as DeliverySlot[]).map(slot => (
            <label className="radio-row" key={slot}>
              <input type="radio" checked={deliverySlot === slot} onChange={() => setDeliverySlot(slot)} />
              <span>{slot}</span>
            </label>
          ))}
        </div>

        <div className="form-card">
          <h2>الدفع</h2>
          <label className="radio-row locked">
            <input type="radio" checked readOnly />
            <span>الدفع عند الاستلام (كاش)</span>
          </label>
        </div>

        {error && <div className="alert warning">{error}</div>}

        <button className="primary-button" type="submit">
          تأكيد الطلب وإرسال عبر واتساب
        </button>
      </form>
    </section>
  )
}
