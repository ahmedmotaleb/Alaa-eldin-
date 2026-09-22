import { Router } from 'express'
import crypto from 'node:crypto'
import { pool, withTransaction } from '../db.js'
import { requirePermission } from '../auth.js'
import { SELECT_PROMOTION, listBundleItems, type PromotionRow, type PromotionBundleItemRow, type PromotionType } from '../services/promotionService.js'

export const adminPromotionsRouter = Router()
adminPromotionsRouter.use(requirePermission('discounts.manage'))

function serialize(row: PromotionRow, bundleItems: PromotionBundleItemRow[] = []) {
  return {
    ...row,
    active: !!row.active,
    bundleItems: row.type === 'bundle_fixed_price'
      ? bundleItems.map(b => ({ id: b.id, productId: b.productId, categoryId: b.categoryId, requiredQuantity: b.requiredQuantity }))
      : undefined
  }
}

const MAX_LIMIT = 100
const DEFAULT_LIMIT = 20

adminPromotionsRouter.get('/', async (req, res) => {
  const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1)
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(String(req.query.limit ?? String(DEFAULT_LIMIT)), 10) || DEFAULT_LIMIT))
  const offset = (page - 1) * limit

  const params: unknown[] = []
  const conditions: string[] = []
  if (typeof req.query.search === 'string' && req.query.search.trim()) {
    params.push(`%${req.query.search.trim()}%`)
    conditions.push(`name ILIKE $${params.length}`)
  }
  if (req.query.type === 'buy_x_get_y' || req.query.type === 'bundle_fixed_price') {
    params.push(req.query.type)
    conditions.push(`type = $${params.length}`)
  }
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  const { rows: countRows } = await pool.query<{ n: string }>(`SELECT COUNT(*) as n FROM promotions ${whereClause}`, params)
  const total = Number(countRows[0].n)

  const { rows } = await pool.query<PromotionRow>(
    `${SELECT_PROMOTION} ${whereClause} ORDER BY priority DESC, created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset]
  )
  const bundleItemsByPromotion = await listBundleItems(rows.filter(r => r.type === 'bundle_fixed_price').map(r => r.id))
  res.json({
    promotions: rows.map(r => serialize(r, bundleItemsByPromotion.get(r.id) ?? [])),
    page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit))
  })
})

adminPromotionsRouter.get('/:id', async (req, res) => {
  const { rows } = await pool.query<PromotionRow>(`${SELECT_PROMOTION} WHERE id = $1`, [req.params.id])
  const row = rows[0]
  if (!row) {
    res.status(404).json({ error: 'promotion_not_found' })
    return
  }
  const bundleItemsByPromotion = await listBundleItems([row.id])
  res.json({ promotion: serialize(row, bundleItemsByPromotion.get(row.id) ?? []) })
})

interface ValidatedBuyXGetY {
  type: 'buy_x_get_y'
  name: string
  active: boolean
  startsAt: string | null
  expiresAt: string | null
  priority: number
  maxApplicationsPerOrder: number | null
  triggerProductId: string | null
  triggerCategoryId: string | null
  buyQuantity: number
  getQuantity: number
  getDiscountPercent: number
  rewardProductId: string | null
  rewardCategoryId: string | null
}

interface ValidatedBundle {
  type: 'bundle_fixed_price'
  name: string
  active: boolean
  startsAt: string | null
  expiresAt: string | null
  priority: number
  maxApplicationsPerOrder: number | null
  bundlePrice: number
  bundleItems: { productId: string | null, categoryId: string | null, requiredQuantity: number }[]
}

function validateCommon(b: Record<string, unknown>) {
  if (typeof b.name !== 'string' || !b.name.trim() || typeof b.active !== 'boolean') return null
  const startsAt = typeof b.startsAt === 'string' && b.startsAt.trim() ? b.startsAt : null
  const expiresAt = typeof b.expiresAt === 'string' && b.expiresAt.trim() ? b.expiresAt : null
  const priority = typeof b.priority === 'number' ? Math.round(b.priority) : 0
  const maxApplicationsPerOrder = typeof b.maxApplicationsPerOrder === 'number' && b.maxApplicationsPerOrder > 0
    ? Math.round(b.maxApplicationsPerOrder) : null
  return { name: b.name.trim(), active: b.active, startsAt, expiresAt, priority, maxApplicationsPerOrder }
}

function validateBody(body: unknown): ValidatedBuyXGetY | ValidatedBundle | null {
  const b = body as Record<string, unknown>
  if (b?.type !== 'buy_x_get_y' && b?.type !== 'bundle_fixed_price') return null
  const common = validateCommon(b)
  if (!common) return null

  if (b.type === 'buy_x_get_y') {
    const triggerProductId = typeof b.triggerProductId === 'string' && b.triggerProductId.trim() ? b.triggerProductId.trim() : null
    const triggerCategoryId = typeof b.triggerCategoryId === 'string' && b.triggerCategoryId.trim() ? b.triggerCategoryId.trim() : null
    if ((triggerProductId === null) === (triggerCategoryId === null)) return null // بالظبط واحد لازم يتحدد
    const rewardProductId = typeof b.rewardProductId === 'string' && b.rewardProductId.trim() ? b.rewardProductId.trim() : null
    const rewardCategoryId = typeof b.rewardCategoryId === 'string' && b.rewardCategoryId.trim() ? b.rewardCategoryId.trim() : null
    if (rewardProductId && rewardCategoryId) return null // مينفعش الاتنين مع بعض

    if (typeof b.buyQuantity !== 'number' || b.buyQuantity <= 0) return null
    if (typeof b.getQuantity !== 'number' || b.getQuantity <= 0) return null
    if (typeof b.getDiscountPercent !== 'number' || b.getDiscountPercent <= 0 || b.getDiscountPercent > 100) return null

    return {
      type: 'buy_x_get_y', ...common,
      triggerProductId, triggerCategoryId,
      buyQuantity: Math.round(b.buyQuantity), getQuantity: Math.round(b.getQuantity), getDiscountPercent: b.getDiscountPercent,
      rewardProductId, rewardCategoryId
    }
  }

  if (typeof b.bundlePrice !== 'number' || b.bundlePrice <= 0) return null
  if (!Array.isArray(b.bundleItems) || b.bundleItems.length === 0) return null
  const bundleItems: { productId: string | null, categoryId: string | null, requiredQuantity: number }[] = []
  for (const raw of b.bundleItems) {
    const item = raw as Record<string, unknown>
    const productId = typeof item?.productId === 'string' && item.productId.trim() ? item.productId.trim() : null
    const categoryId = typeof item?.categoryId === 'string' && item.categoryId.trim() ? item.categoryId.trim() : null
    if ((productId === null) === (categoryId === null)) return null
    const requiredQuantity = typeof item?.requiredQuantity === 'number' && item.requiredQuantity > 0 ? Math.round(item.requiredQuantity) : null
    if (requiredQuantity === null) return null
    bundleItems.push({ productId, categoryId, requiredQuantity })
  }

  return { type: 'bundle_fixed_price', ...common, bundlePrice: b.bundlePrice, bundleItems }
}

async function targetsExist(refs: { productId: string | null, categoryId: string | null }[]): Promise<boolean> {
  for (const ref of refs) {
    if (ref.productId) {
      const { rows } = await pool.query('SELECT 1 FROM products WHERE id = $1', [ref.productId])
      if (rows.length === 0) return false
    }
    if (ref.categoryId) {
      const { rows } = await pool.query('SELECT 1 FROM categories WHERE id = $1', [ref.categoryId])
      if (rows.length === 0) return false
    }
  }
  return true
}

adminPromotionsRouter.post('/', async (req, res) => {
  const data = validateBody(req.body)
  if (!data) {
    res.status(400).json({ error: 'missing_fields' })
    return
  }

  const refsToCheck = data.type === 'buy_x_get_y'
    ? [
        { productId: data.triggerProductId, categoryId: data.triggerCategoryId },
        ...(data.rewardProductId || data.rewardCategoryId ? [{ productId: data.rewardProductId, categoryId: data.rewardCategoryId }] : [])
      ]
    : data.bundleItems
  if (!(await targetsExist(refsToCheck))) {
    res.status(400).json({ error: 'target_not_found' })
    return
  }

  const id = `promo_${crypto.randomBytes(10).toString('hex')}`
  await withTransaction(async client => {
    if (data.type === 'buy_x_get_y') {
      await client.query(
        `INSERT INTO promotions (
           id, name, type, active, starts_at, expires_at, priority, max_applications_per_order,
           trigger_product_id, trigger_category_id, buy_quantity, get_quantity, get_discount_percent,
           reward_product_id, reward_category_id, created_by
         ) VALUES ($1,$2,'buy_x_get_y',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [
          id, data.name, data.active ? 1 : 0, data.startsAt, data.expiresAt, data.priority, data.maxApplicationsPerOrder,
          data.triggerProductId, data.triggerCategoryId, data.buyQuantity, data.getQuantity, data.getDiscountPercent,
          data.rewardProductId, data.rewardCategoryId, req.user!.id
        ]
      )
    } else {
      await client.query(
        `INSERT INTO promotions (id, name, type, active, starts_at, expires_at, priority, max_applications_per_order, bundle_price, created_by)
         VALUES ($1,$2,'bundle_fixed_price',$3,$4,$5,$6,$7,$8,$9)`,
        [id, data.name, data.active ? 1 : 0, data.startsAt, data.expiresAt, data.priority, data.maxApplicationsPerOrder, data.bundlePrice, req.user!.id]
      )
      for (const item of data.bundleItems) {
        await client.query(
          `INSERT INTO promotion_bundle_items (promotion_id, product_id, category_id, required_quantity) VALUES ($1,$2,$3,$4)`,
          [id, item.productId, item.categoryId, item.requiredQuantity]
        )
      }
    }
  })

  const { rows } = await pool.query<PromotionRow>(`${SELECT_PROMOTION} WHERE id = $1`, [id])
  const bundleItemsByPromotion = await listBundleItems([id])
  res.status(201).json({ promotion: serialize(rows[0], bundleItemsByPromotion.get(id) ?? []) })
})

adminPromotionsRouter.patch('/:id', async (req, res) => {
  const { rows: existingRows } = await pool.query<PromotionRow>(`${SELECT_PROMOTION} WHERE id = $1`, [req.params.id])
  const existing = existingRows[0]
  if (!existing) {
    res.status(404).json({ error: 'promotion_not_found' })
    return
  }

  // النوع (buy_x_get_y مقابل bundle_fixed_price) ثابت بعد الإنشاء ولا يمكن تغييره — تغييره
  // يعني عملياً عرض مختلف تماماً، والأصح إنشاء عرض جديد بدل تحويل عرض قائم.
  const merged = { ...req.body, type: existing.type }
  const data = validateBody(merged)
  if (!data) {
    res.status(400).json({ error: 'missing_fields' })
    return
  }

  const refsToCheck = data.type === 'buy_x_get_y'
    ? [
        { productId: data.triggerProductId, categoryId: data.triggerCategoryId },
        ...(data.rewardProductId || data.rewardCategoryId ? [{ productId: data.rewardProductId, categoryId: data.rewardCategoryId }] : [])
      ]
    : data.bundleItems
  if (!(await targetsExist(refsToCheck))) {
    res.status(400).json({ error: 'target_not_found' })
    return
  }

  await withTransaction(async client => {
    if (data.type === 'buy_x_get_y') {
      await client.query(
        `UPDATE promotions SET
           name=$1, active=$2, starts_at=$3, expires_at=$4, priority=$5, max_applications_per_order=$6,
           trigger_product_id=$7, trigger_category_id=$8, buy_quantity=$9, get_quantity=$10, get_discount_percent=$11,
           reward_product_id=$12, reward_category_id=$13
         WHERE id=$14`,
        [
          data.name, data.active ? 1 : 0, data.startsAt, data.expiresAt, data.priority, data.maxApplicationsPerOrder,
          data.triggerProductId, data.triggerCategoryId, data.buyQuantity, data.getQuantity, data.getDiscountPercent,
          data.rewardProductId, data.rewardCategoryId, existing.id
        ]
      )
    } else {
      await client.query(
        `UPDATE promotions SET name=$1, active=$2, starts_at=$3, expires_at=$4, priority=$5, max_applications_per_order=$6, bundle_price=$7
         WHERE id=$8`,
        [data.name, data.active ? 1 : 0, data.startsAt, data.expiresAt, data.priority, data.maxApplicationsPerOrder, data.bundlePrice, existing.id]
      )
      await client.query('DELETE FROM promotion_bundle_items WHERE promotion_id = $1', [existing.id])
      for (const item of data.bundleItems) {
        await client.query(
          `INSERT INTO promotion_bundle_items (promotion_id, product_id, category_id, required_quantity) VALUES ($1,$2,$3,$4)`,
          [existing.id, item.productId, item.categoryId, item.requiredQuantity]
        )
      }
    }
  })

  const { rows } = await pool.query<PromotionRow>(`${SELECT_PROMOTION} WHERE id = $1`, [existing.id])
  const bundleItemsByPromotion = await listBundleItems([existing.id])
  res.json({ promotion: serialize(rows[0], bundleItemsByPromotion.get(existing.id) ?? []) })
})

adminPromotionsRouter.delete('/:id', async (req, res) => {
  const result = await pool.query('DELETE FROM promotions WHERE id = $1', [req.params.id])
  if ((result.rowCount ?? 0) === 0) {
    res.status(404).json({ error: 'promotion_not_found' })
    return
  }
  res.status(204).end()
})
