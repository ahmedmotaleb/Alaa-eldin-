import { Router } from 'express'
import { pool, withTransaction } from '../db.js'
import { requireAdmin } from '../auth.js'

export const adminStockMovementsRouter = Router()
adminStockMovementsRouter.use(requireAdmin)

const TYPES = ['restock', 'return', 'damage', 'loss', 'adjustment']

interface MovementRow {
  id: number
  productId: string
  type: string
  quantityChange: number
  note: string
  createdAt: string
  productName: string
  productEmoji: string
}

const SELECT_MOVEMENT = `
  SELECT m.id as id, m.product_id as "productId", m.type as type, m.quantity_change as "quantityChange",
         m.note as note, m.created_at as "createdAt", p.name as "productName", p.emoji as "productEmoji"
  FROM stock_movements m JOIN products p ON p.id = m.product_id
`

const MAX_LIMIT = 100
const DEFAULT_LIMIT = 20

adminStockMovementsRouter.get('/', async (req, res) => {
  // الترقيم والبحث اختياريان (opt-in) — لو مفيش page/limit، بيرجع كل الحركات زي ما كان
  // الحال دايماً، عشان أي استدعاء قديم ما ينكسرش بصمت.
  const paginationRequested = req.query.page !== undefined || req.query.limit !== undefined
  const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1)
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(String(req.query.limit ?? String(DEFAULT_LIMIT)), 10) || DEFAULT_LIMIT))
  const offset = (page - 1) * limit

  const conditions: string[] = []
  const params: unknown[] = []
  if (typeof req.query.search === 'string' && req.query.search.trim()) {
    params.push(`%${req.query.search.trim()}%`)
    conditions.push(`(p.name ILIKE $${params.length} OR m.note ILIKE $${params.length})`)
  }
  if (typeof req.query.productId === 'string' && req.query.productId.trim()) {
    params.push(req.query.productId.trim())
    conditions.push(`m.product_id = $${params.length}`)
  }
  if (typeof req.query.type === 'string' && req.query.type.trim()) {
    params.push(req.query.type.trim())
    conditions.push(`m.type = $${params.length}`)
  }
  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

  if (!paginationRequested) {
    const { rows } = await pool.query<MovementRow>(`${SELECT_MOVEMENT} ${whereClause} ORDER BY m.created_at DESC, m.id DESC`, params)
    res.json({ movements: rows })
    return
  }

  const { rows: countRows } = await pool.query<{ n: string }>(
    `SELECT COUNT(*) as n FROM stock_movements m JOIN products p ON p.id = m.product_id ${whereClause}`,
    params
  )
  const total = Number(countRows[0].n)

  const { rows } = await pool.query<MovementRow>(
    `${SELECT_MOVEMENT} ${whereClause} ORDER BY m.created_at DESC, m.id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset]
  )
  res.json({
    movements: rows,
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit))
  })
})

adminStockMovementsRouter.post('/', async (req, res) => {
  const { productId, type, quantityChange, note } = req.body ?? {}

  if (
    typeof productId !== 'string' || !productId.trim() ||
    typeof type !== 'string' || !TYPES.includes(type) ||
    typeof quantityChange !== 'number' || !Number.isInteger(quantityChange) || quantityChange === 0
  ) {
    res.status(400).json({ error: 'missing_fields' })
    return
  }

  const { rows: productRows } = await pool.query<{ id: string, stock: number }>('SELECT id, stock FROM products WHERE id = $1', [productId])
  const product = productRows[0]
  if (!product) {
    res.status(404).json({ error: 'product_not_found' })
    return
  }

  const newStock = product.stock + quantityChange
  if (newStock < 0) {
    res.status(400).json({ error: 'insufficient_stock' })
    return
  }

  const movementId = await withTransaction(async client => {
    const { rows } = await client.query<{ id: number }>(
      'INSERT INTO stock_movements (product_id, type, quantity_change, note, created_at) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [productId, type, quantityChange, typeof note === 'string' ? note.trim() : '', new Date().toISOString()]
    )
    await client.query('UPDATE products SET stock = $1 WHERE id = $2', [newStock, productId])
    return rows[0].id
  })

  const { rows } = await pool.query<MovementRow>(`${SELECT_MOVEMENT} WHERE m.id = $1`, [movementId])
  res.status(201).json({ movement: rows[0], newStock })
})
