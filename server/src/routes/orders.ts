import { Router } from 'express'
import { pool, withTransaction } from '../db.js'
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

async function serializeOrder(row: OrderRow) {
  const { rows: items } = await pool.query(
    'SELECT product_id as "productId", name, unit, unit_price as "unitPrice", quantity, line_total as "lineTotal" FROM order_items WHERE order_id = $1',
    [row.id]
  )

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
  id, created_at as "createdAt", delivery_slot as "deliverySlot", payment_method as "paymentMethod",
  customer_full_name as "customerFullName", customer_mobile as "customerMobile", customer_governorate as "customerGovernorate", customer_address as "customerAddress",
  subtotal, delivery_fee as "deliveryFee", total, status, discount_code as "discountCode", discount_amount as "discountAmount"
`

ordersRouter.get('/', async (req, res) => {
  const { rows } = await pool.query<OrderRow>(`
    SELECT ${SELECT_ORDER_FIELDS}
    FROM orders WHERE user_id = $1 ORDER BY created_at DESC
  `, [req.user!.id])

  res.json({ orders: await Promise.all(rows.map(serializeOrder)) })
})

ordersRouter.get('/:id', async (req, res) => {
  const { rows } = await pool.query<OrderRow>(`
    SELECT ${SELECT_ORDER_FIELDS}
    FROM orders WHERE id = $1 AND user_id = $2
  `, [req.params.id, req.user!.id])
  const row = rows[0]

  if (!row) {
    res.status(404).json({ error: 'order_not_found' })
    return
  }
  res.json({ order: await serializeOrder(row) })
})

ordersRouter.post('/', async (req, res) => {
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

  const { rows: settingsRows } = await pool.query<{ codEnabled: number }>('SELECT cod_enabled as "codEnabled" FROM store_settings WHERE id = 1')
  if (!settingsRows[0].codEnabled) {
    res.status(400).json({ error: 'cod_disabled' })
    return
  }

  let discountAmount = 0
  let appliedCode: string | null = null
  if (discountCode) {
    const result = await evaluateDiscount(discountCode, subtotal)
    if (!result.ok) {
      res.status(400).json({ error: result.error, minOrder: result.minOrder })
      return
    }
    discountAmount = result.amount
    appliedCode = result.discount.code
  }

  const createdAt = new Date().toISOString()

  try {
    await withTransaction(async client => {
      await client.query(
        `INSERT INTO orders (id, user_id, created_at, delivery_slot, payment_method, customer_full_name, customer_mobile, customer_governorate, customer_address, subtotal, delivery_fee, total, status, discount_code, discount_amount)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'placed', $13, $14)`,
        [id, req.user!.id, createdAt, deliverySlot, paymentMethod, customer.fullName.trim(), customer.mobile.trim(), customer.governorate.trim(), customer.address.trim(), subtotal, deliveryFee, total, appliedCode, discountAmount]
      )
      for (const item of items as OrderItemInput[]) {
        await client.query(
          'INSERT INTO order_items (order_id, product_id, name, unit, unit_price, quantity, line_total) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [id, item.productId, item.name, item.unit, item.unitPrice, item.quantity, item.lineTotal]
        )
      }
      if (appliedCode) {
        await client.query('UPDATE discounts SET used_count = used_count + 1 WHERE code = $1', [appliedCode])
      }
    })
  } catch {
    res.status(409).json({ error: 'order_id_taken' })
    return
  }

  const { rows } = await pool.query<OrderRow>(`SELECT ${SELECT_ORDER_FIELDS} FROM orders WHERE id = $1`, [id])

  res.status(201).json({ order: await serializeOrder(rows[0]) })
})
