import { Router } from 'express'
import { pool, withTransaction } from '../db.js'
import { requireAdmin } from '../auth.js'

export const adminSettlementsRouter = Router()
adminSettlementsRouter.use(requireAdmin)

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

adminSettlementsRouter.get('/', async (_req, res) => {
  const { rows } = await pool.query<SettlementRow>(`${SELECT_SETTLEMENT} ORDER BY s.created_at DESC, s.id DESC`)
  res.json({ settlements: rows })
})

adminSettlementsRouter.post('/', async (req, res) => {
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
