import { Router } from 'express'
import { pool, withTransaction } from '../db.js'
import { requireAdmin, requireRole } from '../auth.js'

export const adminSettlementsRouter = Router()
adminSettlementsRouter.use(requireAdmin)

const MAX_LIMIT = 100
const DEFAULT_LIMIT = 20

interface SettlementRow {
  id: number
  riderId: string
  amount: number
  orderCount: number
  createdAt: string
  riderName: string
}

const SELECT_SETTLEMENT = `
  SELECT s.id as id, s.rider_id as "riderId", s.amount as amount, s.order_count as "orderCount", s.created_at as "createdAt",
         r.name as "riderName"
  FROM settlements s JOIN riders r ON r.id = s.rider_id
`

adminSettlementsRouter.get('/', async (req, res) => {
  // الترقيم اختياري (opt-in) — لو مفيش page/limit في الطلب، بيرجع كل التسويات زي ما كان
  // الحال دايماً، عشان صفحة المحفظة اللي بتحسب إجماليات من كل السجل التاريخي ما تنكسرش.
  const paginationRequested = req.query.page !== undefined || req.query.limit !== undefined
  const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1)
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(String(req.query.limit ?? String(DEFAULT_LIMIT)), 10) || DEFAULT_LIMIT))
  const offset = (page - 1) * limit

  if (!paginationRequested) {
    const { rows } = await pool.query<SettlementRow>(`${SELECT_SETTLEMENT} ORDER BY s.created_at DESC, s.id DESC`)
    res.json({ settlements: rows })
    return
  }

  const { rows: countRows } = await pool.query<{ n: string }>('SELECT COUNT(*) as n FROM settlements')
  const total = Number(countRows[0].n)

  const { rows } = await pool.query<SettlementRow>(
    `${SELECT_SETTLEMENT} ORDER BY s.created_at DESC, s.id DESC LIMIT $1 OFFSET $2`,
    [limit, offset]
  )
  res.json({
    settlements: rows,
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit))
  })
})

// تسوية الدليفري بتحرك فلوس فعلية بين المتجر والمندوب — مقصورة على دور 'admin' الكامل بس.
adminSettlementsRouter.post('/', requireRole('admin'), async (req, res) => {
  const { riderId } = req.body ?? {}
  if (typeof riderId !== 'string' || !riderId.trim()) {
    res.status(400).json({ error: 'missing_fields' })
    return
  }

  const { rows: riderRows } = await pool.query('SELECT id FROM riders WHERE id = $1', [riderId])
  if (!riderRows[0]) {
    res.status(404).json({ error: 'rider_not_found' })
    return
  }

  const { rows: outstanding } = await pool.query<{ id: string, total: number }>(
    `SELECT id, total FROM orders WHERE rider_id = $1 AND status = 'delivered' AND settlement_id IS NULL`,
    [riderId]
  )

  if (outstanding.length === 0) {
    res.status(400).json({ error: 'nothing_to_settle' })
    return
  }

  const amount = outstanding.reduce((sum, o) => sum + o.total, 0)

  const settlementId = await withTransaction(async client => {
    const { rows } = await client.query<{ id: number }>(
      'INSERT INTO settlements (rider_id, amount, order_count, created_at) VALUES ($1, $2, $3, $4) RETURNING id',
      [riderId, amount, outstanding.length, new Date().toISOString()]
    )
    const newSettlementId = rows[0].id
    for (const order of outstanding) {
      await client.query('UPDATE orders SET settlement_id = $1 WHERE id = $2', [newSettlementId, order.id])
    }
    return newSettlementId
  })

  const { rows } = await pool.query<SettlementRow>(`${SELECT_SETTLEMENT} WHERE s.id = $1`, [settlementId])
  res.status(201).json({ settlement: rows[0] })
})
