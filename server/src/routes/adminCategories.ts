import { Router } from 'express'
import { db } from '../db.js'
import { requireAdmin } from '../auth.js'

export const adminCategoriesRouter = Router()
adminCategoriesRouter.use(requireAdmin)

interface CategoryRow {
  id: string
  name: string
  emoji: string
  tint: string
}

adminCategoriesRouter.get('/', (_req, res) => {
  const categories = db.prepare('SELECT id, name, emoji, tint FROM categories ORDER BY sort_order').all() as CategoryRow[]
  const counts = db.prepare('SELECT category_id as categoryId, COUNT(*) as n FROM products GROUP BY category_id').all() as { categoryId: string, n: number }[]
  const countMap = new Map(counts.map(c => [c.categoryId, c.n]))
  res.json({ categories: categories.map(c => ({ ...c, productCount: countMap.get(c.id) ?? 0 })) })
})

adminCategoriesRouter.post('/', (req, res) => {
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

  const existing = db.prepare('SELECT id FROM categories WHERE id = ?').get(id)
  if (existing) {
    res.status(409).json({ error: 'category_id_taken' })
    return
  }

  const maxOrder = (db.prepare('SELECT MAX(sort_order) as m FROM categories').get() as { m: number | null }).m ?? 0
  db.prepare('INSERT INTO categories (id, name, emoji, tint, sort_order) VALUES (?, ?, ?, ?, ?)')
    .run(id.trim(), name.trim(), emoji.trim(), tint.trim(), maxOrder + 1)

  res.status(201).json({ category: { id: id.trim(), name: name.trim(), emoji: emoji.trim(), tint: tint.trim(), productCount: 0 } })
})
