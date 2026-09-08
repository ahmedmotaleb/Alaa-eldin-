import { Router } from 'express'
import { db } from '../db.js'
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
  SELECT s.id as id, s.rider_id as riderId, s.amount as amount, s.order_count as orderCount, s.created_at as createdAt,
         r.name as riderName
  FROM settlements s JOIN riders r ON r.id = s.rider_id
`

adminSettlementsRouter.get('/', (_req, res) => {
  const rows = db.prepare(`${SELECT_SETTLEMENT} ORDER BY s.created_at DESC, s.id DESC`).all() as SettlementRow[]
  res.json({ settlements: rows })
})

adminSettlementsRouter.post('/', (req, res) => {
  const { riderId } = req.body ?? {}
  if (typeof riderId !== 'string' || !riderId.trim()) {
    res.status(400).json({ error: 'missing_fields' })
    return
  }

  const rider = db.prepare('SELECT id FROM riders WHERE id = ?').get(riderId)
  if (!rider) {
    res.status(404).json({ error: 'rider_not_found' })
    return
  }

  const outstanding = db.prepare(`
    SELECT id, total FROM orders WHERE rider_id = ? AND status = 'delivered' AND settlement_id IS NULL
  `).all(riderId) as { id: string, total: number }[]

  if (outstanding.length === 0) {
    res.status(400).json({ error: 'nothing_to_settle' })
    return
  }

  const amount = outstanding.reduce((sum, o) => sum + o.total, 0)

  const insertSettlement = db.prepare('INSERT INTO settlements (rider_id, amount, order_count) VALUES (?, ?, ?)')
  const markSettled = db.prepare('UPDATE orders SET settlement_id = ? WHERE id = ?')

  const settlementId = db.transaction(() => {
    const result = insertSettlement.run(riderId, amount, outstanding.length)
    for (const order of outstanding) markSettled.run(result.lastInsertRowid, order.id)
    return result.lastInsertRowid
  })()

  const row = db.prepare(`${SELECT_SETTLEMENT} WHERE s.id = ?`).get(settlementId) as SettlementRow
  res.status(201).json({ settlement: row })
})
