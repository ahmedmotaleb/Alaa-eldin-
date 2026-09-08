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

adminStockMovementsRouter.get('/', async (_req, res) => {
  const { rows } = await pool.query<MovementRow>(`${SELECT_MOVEMENT} ORDER BY m.created_at DESC, m.id DESC`)
  res.json({ movements: rows })
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
