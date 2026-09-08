import { useEffect, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../store/AuthContext'
import { deliverySlots } from '../data/deliverySlots'
import { formatMoney } from '../utils/money'
import { api, ApiError, type ApiOrder } from '../utils/api'
import { ar } from '../i18n/ar'

export function ConfirmationPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { orderId } = useParams()
  const { user, loading } = useAuth()
  const stateOrder = (location.state as { order?: ApiOrder } | null)?.order ?? null
  const [order, setOrder] = useState<ApiOrder | null>(stateOrder)
  const [error, setError] = useState('')

  useEffect(() => {
    if (stateOrder || loading || !user || !orderId) return
    api.getOrder(orderId)
      .then(({ order }) => setOrder(order))
      .catch(err => setError(err instanceof ApiError ? ar.errors.forCode(err.code) : ar.errors.generic))
  }, [stateOrder, loading, user, orderId])

  if (!order && !error && (loading || (!stateOrder && user))) return null
  if (!stateOrder && !user && !order) return <div className="empty-card">{ar.confirmation.guestDetailsUnavailable}</div>
  if (error || !order) return <div className="empty-card">{error || ar.errors.forCode('order_not_found')}</div>

  const slot = deliverySlots.find(s => s.id === order.deliverySlot)?.label ?? ''

  return (
    <div className="confirmation-page">
      <div className="success-icon">
        <svg width="42" height="42" viewBox="0 0 24 24" fill="none"><path d="M4 12.5l5.2 5L20 6.5" stroke="#16A34A" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </div>
      <h1>{ar.confirmation.title}</h1>
      <p>{ar.confirmation.phoneNote(order.customer.mobile)}</p>

      <div className="order-id-card">
        <div><div className="order-id-label">{ar.confirmation.orderNumber}</div><div className="order-id-value">{order.id}</div></div>
        <div><div className="order-id-label">{ar.confirmation.expectedDelivery}</div><div className="order-id-value small">{slot}</div></div>
      </div>

      <div className="invoice-card">
        <h2>{ar.confirmation.invoiceTitle}</h2>
        {order.items.map(item => (
          <div className="invoice-line" key={item.productId}>
            <span>{item.name} × {item.quantity}</span>
            <span>{formatMoney(item.lineTotal)}</span>
          </div>
        ))}
        <hr />
        {order.discountCode && (
          <div className="invoice-line"><span>{ar.cart.discountApplied(order.discountCode)}</span><span>-{formatMoney(order.discountAmount)}</span></div>
        )}
        <div className="invoice-line"><span>{ar.confirmation.delivery}</span><span>{order.deliveryFee ? formatMoney(order.deliveryFee) : ar.cart.free}</span></div>
        <div className="invoice-line invoice-total"><span>{ar.confirmation.totalCash}</span><span>{formatMoney(order.total)}</span></div>
      </div>

      {user && <button className="primary-button" onClick={() => navigate(`/track/${order.id}`)}>{ar.confirmation.trackOrder}</button>}
      <button className="secondary-button" onClick={() => navigate('/')}>{ar.confirmation.backHome}</button>

      <div className="whatsapp-note">
        <span>💬</span>
        <span>{ar.confirmation.whatsappNote}</span>
      </div>
    </div>
  )
}
