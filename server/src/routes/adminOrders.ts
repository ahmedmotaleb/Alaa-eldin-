import { Router } from 'express'
import { db } from '../db.js'
import { requireAdmin } from '../auth.js'

export const adminOrdersRouter = Router()
adminOrdersRouter.use(requireAdmin)

const STATUSES = ['placed', 'preparing', 'ready_for_delivery', 'out_for_delivery', 'delivered', 'cancelled']

interface OrderRow {
  id: string
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
  accountEmail: string
  discountCode: string | null
  discountAmount: number
  riderId: string | null
  riderName: string | null
  settlementId: number | null
}

function serializeOrder(row: OrderRow) {
  const items = db.prepare(
    'SELECT product_id as productId, name, unit, unit_price as unitPrice, quantity, line_total as lineTotal FROM order_items WHERE order_id = ?'
  ).all(row.id)

  return {
    id: row.id,
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
  SELECT o.id as id, o.created_at as createdAt, o.delivery_slot as deliverySlot, o.payment_method as paymentMethod,
         o.customer_full_name as customerFullName, o.customer_mobile as customerMobile, o.customer_governorate as customerGovernorate, o.customer_address as customerAddress,
         o.subtotal as subtotal, o.delivery_fee as deliveryFee, o.total as total, o.status as status,
         o.discount_code as discountCode, o.discount_amount as discountAmount,
         o.rider_id as riderId, r.name as riderName, o.settlement_id as settlementId,
         u.email as accountEmail
  FROM orders o JOIN users u ON u.id = o.user_id
       LEFT JOIN riders r ON r.id = o.rider_id
`

adminOrdersRouter.get('/', (_req, res) => {
  const rows = db.prepare(`${SELECT_ORDER} ORDER BY o.created_at DESC`).all() as OrderRow[]
  res.json({ orders: rows.map(serializeOrder) })
})

adminOrdersRouter.get('/:id', (req, res) => {
  const row = db.prepare(`${SELECT_ORDER} WHERE o.id = ?`).get(req.params.id) as OrderRow | undefined
  if (!row) {
    res.status(404).json({ error: 'order_not_found' })
    return
  }
  res.json({ order: serializeOrder(row) })
})

adminOrdersRouter.patch('/:id/status', (req, res) => {
  const { status } = req.body ?? {}
  if (typeof status !== 'string' || !STATUSES.includes(status)) {
    res.status(400).json({ error: 'invalid_status' })
    return
  }

  const result = db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, req.params.id)
  if (result.changes === 0) {
    res.status(404).json({ error: 'order_not_found' })
    return
  }
  res.status(204).end()
})

adminOrdersRouter.patch('/:id/rider', (req, res) => {
  let { riderId } = req.body ?? {}
  if (riderId !== null && typeof riderId !== 'string') {
    res.status(400).json({ error: 'invalid_rider' })
    return
  }
  if (typeof riderId === 'string' && !riderId.trim()) riderId = null
  if (riderId) {
    const rider = db.prepare('SELECT id FROM riders WHERE id = ?').get(riderId)
    if (!rider) {
      res.status(404).json({ error: 'rider_not_found' })
      return
    }
  }

  const result = db.prepare('UPDATE orders SET rider_id = ? WHERE id = ?').run(riderId, req.params.id)
  if (result.changes === 0) {
    res.status(404).json({ error: 'order_not_found' })
    return
  }
  res.status(204).end()
})
