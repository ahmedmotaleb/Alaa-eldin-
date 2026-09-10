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

const MAX_LIMIT = 100
const DEFAULT_LIMIT = 20

adminCustomersRouter.get('/', async (req, res) => {
  // الترقيم والبحث اختياريان (opt-in) — لو مفيش page/limit، بيرجع كل العملاء زي ما كان
  // الحال دايماً، عشان أي استدعاء قديم ما ينكسرش بصمت.
  const paginationRequested = req.query.page !== undefined || req.query.limit !== undefined
  const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1)
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(String(req.query.limit ?? String(DEFAULT_LIMIT)), 10) || DEFAULT_LIMIT))
  const offset = (page - 1) * limit

  const params: unknown[] = []
  let searchClause = ''
  if (typeof req.query.search === 'string' && req.query.search.trim()) {
    params.push(`%${req.query.search.trim()}%`)
    searchClause = `AND (u.full_name ILIKE $${params.length} OR u.email ILIKE $${params.length})`
  }

  if (!paginationRequested) {
    const { rows } = await pool.query<CustomerRow>(
      `${SELECT_CUSTOMER} ${searchClause} GROUP BY u.id ORDER BY "totalSpent" DESC`,
      params
    )
    res.json({ customers: rows })
    return
  }

  const { rows: countRows } = await pool.query<{ n: string }>(
    `SELECT COUNT(*) as n FROM users u WHERE u.is_admin = 0 ${searchClause}`,
    params
  )
  const total = Number(countRows[0].n)

  const { rows } = await pool.query<CustomerRow>(
    `${SELECT_CUSTOMER} ${searchClause} GROUP BY u.id ORDER BY "totalSpent" DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset]
  )
  res.json({
    customers: rows,
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit))
  })
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
