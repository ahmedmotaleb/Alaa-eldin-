import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useRequireAuth } from '../hooks/useRequireAuth'
import { api, ApiError, type ApiOrder } from '../utils/api'
import type { OrderStatus } from '../types/models'
import { ar } from '../i18n/ar'

const STATUSES: OrderStatus[] = ['placed', 'preparing', 'ready_for_delivery', 'out_for_delivery', 'delivered']
const STEPS = ar.tracking.steps

export function TrackingPage() {
  const { orderId } = useParams()
  const { user } = useRequireAuth()
  const [order, setOrder] = useState<ApiOrder | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!user || !orderId) return
    function load() {
      api.getOrder(orderId!)
        .then(({ order }) => setOrder(order))
        .catch(err => setError(err instanceof ApiError ? ar.errors.forCode(err.code) : ar.errors.generic))
    }
    load()
    const interval = setInterval(load, 15000)
    return () => clearInterval(interval)
  }, [user, orderId])

  if (!user || (!order && !error)) return null
  if (error) return <div className="empty-card">{error}</div>
  if (!order || !orderId) return null

  const statusIndex = STATUSES.indexOf(order.status)

  return (
    <div className="tracking-page">
      <div className="tracking-map">
        <div>
          <div className="tracking-map-emoji">🛵</div>
          <div className="tracking-map-note">{ar.tracking.mapPlaceholder}</div>
        </div>
      </div>

      <div className="courier-card">
        <div className="courier-avatar">👨‍🦱</div>
        <div className="courier-info">
          <div className="courier-name">{ar.tracking.courierName}</div>
          <div className="courier-note">{ar.tracking.courierNote}</div>
        </div>
        <button className="courier-call" aria-label={ar.tracking.callCourier}>
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none"><path d="M6.5 3.5l3 .8 1 3.7-2 1.6a12 12 0 005.9 5.9l1.6-2 3.7 1 .8 3a2 2 0 01-2.1 2.3C10.3 19.2 4.8 13.7 4.2 5.6A2 2 0 016.5 3.5z" fill="#fff" /></svg>
        </button>
      </div>

      <div className="tracking-timeline-card">
        <h2>{ar.tracking.statusTitle(order.id)}</h2>
        <div className="tracking-timeline">
          {STEPS.map((step, i) => {
            const done = i <= statusIndex
            return (
              <div className="tracking-step" key={step.title}>
                <div className="tracking-step-rail">
                  <span className={`tracking-dot ${done ? 'done' : ''}`} />
                  {i < STEPS.length - 1 && <span className={`tracking-line ${i < statusIndex ? 'done' : ''}`} />}
                </div>
                <div className="tracking-step-body">
                  <div className={`tracking-step-title ${done ? 'done' : ''}`}>{step.title}</div>
                  <div className="tracking-step-time">{step.time}</div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
