import { Router } from 'express'
import { pool } from '../db.js'

export const catalogRouter = Router()

interface CategoryRow {
  id: string
  name: string
  emoji: string
  tint: string
}

interface ProductRow {
  id: string
  slug: string
  categoryId: string
  name: string
  description: string
  price: number
  oldPrice: number | null
  unit: string
  emoji: string
  available: number
  bestseller: number
  offer: number
  orderCount: number
}

function serializeProduct(row: ProductRow) {
  return {
    id: row.id,
    slug: row.slug,
    categoryId: row.categoryId,
    name: row.name,
    description: row.description,
    price: row.price,
    oldPrice: row.oldPrice ?? undefined,
    unit: row.unit,
    emoji: row.emoji,
    available: !!row.available,
    bestseller: !!row.bestseller,
    offer: !!row.offer,
    orderCount: row.orderCount
  }
}

catalogRouter.get('/categories', async (_req, res) => {
  const { rows } = await pool.query<CategoryRow>('SELECT id, name, emoji, tint FROM categories ORDER BY sort_order')
  res.json({ categories: rows })
})

catalogRouter.get('/products', async (_req, res) => {
  const { rows } = await pool.query<ProductRow>(`
    SELECT id, slug, category_id as "categoryId", name, description, price, old_price as "oldPrice",
           unit, emoji, available, bestseller, offer, order_count as "orderCount"
    FROM products ORDER BY name
  `)
  res.json({ products: rows.map(serializeProduct) })
})
