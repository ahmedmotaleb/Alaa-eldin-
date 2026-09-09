import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../store/AuthContext'
import { useCart } from '../store/CartContext'
import { useToast } from '../store/ToastContext'
import { api, ApiError, type ApiOrder } from '../utils/api'
import { formatMoney } from '../utils/money'
import { formatDate } from '../utils/format'
import { ar } from '../i18n/ar'

export function OrdersPage() {
  const navigate = useNavigate()
  const { user, loading: authLoading } = useAuth()
  const { addItem } = useCart()
  const flash = useToast()
  const [orders, setOrders] = useState<ApiOrder[] | null>(null)
  const [error, setError] = useState('')
  const [reordering, setReordering] = useState<string | null>(null)

  useEffect(() => {
    if (!user) return
    api.listOrders()
      .then(({ orders }) => setOrders(orders))
      .catch(err => setError(err instanceof ApiError ? ar.errors.forCode(err.code) : ar.errors.generic))
  }, [user])

  // "إعادة الطلب": بيضيف للسلة بس المنتجات لسه موجودة ومتاحة دلوقتي، وبالكمية المطلوبة —
  // بنتحقق من الحالة الحالية عن طريق POST /api/products/resolve (بدل تحميل الكتالوج كامل).
  // السعر اللي هيتحسب فعلياً وقت الدفع هو السعر الحالي من الكتالوج (نفس منطق السلة العادي)،
  // مش سعر الطلب القديم المخزّن. أي منتج اتشال من الكتالوج أو بقى غير متاح بيتخطّى بصمت
  // من غير ما يوقف باقي العملية، مع تنبيه واضح للعميل بعدد المنتجات المتخطاة.
  async function reorder(order: ApiOrder) {
    setReordering(order.id)
    try {
      const ids = order.items.map(line => line.productId)
      const { products } = await api.resolveProducts(ids)
      const byId = new Map(products.map(p => [p.id, p]))

      let addedCount = 0
      let skippedCount = 0
      for (const line of order.items) {
        const product = byId.get(line.productId)
        if (!product || !product.available) {
          skippedCount += 1
          continue
        }
        addItem(line.productId, line.quantity)
        addedCount += 1
      }

      if (addedCount === 0) {
        flash(ar.account.reorderNoneAvailable)
        return
      }
      flash(skippedCount > 0 ? ar.account.reorderSomeSkipped(skippedCount) : ar.account.reorderAllAdded)
      navigate('/cart')
    } catch {
      flash(ar.errors.generic)
    } finally {
      setReordering(null)
    }
  }

  if (authLoading || (user && orders === null && !error)) return null

  if (!user) {
    return (
      <div className="account-guest-card">
        <h2>{ar.account.guestTitle}</h2>
        <p>{ar.account.ordersLoginPrompt}</p>
        <div className="account-guest-actions">
          <Link className="secondary-button" to="/register" state={{ from: '/orders' }}>{ar.auth.registerCta}</Link>
          <Link className="primary-button" to="/login" state={{ from: '/orders' }}>{ar.auth.loginCta}</Link>
        </div>
      </div>
    )
  }

  if (error) return <div className="empty-card">{error}</div>
  if (!orders || orders.length === 0) return <div className="empty-card">{ar.account.noOrders}</div>

  return (
    <div className="order-list">
      {orders.map(order => {
        const terminal = order.status === 'delivered' || order.status === 'cancelled'
        return (
          <div key={order.id} className="order-row">
            <button className="order-row-main" onClick={() => navigate(`/track/${order.orderNumber}`)}>
              <span className="order-row-icon">{order.status === 'delivered' ? '📦' : order.status === 'cancelled' ? '⛔' : '🛵'}</span>
              <span className="order-row-info">
                <span className="order-row-id">{order.orderNumber}</span>
                <span className="order-row-date">{formatDate(order.createdAt)} · {ar.account.productsCount(order.items.length)}</span>
              </span>
              <span className="order-row-end">
                <span className="order-row-total">{formatMoney(order.total)}</span>
                <span className={`order-status-badge ${terminal ? 'delivered' : 'active'}`}>
                  {ar.order.orderStatusLabels[order.status]}
                </span>
              </span>
            </button>
            <button className="order-row-reorder" onClick={() => reorder(order)} disabled={reordering === order.id}>{ar.account.reorder}</button>
          </div>
        )
      })}
    </div>
  )
}
