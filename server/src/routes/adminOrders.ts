import { Router } from 'express'
import { pool, withTransaction } from '../db.js'
import { requireAdmin } from '../auth.js'
import { fetchItemsForOrders, type OrderItemDTO } from '../orderItems.js'
import { isValidOrderStatus, canTransitionOrderStatus, type OrderStatus } from '../orderStatus.js'
import { cancelOrder } from '../services/orderService.js'
import { recordOrderStatusChange, listOrderStatusHistoryForOrders } from '../services/orderStatusHistoryService.js'
import { recordAuditLog } from '../services/auditLogService.js'
import { logEvent } from '../logger.js'

export const adminOrdersRouter = Router()
adminOrdersRouter.use(requireAdmin)

interface OrderRow {
  id: string
  orderNumber: string
  createdAt: string
  deliverySlot: string
  paymentMethod: string
  customerFullName: string
  customerMobile: string
  customerGovernorate: string
  customerAddress: string
  subtotal: number
  deliveryFee: number
  total: number
  status: string
  accountEmail: string | null
  discountCode: string | null
  discountAmount: number
  riderId: string | null
  riderName: string | null
  settlementId: number | null
}

function serializeOrderRow(row: OrderRow, items: OrderItemDTO[]) {
  return {
    id: row.id,
    orderNumber: row.orderNumber,
    createdAt: row.createdAt,
    deliverySlot: row.deliverySlot,
    paymentMethod: row.paymentMethod,
    customer: {
      fullName: row.customerFullName,
      mobile: row.customerMobile,
      governorate: row.customerGovernorate,
      address: row.customerAddress
    },
    accountEmail: row.accountEmail,
    items,
    subtotal: row.subtotal,
    deliveryFee: row.deliveryFee,
    total: row.total,
    status: row.status,
    discountCode: row.discountCode ?? undefined,
    discountAmount: row.discountAmount,
    riderId: row.riderId,
    riderName: row.riderName,
    settlementId: row.settlementId
  }
}

const SELECT_ORDER = `
  SELECT o.id as id, o.order_number as "orderNumber", o.created_at as "createdAt", o.delivery_slot as "deliverySlot", o.payment_method as "paymentMethod",
         o.customer_full_name as "customerFullName", o.customer_mobile as "customerMobile", o.customer_governorate as "customerGovernorate", o.customer_address as "customerAddress",
         o.subtotal as subtotal, o.delivery_fee as "deliveryFee", o.total as total, o.status as status,
         o.discount_code as "discountCode", o.discount_amount as "discountAmount",
         o.rider_id as "riderId", r.name as "riderName", o.settlement_id as "settlementId",
         u.email as "accountEmail"
  FROM orders o LEFT JOIN users u ON u.id = o.user_id
       LEFT JOIN riders r ON r.id = o.rider_id
`

adminOrdersRouter.get('/', async (req, res) => {
  // الترقيم اختياري (opt-in): لو مفيش page/limit في الطلب أصلاً، بيرجع كل الطلبات المطابقة
  // للفلاتر زي ما كان الحال دايماً — عشان صفحات زي التحليلات/المحفظة/الرئيسية بتحسب
  // إجماليات من كل الطلبات التاريخية، ومينفعش تتقطع بصمت لو حد ضاف ترقيم افتراضي هنا.
  const paginationRequested = req.query.page !== undefined || req.query.limit !== undefined
  const page = Math.max(1, Number(req.query.page) || 1)
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20))
  const offset = (page - 1) * limit

  const conditions: string[] = []
  const params: unknown[] = []

  if (typeof req.query.status === 'string' && isValidOrderStatus(req.query.status)) {
    params.push(req.query.status)
    conditions.push(`o.status = $${params.length}`)
  }
  if (typeof req.query.riderId === 'string' && req.query.riderId) {
    params.push(req.query.riderId)
    conditions.push(`o.rider_id = $${params.length}`)
  }
  if (typeof req.query.from === 'string' && req.query.from) {
    params.push(req.query.from)
    conditions.push(`o.created_at >= $${params.length}::timestamptz`)
  }
  if (typeof req.query.to === 'string' && req.query.to) {
    params.push(req.query.to)
    conditions.push(`o.created_at <= $${params.length}::timestamptz`)
  }
  if (typeof req.query.search === 'string' && req.query.search.trim()) {
    params.push(`%${req.query.search.trim()}%`)
    conditions.push(`(o.customer_mobile ILIKE $${params.length} OR o.customer_full_name ILIKE $${params.length} OR o.order_number ILIKE $${params.length})`)
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

  const { rows: countRows } = await pool.query<{ n: string }>(`SELECT COUNT(*) as n FROM orders o ${whereClause}`, params)
  const total = Number(countRows[0].n)

  const limitClause = paginationRequested ? `LIMIT $${params.length + 1} OFFSET $${params.length + 2}` : ''
  const { rows } = await pool.query<OrderRow>(
    `${SELECT_ORDER} ${whereClause} ORDER BY o.created_at DESC ${limitClause}`,
    paginationRequested ? [...params, limit, offset] : params
  )

  const itemsByOrder = await fetchItemsForOrders(rows.map(r => r.id))
  res.json({
    orders: rows.map(row => serializeOrderRow(row, itemsByOrder.get(row.id) ?? [])),
    pagination: paginationRequested
      ? { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) }
      : { page: 1, limit: total, total, pages: 1 }
  })
})

adminOrdersRouter.get('/:id', async (req, res) => {
  const { rows } = await pool.query<OrderRow>(`${SELECT_ORDER} WHERE o.id = $1`, [req.params.id])
  const row = rows[0]
  if (!row) {
    res.status(404).json({ error: 'order_not_found' })
    return
  }
  const itemsByOrder = await fetchItemsForOrders([row.id])
  res.json({ order: serializeOrderRow(row, itemsByOrder.get(row.id) ?? []) })
})

adminOrdersRouter.patch('/:id/status', async (req, res) => {
  const { status } = req.body ?? {}
  if (!isValidOrderStatus(status)) {
    res.status(400).json({ error: 'invalid_status' })
    return
  }

  // إلغاء الطلب مسار خاص: بيرجّع المخزون idempotent وبيتحقق من صحة الانتقال جوه نفس المعاملة.
  if (status === 'cancelled') {
    const result = await cancelOrder(String(req.params.id), req.user!.id)
    if (!result.ok) {
      res.status(result.error === 'order_not_found' ? 404 : 409).json({ error: result.error })
      return
    }
    await recordAuditLog({
      adminUserId: req.user!.id,
      action: 'order_cancelled',
      entityType: 'order',
      entityId: String(req.params.id)
    })
    res.status(204).end()
    return
  }

  const result = await withTransaction(async client => {
    const { rows: currentRows } = await client.query<{ status: OrderStatus }>('SELECT status FROM orders WHERE id = $1 FOR UPDATE', [req.params.id])
    const current = currentRows[0]
    if (!current) return { ok: false as const, error: 'order_not_found' as const }
    if (!canTransitionOrderStatus(current.status, status)) return { ok: false as const, error: 'invalid_status_transition' as const }

    await client.query('UPDATE orders SET status = $1 WHERE id = $2', [status, req.params.id])
    await recordOrderStatusChange(client, { orderId: String(req.params.id), fromStatus: current.status, toStatus: status, changedByUserId: req.user!.id, source: 'admin' })
    return { ok: true as const }
  })

  if (!result.ok) {
    res.status(result.error === 'order_not_found' ? 404 : 409).json({ error: result.error })
    return
  }

  if (status === 'delivered') logEvent('order_delivered', { orderId: String(req.params.id) })
  res.status(204).end()
})

adminOrdersRouter.patch('/:id/rider', async (req, res) => {
  let { riderId } = req.body ?? {}
  if (riderId !== null && typeof riderId !== 'string') {
    res.status(400).json({ error: 'invalid_rider' })
    return
  }
  if (typeof riderId === 'string' && !riderId.trim()) riderId = null
  if (riderId) {
    const { rows } = await pool.query('SELECT id FROM riders WHERE id = $1', [riderId])
    if (!rows[0]) {
      res.status(404).json({ error: 'rider_not_found' })
      return
    }
  }

  const result = await pool.query('UPDATE orders SET rider_id = $1 WHERE id = $2', [riderId, req.params.id])
  if (result.rowCount === 0) {
    res.status(404).json({ error: 'order_not_found' })
    return
  }
  res.status(204).end()
})
