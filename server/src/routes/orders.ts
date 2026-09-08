import { Router } from 'express'
import { db } from '../db.js'
import { requireAuth } from '../auth.js'
import { evaluateDiscount } from '../discounts.js'

export const ordersRouter = Router()
ordersRouter.use(requireAuth)

interface OrderItemInput {
  productId: string
  name: string
  unit: string
  unitPrice: number
  quantity: number
  lineTotal: number
}

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
  discountCode: string | null
  discountAmount: number
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
    items,
    subtotal: row.subtotal,
    deliveryFee: row.deliveryFee,
    total: row.total,
    status: row.status,
    discountCode: row.discountCode ?? undefined,
    discountAmount: row.discountAmount
  }
}

const SELECT_ORDER_FIELDS = `
  id, created_at as createdAt, delivery_slot as deliverySlot, payment_method as paymentMethod,
  customer_full_name as customerFullName, customer_mobile as customerMobile, customer_governorate as customerGovernorate, customer_address as customerAddress,
  subtotal, delivery_fee as deliveryFee, total, status, discount_code as discountCode, discount_amount as discountAmount
`

ordersRouter.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT ${SELECT_ORDER_FIELDS}
    FROM orders WHERE user_id = ? ORDER BY created_at DESC
  `).all(req.user!.id) as OrderRow[]

  res.json({ orders: rows.map(serializeOrder) })
})

ordersRouter.get('/:id', (req, res) => {
  const row = db.prepare(`
    SELECT ${SELECT_ORDER_FIELDS}
    FROM orders WHERE id = ? AND user_id = ?
  `).get(req.params.id, req.user!.id) as OrderRow | undefined

  if (!row) {
    res.status(404).json({ error: 'order_not_found' })
    return
  }
  res.json({ order: serializeOrder(row) })
})

ordersRouter.post('/', (req, res) => {
  const body = req.body ?? {}
  const { id, deliverySlot, paymentMethod, customer, items, subtotal, deliveryFee, total, discountCode } = body

  if (
    typeof id !== 'string' || typeof deliverySlot !== 'string' || typeof paymentMethod !== 'string' ||
    !customer || typeof customer.fullName !== 'string' || !customer.fullName.trim() ||
    typeof customer.mobile !== 'string' || !customer.mobile.trim() ||
    typeof customer.governorate !== 'string' || !customer.governorate.trim() ||
    typeof customer.address !== 'string' || !customer.address.trim() ||
    !Array.isArray(items) || items.length === 0 ||
    typeof subtotal !== 'number' || typeof deliveryFee !== 'number' || typeof total !== 'number' ||
    (discountCode !== undefined && typeof discountCode !== 'string')
  ) {
    res.status(400).json({ error: 'missing_fields' })
    return
  }

  const { cod_enabled: codEnabled } = db.prepare('SELECT cod_enabled FROM store_settings WHERE id = 1').get() as { cod_enabled: number }
  if (!codEnabled) {
    res.status(400).json({ error: 'cod_disabled' })
    return
  }

  let discountAmount = 0
  let appliedCode: string | null = null
  if (discountCode) {
    const result = evaluateDiscount(discountCode, subtotal)
    if (!result.ok) {
      res.status(400).json({ error: result.error, minOrder: result.minOrder })
      return
    }
    discountAmount = result.amount
    appliedCode = result.discount.code
  }

  const createdAt = new Date().toISOString()
  const insertOrder = db.prepare(`
    INSERT INTO orders (id, user_id, created_at, delivery_slot, payment_method, customer_full_name, customer_mobile, customer_governorate, customer_address, subtotal, delivery_fee, total, status, discount_code, discount_amount)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'placed', ?, ?)
  `)
  const insertItem = db.prepare(`
    INSERT INTO order_items (order_id, product_id, name, unit, unit_price, quantity, line_total)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
  const bumpDiscountUsage = db.prepare('UPDATE discounts SET used_count = used_count + 1 WHERE code = ?')

  const tx = db.transaction((orderItems: OrderItemInput[]) => {
    insertOrder.run(id, req.user!.id, createdAt, deliverySlot, paymentMethod, customer.fullName.trim(), customer.mobile.trim(), customer.governorate.trim(), customer.address.trim(), subtotal, deliveryFee, total, appliedCode, discountAmount)
    for (const item of orderItems) {
      insertItem.run(id, item.productId, item.name, item.unit, item.unitPrice, item.quantity, item.lineTotal)
    }
    if (appliedCode) bumpDiscountUsage.run(appliedCode)
  })

  try {
    tx(items as OrderItemInput[])
  } catch {
    res.status(409).json({ error: 'order_id_taken' })
    return
  }

  const row = db.prepare(`SELECT ${SELECT_ORDER_FIELDS} FROM orders WHERE id = ?`).get(id) as OrderRow

  res.status(201).json({ order: serializeOrder(row) })
})
