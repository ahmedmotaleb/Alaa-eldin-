import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useAuth } from '../store/AuthContext'
import { api, ApiError, type ApiOrder } from '../utils/api'
import { getGuestTrackingToken } from '../utils/guestTracking'
import { formatTime } from '../utils/format'
import type { OrderStatus } from '../types/models'
import { ar } from '../i18n/ar'

const STATUSES: OrderStatus[] = ['placed', 'preparing', 'ready_for_delivery', 'out_for_delivery', 'delivered']
const STEPS = ar.tracking.steps

export function TrackingPage() {
  const { orderNumber } = useParams()
  const { user, loading: authLoading } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [order, setOrder] = useState<ApiOrder | null>(null)
  const [error, setError] = useState('')

  // الزائر (من غير تسجيل دخول) بيقدر يتابع طلبه بتوكن عالي العشوائية جاي إما من رابط
  // ?t= مباشرة أو من نسخة محفوظة محلياً من زيارة سابقة لصفحة التأكيد.
  const guestToken = searchParams.get('t') || (orderNumber ? getGuestTrackingToken(orderNumber) : null)

  useEffect(() => {
    if (authLoading || !orderNumber) return
    if (!user && !guestToken) {
      navigate('/login', { replace: true, state: { from: `/track/${orderNumber}` } })
      return
    }
    function load() {
      const request = user ? api.getOrder(orderNumber!) : api.trackGuestOrder(orderNumber!, guestToken!)
      request
        .then(({ order }) => setOrder(order))
        .catch(err => setError(err instanceof ApiError ? ar.errors.forCode(err.code) : ar.errors.generic))
    }
    load()
    const interval = setInterval(load, 15000)
    return () => clearInterval(interval)
  }, [user, authLoading, orderNumber, guestToken, navigate])

  if (authLoading || (!order && !error)) return null
  if (error) return <div className="empty-card">{error}</div>
  if (!order || !orderNumber) return null

  const isCancelled = order.status === 'cancelled'
  const statusIndex = STATUSES.indexOf(order.status as OrderStatus)

  // لو موجود صف تاريخ حقيقي مطابق للخطوة، بيتعرض وقته الفعلي بدل النص الاحتياطي الوصفي —
  // طلبات قديمة اتعملت قبل ما order_status_history يتضاف تفضل شغالة عادي بالنص الاحتياطي.
  function historyTimeFor(status: OrderStatus): string | null {
    const entry = order!.statusHistory?.find(h => h.toStatus === status)
    return entry ? formatTime(entry.createdAt) : null
  }

  // عند الإلغاء: آخر حالة نشطة كان عليها الطلب قبل الإلغاء بتتحدد من from_status لصف
  // الإلغاء في سجل التاريخ — عشان نلوّن الخطوات اللي فعلاً حصلت قبل الإلغاء بس. طلب ملغى
  // قديم من غير سجل تاريخ (قبل إضافة الميزة دي) بيعرض بانر الإلغاء بس من غير خطوات مكتملة.
  const cancelledEntry = order.statusHistory?.find(h => h.toStatus === 'cancelled')
  const cancelledAtIndex = isCancelled ? STATUSES.indexOf((cancelledEntry?.fromStatus ?? '') as OrderStatus) : -1
  const lastDoneIndex = isCancelled ? cancelledAtIndex : statusIndex

  return (
    <div className="tracking-page">
      <div className="tracking-map">
        <div>
          <div className="tracking-map-emoji">🛵</div>
          <div className="tracking-map-note">{ar.tracking.mapPlaceholder}</div>
        </div>
      </div>

      {!isCancelled && (
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
      )}

      <div className="tracking-timeline-card">
        <h2>{ar.tracking.statusTitle(order.orderNumber)}</h2>
        <div className="tracking-timeline">
          {STEPS.map((step, i) => {
            const done = i <= lastDoneIndex
            const realTime = historyTimeFor(STATUSES[i])
            return (
              <div className="tracking-step" key={step.title}>
                <div className="tracking-step-rail">
                  <span className={`tracking-dot ${done ? 'done' : ''}`} />
                  {i < STEPS.length - 1 && <span className={`tracking-line ${i < lastDoneIndex ? 'done' : ''}`} />}
                </div>
                <div className="tracking-step-body">
                  <div className={`tracking-step-title ${done ? 'done' : ''}`}>{step.title}</div>
                  <div className="tracking-step-time">{done ? (realTime ?? step.time) : ''}</div>
                </div>
              </div>
            )
          })}
          {isCancelled && (
            <div className="tracking-step">
              <div className="tracking-step-rail">
                <span className="tracking-dot cancelled" />
              </div>
              <div className="tracking-step-body">
                <div className="tracking-step-title cancelled">{ar.tracking.orderCancelled}</div>
                <div className="tracking-step-time">{cancelledEntry ? formatTime(cancelledEntry.createdAt) : ''}</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
