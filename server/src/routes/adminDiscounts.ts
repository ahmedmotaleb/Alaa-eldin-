import { Router } from 'express'
import { db } from '../db.js'
import { requireAdmin } from '../auth.js'
import { findDiscount, type DiscountRow } from '../discounts.js'

export const adminDiscountsRouter = Router()
adminDiscountsRouter.use(requireAdmin)

const SELECT_DISCOUNT = `
  SELECT code, type, value, min_order as minOrder, max_uses as maxUses, used_count as usedCount,
         active, expires_at as expiresAt, created_at as createdAt
  FROM discounts
`

function serialize(row: DiscountRow) {
  return { ...row, active: !!row.active }
}

adminDiscountsRouter.get('/', (_req, res) => {
  const rows = db.prepare(`${SELECT_DISCOUNT} ORDER BY created_at DESC`).all() as DiscountRow[]
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

adminDiscountsRouter.post('/', (req, res) => {
  const data = validateBody(req.body)
  if (!data) {
    res.status(400).json({ error: 'missing_fields' })
    return
  }

  if (findDiscount(data.code)) {
    res.status(409).json({ error: 'code_taken' })
    return
  }

  db.prepare(`
    INSERT INTO discounts (code, type, value, min_order, max_uses, used_count, active, expires_at)
    VALUES (@code, @type, @value, @minOrder, @maxUses, 0, @active, @expiresAt)
  `).run({ ...data, active: data.active ? 1 : 0 })

  const row = db.prepare(`${SELECT_DISCOUNT} WHERE code = ?`).get(data.code) as DiscountRow
  res.status(201).json({ discount: serialize(row) })
})

adminDiscountsRouter.patch('/:code', (req, res) => {
  const existing = findDiscount(req.params.code)
  if (!existing) {
    res.status(404).json({ error: 'discount_not_found' })
    return
  }

  const data = validateBody({ ...existing, code: existing.code, ...(req.body ?? {}) })
  if (!data) {
    res.status(400).json({ error: 'missing_fields' })
    return
  }

  // كود الخصم مفتاح أساسي ولا يمكن تغييره بعد الإنشاء — لتفادي كسر ربطه بالطلبات السابقة.
  db.prepare(`
    UPDATE discounts SET type=@type, value=@value, min_order=@minOrder, max_uses=@maxUses, active=@active, expires_at=@expiresAt
    WHERE code=@code
  `).run({ ...data, code: existing.code, active: data.active ? 1 : 0 })

  const row = db.prepare(`${SELECT_DISCOUNT} WHERE code = ?`).get(existing.code) as DiscountRow
  res.json({ discount: serialize(row) })
})
