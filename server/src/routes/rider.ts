import { Router } from 'express'
import type { Request, Response, NextFunction } from 'express'
import { pool, withTransaction } from '../db.js'
import { requireAuth } from '../auth.js'
import { canTransitionOrderStatus, type OrderStatus } from '../orderStatus.js'
import { recordOrderStatusChange } from '../services/orderStatusHistoryService.js'
import { notifyOrderStatusChange } from '../services/pushService.js'
import { logEvent } from '../logger.js'

export const riderRouter = Router()
riderRouter.use(requireAuth)

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      riderId?: string
    }
  }
}

// المسار ده مقصور على مستخدمين مربوطين فعلياً بسجل مندوب (riders.user_id) — مش أي isAdmin
// عام. حساب admin عادي (مش مربوط كمندوب) بيترفض هنا بـ403، حتى لو داخل بلوحة التحكم أصلاً.
async function requireRiderAccount(req: Request, res: Response, next: NextFunction) {
  const { rows } = await pool.query<{ id: string }>('SELECT id FROM riders WHERE user_id = $1 AND active = 1', [req.user!.id])
  if (!rows[0]) {
    res.status(403).json({ error: 'not_a_rider' })
    return
  }
  req.riderId = rows[0].id
  next()
}
riderRouter.use(requireRiderAccount)

interface RiderOrderRow {
  id: string
  orderNumber: string
  createdAt: string
  status: OrderStatus
  customerFullName: string
  customerMobile: string
  customerGovernorate: string
  customerAddress: string
  paymentMethod: string
  total: number
}

const SELECT_RIDER_ORDER = `
  SELECT id, order_number as "orderNumber", created_at as "createdAt", status,
         customer_full_name as "customerFullName", customer_mobile as "customerMobile",
         customer_governorate as "customerGovernorate", customer_address as "customerAddress",
         payment_method as "paymentMethod", total
  FROM orders
`

// طلبات المندوب النشطة بس افتراضياً (مش مسلّمة/ملغاة) — تاريخ التسليمات القديمة مش الغرض
// من الشاشة دي (شاشة عمل يومية، مش سجل)؛ ?all=true لو حابب يشوف الكل.
riderRouter.get('/orders', async (req, res) => {
  const includeAll = req.query.all === 'true'
  const whereClause = includeAll
    ? 'WHERE rider_id = $1'
    : `WHERE rider_id = $1 AND status NOT IN ('delivered', 'cancelled')`
  const { rows } = await pool.query<RiderOrderRow>(
    `${SELECT_RIDER_ORDER} ${whereClause} ORDER BY created_at ASC`,
    [req.riderId]
  )
  res.json({ orders: rows })
})

// المندوب بس بيقدر يبدأ التوصيل (ready_for_delivery -> out_for_delivery) أو يأكّد التسليم
// (out_for_delivery -> delivered) — أي انتقال تاني (زي إلغاء أو تخطي خطوة) مرفوض هنا تماماً،
// حتى لو كانت آلة الحالة العامة بتسمح بيه من مسار الأدمن.
const RIDER_ALLOWED_TRANSITIONS: Record<string, OrderStatus> = {
  ready_for_delivery: 'out_for_delivery',
  out_for_delivery: 'delivered'
}

riderRouter.patch('/orders/:id/status', async (req, res) => {
  const toStatus = req.body?.status
  if (typeof toStatus !== 'string' || !['out_for_delivery', 'delivered'].includes(toStatus)) {
    res.status(400).json({ error: 'invalid_status' })
    return
  }

  const result = await withTransaction(async client => {
    const { rows } = await client.query<{ status: OrderStatus; riderId: string | null; userId: string | null; orderNumber: string }>(
      'SELECT status, rider_id as "riderId", user_id as "userId", order_number as "orderNumber" FROM orders WHERE id = $1 FOR UPDATE',
      [req.params.id]
    )
    const order = rows[0]
    if (!order) return { ok: false as const, error: 'order_not_found' as const }
    if (order.riderId !== req.riderId) return { ok: false as const, error: 'not_your_order' as const }
    if (RIDER_ALLOWED_TRANSITIONS[order.status] !== toStatus || !canTransitionOrderStatus(order.status, toStatus as OrderStatus)) {
      return { ok: false as const, error: 'invalid_status_transition' as const }
    }

    await client.query('UPDATE orders SET status = $1 WHERE id = $2', [toStatus, req.params.id])
    await recordOrderStatusChange(client, {
      orderId: req.params.id, fromStatus: order.status, toStatus: toStatus as OrderStatus,
      changedByUserId: req.user!.id, source: 'rider'
    })
    return { ok: true as const, userId: order.userId, orderNumber: order.orderNumber }
  })

  if (!result.ok) {
    const status = result.error === 'order_not_found' ? 404 : result.error === 'not_your_order' ? 403 : 409
    res.status(status).json({ error: result.error })
    return
  }

  if (toStatus === 'delivered') logEvent('order_delivered', { orderId: req.params.id })
  try {
    await notifyOrderStatusChange(result.userId, result.orderNumber, toStatus)
  } catch {
    // إشعار فشل — يُتجاهل عمداً، تحديث حالة الطلب نفسه اتسجّل بنجاح بالفعل.
  }
  res.status(204).end()
})
