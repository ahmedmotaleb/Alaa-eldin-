import { Router } from 'express'
import { pool } from '../db.js'
import { requireAdmin } from '../auth.js'

export const adminCustomersRouter = Router()
adminCustomersRouter.use(requireAdmin)

interface CustomerRow {
  id: string
  email: string
  fullName: string
  createdAt: string
  orderCount: number
  totalSpent: number
  lastOrderAt: string | null
  lastMobile: string | null
}

const SELECT_CUSTOMER = `
  SELECT u.id as id, u.email as email, u.full_name as "fullName", u.created_at as "createdAt",
         COUNT(o.id)::int as "orderCount",
         COALESCE(SUM(o.total), 0) as "totalSpent",
         MAX(o.created_at) as "lastOrderAt",
         (SELECT customer_mobile FROM orders WHERE user_id = u.id ORDER BY created_at DESC LIMIT 1) as "lastMobile"
  FROM users u LEFT JOIN orders o ON o.user_id = u.id AND o.status != 'cancelled'
  WHERE u.is_admin = 0
`

adminCustomersRouter.get('/', async (_req, res) => {
  const { rows } = await pool.query<CustomerRow>(`${SELECT_CUSTOMER} GROUP BY u.id ORDER BY "totalSpent" DESC`)
  res.json({ customers: rows })
})

adminCustomersRouter.get('/:id', async (req, res) => {
  const { rows: customerRows } = await pool.query<CustomerRow>(`${SELECT_CUSTOMER} AND u.id = $1 GROUP BY u.id`, [req.params.id])
  const customer = customerRows[0]
  if (!customer) {
    res.status(404).json({ error: 'customer_not_found' })
    return
  }

  const { rows: orders } = await pool.query(
    `SELECT id, created_at as "createdAt", total, status
     FROM orders WHERE user_id = $1 ORDER BY created_at DESC`,
    [req.params.id]
  )

  res.json({ customer, orders })
})
