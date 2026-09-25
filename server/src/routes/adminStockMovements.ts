import { Router } from 'express'
import { pool, withTransaction } from '../db.js'
import { requireAdmin } from '../auth.js'
import { notifyBackInStockIfNeeded } from '../services/backInStockService.js'
import { MANUAL_STOCK_REASONS } from '../services/bulkStockService.js'

export const adminStockMovementsRouter = Router()
adminStockMovementsRouter.use(requireAdmin)

const TYPES: readonly string[] = MANUAL_STOCK_REASONS

interface MovementRow {
  id: number
  productId: string
  variantId: string | null
  type: string
  quantityChange: number
  note: string
  createdAt: string
  productName: string
  productEmoji: string
  variantName: string | null
}

const SELECT_MOVEMENT = `
  SELECT m.id as id, m.product_id as "productId", m.variant_id as "variantId", m.type as type,
         m.quantity_change as "quantityChange", m.note as note, m.created_at as "createdAt",
         p.name as "productName", p.emoji as "productEmoji", v.name as "variantName"
  FROM stock_movements m
  JOIN products p ON p.id = m.product_id
  LEFT JOIN product_variants v ON v.id = m.variant_id
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
    conditions.push(`(p.name ILIKE $${params.length} OR v.name ILIKE $${params.length} OR m.note ILIKE $${params.length})`)
  }
  if (typeof req.query.productId === 'string' && req.query.productId.trim()) {
    params.push(req.query.productId.trim())
    conditions.push(`m.product_id = $${params.length}`)
  }
  if (typeof req.query.variantId === 'string' && req.query.variantId.trim()) {
    params.push(req.query.variantId.trim())
    conditions.push(`m.variant_id = $${params.length}`)
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
    `SELECT COUNT(*) as n FROM stock_movements m JOIN products p ON p.id = m.product_id LEFT JOIN product_variants v ON v.id = m.variant_id ${whereClause}`,
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
  const { productId, variantId, type, quantityChange, note } = req.body ?? {}

  if (
    typeof productId !== 'string' || !productId.trim() ||
    (variantId !== undefined && variantId !== null && (typeof variantId !== 'string' || !variantId.trim())) ||
    typeof type !== 'string' || !TYPES.includes(type) ||
    typeof quantityChange !== 'number' || !Number.isInteger(quantityChange) || quantityChange === 0
  ) {
    res.status(400).json({ error: 'missing_fields' })
    return
  }
  const normalizedVariantId: string | null = typeof variantId === 'string' && variantId.trim() ? variantId.trim() : null

  const result = await withTransaction(async client => {
    // قفل الصف (FOR UPDATE) لازم يحصل جوه نفس المعاملة اللي بتعمل التحديث — القراءة والتحديث
    // في معاملتين منفصلتين (زي ما كانت الحالة قبل كده) بيسمح بتصادم فعلي: تعديلين يدويين
    // متزامنين على نفس المنتج/المتغيّر ممكن يقرأوا نفس الرصيد القديم ويعديه كل واحد لوحده،
    // فيوصل الرصيد لسالب فعلياً رغم إن الشرط `newStock < 0` اتفحص في الاتنين قبل الكتابة.
    let newStock: number
    if (normalizedVariantId) {
      const { rows } = await client.query<{ stock: number }>(
        'SELECT stock FROM product_variants WHERE id = $1 AND product_id = $2 FOR UPDATE',
        [normalizedVariantId, productId]
      )
      if (!rows[0]) return { error: 'product_not_found' as const }
      newStock = rows[0].stock + quantityChange
      if (newStock < 0) return { error: 'insufficient_stock' as const }
      await client.query('UPDATE product_variants SET stock = $1 WHERE id = $2', [newStock, normalizedVariantId])
    } else {
      const { rows } = await client.query<{ stock: number }>('SELECT stock FROM products WHERE id = $1 FOR UPDATE', [productId])
      if (!rows[0]) return { error: 'product_not_found' as const }
      newStock = rows[0].stock + quantityChange
      if (newStock < 0) return { error: 'insufficient_stock' as const }
      await client.query('UPDATE products SET stock = $1 WHERE id = $2', [newStock, productId])
    }

    const { rows: movementRows } = await client.query<{ id: number }>(
      `INSERT INTO stock_movements (product_id, variant_id, type, quantity_change, note, created_at, quantity_before, quantity_after, created_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [
        productId, normalizedVariantId, type, quantityChange, typeof note === 'string' ? note.trim() : '',
        new Date().toISOString(), newStock - quantityChange, newStock, req.user!.id
      ]
    )
    await notifyBackInStockIfNeeded(client, productId, normalizedVariantId)
    return { movementId: movementRows[0].id, newStock }
  })

  if ('error' in result) {
    res.status(result.error === 'product_not_found' ? 404 : 400).json({ error: result.error })
    return
  }

  const { rows } = await pool.query<MovementRow>(`${SELECT_MOVEMENT} WHERE m.id = $1`, [result.movementId])
  res.status(201).json({ movement: rows[0], newStock: result.newStock })
})
