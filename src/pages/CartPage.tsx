import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ProductArt } from '../components/ProductArt'
import { StickyActionBar } from '../components/StickyActionBar'
import { getSettings } from '../store/settingsStore'
import { useCart } from '../store/CartContext'
import { useToast } from '../store/ToastContext'
import { formatMoney } from '../utils/money'
import { ApiError } from '../utils/api'
import { ar } from '../i18n/ar'

export function CartPage() {
  const navigate = useNavigate()
  const { detailedItems, hasBlockingIssues, subtotal, deliveryFee, discount, total, setQuantity, removeItem, applyDiscount, removeDiscount } = useCart()
  const flash = useToast()
  const [discountInput, setDiscountInput] = useState('')
  const [discountApplying, setDiscountApplying] = useState(false)
  const [discountError, setDiscountError] = useState('')

  async function submitDiscount() {
    if (!discountInput.trim()) return
    setDiscountApplying(true)
    setDiscountError('')
    try {
      await applyDiscount(discountInput.trim())
      setDiscountInput('')
    } catch (err) {
      if (err instanceof ApiError && err.code === 'discount_min_order' && typeof err.data.minOrder === 'number') {
        setDiscountError(ar.errors.discountMinOrder(formatMoney(err.data.minOrder)))
      } else {
        setDiscountError(err instanceof ApiError ? ar.errors.forCode(err.code) : ar.errors.generic)
      }
    } finally {
      setDiscountApplying(false)
    }
  }

  const settings = getSettings()
  const belowMinimum = subtotal > 0 && subtotal < settings.minimumOrder
  const remainingForFree = Math.max(0, settings.freeShippingThreshold - subtotal)
  const freeProgress = Math.min(100, Math.round((subtotal / settings.freeShippingThreshold) * 100))

  const shippingCopy = detailedItems.length === 0
    ? ar.cart.startOrderForFreeShipping(formatMoney(settings.freeShippingThreshold))
    : remainingForFree === 0
      ? ar.cart.freeShippingEarned
      : ar.cart.remainingForFreeShipping(formatMoney(remainingForFree))

  if (!detailedItems.length) {
    return (
      <div className="empty-card cart-empty">
        <div className="empty-icon">🛒</div>
        <h2>{ar.cart.emptyTitle}</h2>
        <p>{ar.cart.emptyNote}</p>
        <button className="primary-button" onClick={() => navigate('/')}>{ar.cart.shopNow}</button>
      </div>
    )
  }

  return (
    <div className="cart-page">
      <div className="shipping-progress-card">
        <div className="shipping-copy">{shippingCopy}</div>
        <div className="progress-track"><div className="progress-fill" style={{ width: `${freeProgress}%` }} /></div>
      </div>

      <div className="cart-list">
        {detailedItems.map(item => (
          <article className={`cart-item ${item.blockingIssue ? 'has-issue' : ''}`} key={item.productId}>
            <ProductArt product={item.product} height={64} width={64} fontSize={30} radius={16} showBadge={false} showUnavailable={false} />
            <div className="cart-item-content">
              <strong>{item.product.name}</strong>
              <span>{item.product.unit} · {formatMoney(item.product.price)}</span>
              <div className="cart-item-footer">
                <div className="bordered-stepper">
                  <button onClick={() => setQuantity(item.productId, item.quantity - 1)} aria-label={ar.common.decreaseQty}>−</button>
                  <span>{item.quantity}</span>
                  <button onClick={() => setQuantity(item.productId, item.quantity + 1)} aria-label={ar.common.increaseQty}>+</button>
                </div>
                <span className="cart-item-line-total">{formatMoney(item.product.price * item.quantity)}</span>
              </div>
              {item.blockingIssue === 'unavailable' && <span className="cart-item-issue">{ar.cart.itemUnavailable}</span>}
              {item.blockingIssue === 'insufficient_stock' && typeof item.product.lowStockRemaining === 'number' && (
                <span className="cart-item-issue">{ar.cart.itemInsufficientStock(item.product.lowStockRemaining)}</span>
              )}
            </div>
            <button className="delete-button" onClick={() => removeItem(item.productId)} aria-label={ar.common.remove(item.product.name)}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="M4 7h16M9.5 7V5h5v2M6.5 7l1 13h9l1-13" stroke="#B42318" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          </article>
        ))}
      </div>

      {belowMinimum && (
        <div className="min-order-banner">
          {ar.cart.minOrderBanner(formatMoney(settings.minimumOrder), formatMoney(settings.minimumOrder - subtotal))}
        </div>
      )}

      <div className="discount-card">
        {discount ? (
          <div className="discount-applied-row">
            <span className="discount-applied-label">{ar.cart.discountApplied(discount.code)}</span>
            <button className="discount-remove-btn" onClick={removeDiscount}>{ar.cart.discountRemove}</button>
          </div>
        ) : (
          <div className="discount-input-row">
            <input
              value={discountInput}
              onChange={e => setDiscountInput(e.target.value)}
              placeholder={ar.cart.discountCodePlaceholder}
              onKeyDown={e => { if (e.key === 'Enter') submitDiscount() }}
            />
            <button className="discount-apply-btn" onClick={submitDiscount} disabled={discountApplying || !discountInput.trim()}>
              {discountApplying ? ar.cart.discountApplying : ar.cart.discountApply}
            </button>
          </div>
        )}
        {discountError && <div className="discount-error">{discountError}</div>}
      </div>

      <div className="summary-card">
        <div><span>{ar.cart.subtotal}</span><span>{formatMoney(subtotal)}</span></div>
        {discount && <div className="summary-discount"><span>{ar.cart.discount}</span><span>-{formatMoney(discount.amount)}</span></div>}
        <div><span>{ar.cart.delivery}</span><span>{deliveryFee ? formatMoney(deliveryFee) : ar.cart.free}</span></div>
        <div className="summary-total"><span>{ar.cart.total}</span><span>{formatMoney(total)}</span></div>
      </div>

      <StickyActionBar
        label={hasBlockingIssues ? ar.cart.resolveIssuesCta : subtotal < settings.minimumOrder ? ar.cart.minOrderCta(formatMoney(settings.minimumOrder)) : ar.cart.checkout}
        meta={hasBlockingIssues ? undefined : formatMoney(total)}
        muted={hasBlockingIssues || subtotal < settings.minimumOrder}
        onClick={() => {
          if (hasBlockingIssues) return
          if (subtotal < settings.minimumOrder) {
            flash(ar.cart.minOrderToast(formatMoney(settings.minimumOrder)))
            return
          }
          navigate('/checkout')
        }}
      />
    </div>
  )
}
