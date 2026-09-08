import { Router } from 'express'
import { pool } from '../db.js'
import { requireAdmin } from '../auth.js'
import { findDiscount, type DiscountRow } from '../discounts.js'

export const adminDiscountsRouter = Router()
adminDiscountsRouter.use(requireAdmin)

const SELECT_DISCOUNT = `
  SELECT code, type, value, min_order as "minOrder", max_uses as "maxUses", used_count as "usedCount",
         active, expires_at as "expiresAt", created_at as "createdAt"
  FROM discounts
`

function serialize(row: DiscountRow) {
  return { ...row, active: !!row.active }
}

adminDiscountsRouter.get('/', async (_req, res) => {
  const { rows } = await pool.query<DiscountRow>(`${SELECT_DISCOUNT} ORDER BY created_at DESC`)
  res.json({ discounts: rows.map(serialize) })
})

function validateBody(body: unknown) {
  const b = body as Record<string, unknown>
  if (
    typeof b?.code !== 'string' || !b.code.trim() ||
    (b?.type !== 'percentage' && b?.type !== 'fixed') ||
    typeof b?.value !== 'number' || b.value <= 0 ||
    (b.type === 'percentage' && b.value > 100) ||
    typeof b?.active !== 'boolean'
  ) return null

  const minOrder = typeof b.minOrder === 'number' && b.minOrder >= 0 ? b.minOrder : 0
  const maxUses = typeof b.maxUses === 'number' && b.maxUses > 0 ? Math.round(b.maxUses) : null
  const expiresAt = typeof b.expiresAt === 'string' && b.expiresAt.trim() ? b.expiresAt : null

  return {
    code: b.code.trim().toUpperCase(),
    type: b.type as 'percentage' | 'fixed',
    value: b.value as number,
    minOrder,
    maxUses,
    active: b.active as boolean,
    expiresAt
  }
}

adminDiscountsRouter.post('/', async (req, res) => {
  const data = validateBody(req.body)
  if (!data) {
    res.status(400).json({ error: 'missing_fields' })
    return
  }

  if (await findDiscount(data.code)) {
    res.status(409).json({ error: 'code_taken' })
    return
  }

  await pool.query(
    `INSERT INTO discounts (code, type, value, min_order, max_uses, used_count, active, expires_at, created_at)
     VALUES ($1, $2, $3, $4, $5, 0, $6, $7, $8)`,
    [data.code, data.type, data.value, data.minOrder, data.maxUses, data.active ? 1 : 0, data.expiresAt, new Date().toISOString()]
  )

  const { rows } = await pool.query<DiscountRow>(`${SELECT_DISCOUNT} WHERE code = $1`, [data.code])
  res.status(201).json({ discount: serialize(rows[0]) })
})

adminDiscountsRouter.patch('/:code', async (req, res) => {
  const existing = await findDiscount(req.params.code)
  if (!existing) {
    res.status(404).json({ error: 'discount_not_found' })
    return
  }

  const data = validateBody({ ...serialize(existing), code: existing.code, ...(req.body ?? {}) })
  if (!data) {
    res.status(400).json({ error: 'missing_fields' })
    return
  }

  // كود الخصم مفتاح أساسي ولا يمكن تغييره بعد الإنشاء — لتفادي كسر ربطه بالطلبات السابقة.
  await pool.query(
    `UPDATE discounts SET type=$1, value=$2, min_order=$3, max_uses=$4, active=$5, expires_at=$6
     WHERE code=$7`,
    [data.type, data.value, data.minOrder, data.maxUses, data.active ? 1 : 0, data.expiresAt, existing.code]
  )

  const { rows } = await pool.query<DiscountRow>(`${SELECT_DISCOUNT} WHERE code = $1`, [existing.code])
  res.json({ discount: serialize(rows[0]) })
})
