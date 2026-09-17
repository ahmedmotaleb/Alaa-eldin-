import { Router } from 'express'
import { pool } from '../db.js'
import { requireAdmin } from '../auth.js'
import { findDiscount, type DiscountRow } from '../discounts.js'

export const adminDiscountsRouter = Router()
adminDiscountsRouter.use(requireAdmin)

const SELECT_DISCOUNT = `
  SELECT code, type, value, min_order as "minOrder", max_uses as "maxUses", used_count as "usedCount",
         active, expires_at as "expiresAt", created_at as "createdAt", starts_at as "startsAt",
         scope, scope_id as "scopeId", min_quantity as "minQuantity", first_order_only as "firstOrderOnly",
         free_delivery as "freeDelivery", max_uses_per_customer as "maxUsesPerCustomer"
  FROM discounts
`

function serialize(row: DiscountRow) {
  return { ...row, active: !!row.active, firstOrderOnly: !!row.firstOrderOnly, freeDelivery: !!row.freeDelivery }
}

const MAX_LIMIT = 100
const DEFAULT_LIMIT = 20

adminDiscountsRouter.get('/', async (req, res) => {
  // الترقيم والبحث اختياريان (opt-in) — لو مفيش page/limit، بيرجع كل أكواد الخصم زي ما
  // كان الحال دايماً، عشان أي استدعاء قديم ما ينكسرش بصمت.
  const paginationRequested = req.query.page !== undefined || req.query.limit !== undefined
  const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1)
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(String(req.query.limit ?? String(DEFAULT_LIMIT)), 10) || DEFAULT_LIMIT))
  const offset = (page - 1) * limit

  const params: unknown[] = []
  let whereClause = ''
  if (typeof req.query.search === 'string' && req.query.search.trim()) {
    params.push(`%${req.query.search.trim().toUpperCase()}%`)
    whereClause = `WHERE code ILIKE $${params.length}`
  }

  if (!paginationRequested) {
    const { rows } = await pool.query<DiscountRow>(`${SELECT_DISCOUNT} ${whereClause} ORDER BY created_at DESC`, params)
    res.json({ discounts: rows.map(serialize) })
    return
  }

  const { rows: countRows } = await pool.query<{ n: string }>(`SELECT COUNT(*) as n FROM discounts ${whereClause}`, params)
  const total = Number(countRows[0].n)

  const { rows } = await pool.query<DiscountRow>(
    `${SELECT_DISCOUNT} ${whereClause} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset]
  )
  res.json({
    discounts: rows.map(serialize),
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit))
  })
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

  const scope = b.scope === 'category' || b.scope === 'product' ? b.scope : 'order'
  const scopeId = scope !== 'order' && typeof b.scopeId === 'string' && b.scopeId.trim() ? b.scopeId.trim() : null
  if (scope !== 'order' && !scopeId) return null

  const minOrder = typeof b.minOrder === 'number' && b.minOrder >= 0 ? b.minOrder : 0
  const maxUses = typeof b.maxUses === 'number' && b.maxUses > 0 ? Math.round(b.maxUses) : null
  const maxUsesPerCustomer = typeof b.maxUsesPerCustomer === 'number' && b.maxUsesPerCustomer > 0 ? Math.round(b.maxUsesPerCustomer) : null
  const minQuantity = typeof b.minQuantity === 'number' && b.minQuantity > 0 ? Math.round(b.minQuantity) : null
  const expiresAt = typeof b.expiresAt === 'string' && b.expiresAt.trim() ? b.expiresAt : null
  const startsAt = typeof b.startsAt === 'string' && b.startsAt.trim() ? b.startsAt : null

  return {
    code: b.code.trim().toUpperCase(),
    type: b.type as 'percentage' | 'fixed',
    value: b.value as number,
    minOrder,
    maxUses,
    active: b.active as boolean,
    expiresAt,
    startsAt,
    scope: scope as 'order' | 'category' | 'product',
    scopeId,
    minQuantity,
    firstOrderOnly: b.firstOrderOnly === true,
    freeDelivery: b.freeDelivery === true,
    maxUsesPerCustomer
  }
}

async function scopeTargetExists(scope: 'order' | 'category' | 'product', scopeId: string | null): Promise<boolean> {
  if (scope === 'order') return true
  const table = scope === 'category' ? 'categories' : 'products'
  const { rows } = await pool.query(`SELECT 1 FROM ${table} WHERE id = $1`, [scopeId])
  return rows.length > 0
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
  if (!(await scopeTargetExists(data.scope, data.scopeId))) {
    res.status(400).json({ error: 'scope_target_not_found' })
    return
  }

  await pool.query(
    `INSERT INTO discounts (
       code, type, value, min_order, max_uses, used_count, active, expires_at, starts_at,
       scope, scope_id, min_quantity, first_order_only, free_delivery, max_uses_per_customer, created_at
     ) VALUES ($1, $2, $3, $4, $5, 0, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
    [
      data.code, data.type, data.value, data.minOrder, data.maxUses, data.active ? 1 : 0, data.expiresAt, data.startsAt,
      data.scope, data.scopeId, data.minQuantity, data.firstOrderOnly ? 1 : 0, data.freeDelivery ? 1 : 0,
      data.maxUsesPerCustomer, new Date().toISOString()
    ]
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
  if (!(await scopeTargetExists(data.scope, data.scopeId))) {
    res.status(400).json({ error: 'scope_target_not_found' })
    return
  }

  // كود الخصم مفتاح أساسي ولا يمكن تغييره بعد الإنشاء — لتفادي كسر ربطه بالطلبات السابقة.
  await pool.query(
    `UPDATE discounts SET
       type=$1, value=$2, min_order=$3, max_uses=$4, active=$5, expires_at=$6, starts_at=$7,
       scope=$8, scope_id=$9, min_quantity=$10, first_order_only=$11, free_delivery=$12, max_uses_per_customer=$13
     WHERE code=$14`,
    [
      data.type, data.value, data.minOrder, data.maxUses, data.active ? 1 : 0, data.expiresAt, data.startsAt,
      data.scope, data.scopeId, data.minQuantity, data.firstOrderOnly ? 1 : 0, data.freeDelivery ? 1 : 0,
      data.maxUsesPerCustomer, existing.code
    ]
  )

  const { rows } = await pool.query<DiscountRow>(`${SELECT_DISCOUNT} WHERE code = $1`, [existing.code])
  res.json({ discount: serialize(rows[0]) })
})
