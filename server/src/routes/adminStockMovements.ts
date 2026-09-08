import { Router } from 'express'
import { db } from '../db.js'
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
  SELECT m.id as id, m.product_id as productId, m.type as type, m.quantity_change as quantityChange,
         m.note as note, m.created_at as createdAt, p.name as productName, p.emoji as productEmoji
  FROM stock_movements m JOIN products p ON p.id = m.product_id
`

adminStockMovementsRouter.get('/', (_req, res) => {
  const rows = db.prepare(`${SELECT_MOVEMENT} ORDER BY m.created_at DESC, m.id DESC`).all() as MovementRow[]
  res.json({ movements: rows })
})

adminStockMovementsRouter.post('/', (req, res) => {
  const { productId, type, quantityChange, note } = req.body ?? {}

  if (
    typeof productId !== 'string' || !productId.trim() ||
    typeof type !== 'string' || !TYPES.includes(type) ||
    typeof quantityChange !== 'number' || !Number.isInteger(quantityChange) || quantityChange === 0
  ) {
    res.status(400).json({ error: 'missing_fields' })
    return
  }

  const product = db.prepare('SELECT id, stock FROM products WHERE id = ?').get(productId) as { id: string, stock: number } | undefined
  if (!product) {
    res.status(404).json({ error: 'product_not_found' })
    return
  }

  const newStock = product.stock + quantityChange
  if (newStock < 0) {
    res.status(400).json({ error: 'insufficient_stock' })
    return
  }

  const insert = db.prepare(`
    INSERT INTO stock_movements (product_id, type, quantity_change, note)
    VALUES (?, ?, ?, ?)
  `)
  const updateStock = db.prepare('UPDATE products SET stock = ? WHERE id = ?')

  const tx = db.transaction(() => {
    insert.run(productId, type, quantityChange, typeof note === 'string' ? note.trim() : '')
    updateStock.run(newStock, productId)
  })
  tx()

  const row = db.prepare(`${SELECT_MOVEMENT} WHERE m.id = last_insert_rowid()`).get() as MovementRow
  res.status(201).json({ movement: row, newStock })
})
