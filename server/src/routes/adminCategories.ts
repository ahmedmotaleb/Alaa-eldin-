import { Router } from 'express'
import { pool } from '../db.js'
import { requireAdmin } from '../auth.js'

export const adminCategoriesRouter = Router()
adminCategoriesRouter.use(requireAdmin)

interface CategoryRow {
  id: string
  name: string
  emoji: string
  tint: string
}

adminCategoriesRouter.get('/', async (_req, res) => {
  const { rows: categories } = await pool.query<CategoryRow>('SELECT id, name, emoji, tint FROM categories ORDER BY sort_order')
  const { rows: counts } = await pool.query<{ categoryId: string, n: string }>('SELECT category_id as "categoryId", COUNT(*) as n FROM products GROUP BY category_id')
  const countMap = new Map(counts.map(c => [c.categoryId, Number(c.n)]))
  res.json({ categories: categories.map(c => ({ ...c, productCount: countMap.get(c.id) ?? 0 })) })
})

adminCategoriesRouter.post('/', async (req, res) => {
  const { id, name, emoji, tint } = req.body ?? {}
  if (
    typeof id !== 'string' || !id.trim() ||
    typeof name !== 'string' || !name.trim() ||
    typeof emoji !== 'string' || !emoji.trim() ||
    typeof tint !== 'string' || !tint.trim()
  ) {
    res.status(400).json({ error: 'missing_fields' })
    return
  }

  const { rows: existingRows } = await pool.query('SELECT id FROM categories WHERE id = $1', [id])
  if (existingRows[0]) {
    res.status(409).json({ error: 'category_id_taken' })
    return
  }

  const { rows: maxRows } = await pool.query<{ m: number | null }>('SELECT MAX(sort_order) as m FROM categories')
  const maxOrder = maxRows[0].m ?? 0
  await pool.query(
    'INSERT INTO categories (id, name, emoji, tint, sort_order) VALUES ($1, $2, $3, $4, $5)',
    [id.trim(), name.trim(), emoji.trim(), tint.trim(), maxOrder + 1]
  )

  res.status(201).json({ category: { id: id.trim(), name: name.trim(), emoji: emoji.trim(), tint: tint.trim(), productCount: 0 } })
})
