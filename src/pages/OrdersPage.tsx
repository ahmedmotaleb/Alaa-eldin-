import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../store/AuthContext'
import { api, ApiError, type ApiOrder } from '../utils/api'
import { formatMoney } from '../utils/money'
import { ar } from '../i18n/ar'

export function OrdersPage() {
  const navigate = useNavigate()
  const { user, loading: authLoading } = useAuth()
  const [orders, setOrders] = useState<ApiOrder[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!user) return
    api.listOrders()
      .then(({ orders }) => setOrders(orders))
      .catch(err => setError(err instanceof ApiError ? ar.errors.forCode(err.code) : ar.errors.generic))
  }, [user])

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
          <button key={order.id} className="order-row" onClick={() => navigate(`/track/${order.id}`)}>
            <span className="order-row-icon">{order.status === 'delivered' ? '📦' : order.status === 'cancelled' ? '⛔' : '🛵'}</span>
            <span className="order-row-info">
              <span className="order-row-id">{order.id}</span>
              <span className="order-row-date">{new Date(order.createdAt).toLocaleDateString('ar-EG')} · {ar.account.productsCount(order.items.length)}</span>
            </span>
            <span className="order-row-end">
              <span className="order-row-total">{formatMoney(order.total)}</span>
              <span className={`order-status-badge ${terminal ? 'delivered' : 'active'}`}>
                {ar.order.orderStatusLabels[order.status]}
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )
}
