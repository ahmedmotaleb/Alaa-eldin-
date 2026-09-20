import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useAuth } from '../store/AuthContext'
import { useToast } from '../store/ToastContext'
import { getGuestTrackingToken } from '../utils/guestTracking'
import { getSettings } from '../store/settingsStore'
import { formatMoney } from '../utils/money'
import { formatDate } from '../utils/format'
import { api, ApiError, type ApiOrder } from '../utils/api'
import { ar } from '../i18n/ar'

type OrderStatus = ApiOrder['status']

export function ReceiptPage() {
  const { orderNumber } = useParams()
  const [searchParams] = useSearchParams()
  const { user, loading: authLoading } = useAuth()
  const showToast = useToast()
  const [order, setOrder] = useState<ApiOrder | null>(null)
  const [error, setError] = useState('')
  const settings = getSettings()

  // نفس آلية تتبّع الزائر بالظبط المستخدمة في صفحة التتبّع — توكن عشوائي عالي الإنتروبي، مش
  // رقم الطلب الخام، وبيوصل إما من رابط ?t= مباشر أو من نسخة محفوظة محلياً من زيارة سابقة.
  const guestToken = searchParams.get('t') || (orderNumber ? getGuestTrackingToken(orderNumber) : null)

  useEffect(() => {
    if (authLoading || !orderNumber) return
    if (!user && !guestToken) return
    const request = user ? api.getOrder(orderNumber) : api.trackGuestOrder(orderNumber, guestToken!)
    request
      .then(({ order }) => setOrder(order))
      .catch(err => setError(err instanceof ApiError ? ar.errors.forCode(err.code) : ar.errors.generic))
  }, [user, authLoading, orderNumber, guestToken])

  if (authLoading) return null
  if (!user && !guestToken) return <div className="empty-card">{ar.receipt.loginRequired}</div>
  if (error) return <div className="empty-card">{error}</div>
  if (!order) return null

  async function share() {
    const url = window.location.href
    if (navigator.share) {
      try {
        await navigator.share({ title: ar.receipt.shareTitle(order!.orderNumber), url })
      } catch {
        // المستخدم لغى المشاركة — مفيش داعي لأي رسالة خطأ
      }
      return
    }
    try {
      await navigator.clipboard.writeText(url)
      showToast(ar.receipt.linkCopied)
    } catch {
      // لا شيء إضافي ممكن نعمله لو الحافظة نفسها مش متاحة
    }
  }

  return (
    <div className="receipt-page">
      <div className="receipt-card">
        <div className="receipt-header">
          <div className="receipt-store-name">{settings.name}</div>
          <div className="receipt-title">{ar.receipt.title}</div>
        </div>

        <div className="receipt-meta">
          <div><span>{ar.receipt.orderNumberLabel}</span><span>{order.orderNumber}</span></div>
          <div><span>{ar.receipt.orderDateLabel}</span><span>{formatDate(order.createdAt)}</span></div>
          {order.deliveryDate && (
            <div><span>{ar.receipt.deliveryDateLabel}</span><span>{formatDate(order.deliveryDate, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })}</span></div>
          )}
          <div><span>{ar.receipt.customerLabel}</span><span>{order.customer.fullName}</span></div>
          <div><span>{ar.receipt.statusLabel}</span><span>{ar.receipt.statusValues[order.status as OrderStatus]}</span></div>
          <div><span>{ar.receipt.paymentMethodLabel}</span><span>{ar.receipt.cashOnDelivery}</span></div>
        </div>

        <div className="receipt-items">
          <div className="receipt-items-title">{ar.receipt.itemsTitle}</div>
          {order.items.map(item => {
            const fulfilledQty = item.pickedStatus === 'unavailable' ? 0 : item.quantity
            return (
              <div className="receipt-item-row" key={item.productId}>
                <div className="receipt-item-main">
                  <span className="receipt-item-name">{item.name}</span>
                  {item.pickedStatus === 'substituted' && <span className="receipt-item-badge substituted">{ar.receipt.substitutedBadge}</span>}
                  {item.pickedStatus === 'unavailable' && <span className="receipt-item-badge unavailable">{ar.receipt.unavailableBadge}</span>}
                </div>
                <div className="receipt-item-details">
                  <span>{ar.receipt.quantityShort}: {fulfilledQty}{fulfilledQty !== item.quantity ? ` / ${item.quantity}` : ''}</span>
                  <span>{formatMoney(item.unitPrice)}</span>
                  <span className="receipt-item-line-total">{formatMoney(item.lineTotal)}</span>
                </div>
                {item.pickedNote && <div className="receipt-item-note">{item.pickedNote}</div>}
              </div>
            )
          })}
        </div>

        <div className="receipt-totals">
          <div><span>{ar.receipt.subtotalLabel}</span><span>{formatMoney(order.subtotal)}</span></div>
          {order.discountCode && (
            <div className="receipt-discount"><span>{ar.receipt.discountLabel(order.discountCode)}</span><span>-{formatMoney(order.discountAmount)}</span></div>
          )}
          {order.loyaltyPointsRedeemed > 0 && (
            <div className="receipt-discount"><span>{ar.receipt.loyaltyDiscountLabel}</span><span>-{formatMoney(order.loyaltyDiscountAmount)}</span></div>
          )}
          <div><span>{ar.receipt.deliveryFeeLabel}</span><span>{order.deliveryFee ? formatMoney(order.deliveryFee) : ar.receipt.freeLabel}</span></div>
          <div className="receipt-grand-total"><span>{ar.receipt.totalLabel}</span><span>{formatMoney(order.total)}</span></div>
          {order.loyaltyPointsRedeemed > 0 && (
            <div className="receipt-loyalty-note">{ar.receipt.loyaltyPointsUsedNote(String(order.loyaltyPointsRedeemed))}</div>
          )}
        </div>

      </div>

      <div className="receipt-actions no-print">
        <button className="secondary-button" onClick={() => window.print()}>{ar.receipt.printButton}</button>
        <button className="secondary-button" onClick={share}>{ar.receipt.shareButton}</button>
      </div>
    </div>
  )
}
