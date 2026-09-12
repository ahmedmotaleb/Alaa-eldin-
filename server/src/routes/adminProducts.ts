import { Router } from 'express'
import crypto from 'node:crypto'
import { pool, withTransaction } from '../db.js'
import { requireAdmin, requirePermission } from '../auth.js'
import { recordAuditLog } from '../services/auditLogService.js'
import { logEvent } from '../logger.js'
import { setProductSku, generateSkuForProduct, findProductByBarcode } from '../services/productSkuService.js'

export const adminProductsRouter = Router()
adminProductsRouter.use(requireAdmin)

interface ProductRow {
  id: string
  slug: string
  categoryId: string
  name: string
  description: string
  price: number
  oldPrice: number | null
  cost: number
  unit: string
  emoji: string
  available: number
  bestseller: number
  offer: number
  orderCount: number
  stock: number
  alertThreshold: number
  barcode: string
  brand: string
  primaryImage: string | null
  tracksExpiry: number
  defaultShelfLifeDays: number | null
  sku: string | null
}

const SELECT_PRODUCT = `
  SELECT id, slug, category_id as "categoryId", name, description, price, old_price as "oldPrice", cost,
         unit, emoji, available, bestseller, offer, order_count as "orderCount", stock, alert_threshold as "alertThreshold",
         barcode, brand, tracks_expiry as "tracksExpiry", default_shelf_life_days as "defaultShelfLifeDays", sku
  FROM products
`

const SELECT_PRODUCT_WITH_IMAGE = `
  SELECT p.id, p.slug, p.category_id as "categoryId", p.name, p.description, p.price, p.old_price as "oldPrice", p.cost,
         p.unit, p.emoji, p.available, p.bestseller, p.offer, p.order_count as "orderCount", p.stock, p.alert_threshold as "alertThreshold",
         p.barcode, p.brand, p.tracks_expiry as "tracksExpiry", p.default_shelf_life_days as "defaultShelfLifeDays", p.sku, img.image_url as "primaryImage"
  FROM products p
  LEFT JOIN LATERAL (
    SELECT image_url FROM product_images pi
    WHERE pi.product_id = p.id
    ORDER BY pi.is_primary DESC, pi.sort_order ASC
    LIMIT 1
  ) img ON true
`

function serialize(row: ProductRow) {
  return {
    ...row,
    oldPrice: row.oldPrice ?? undefined,
    available: !!row.available,
    bestseller: !!row.bestseller,
    offer: !!row.offer,
    primaryImage: row.primaryImage ?? undefined,
    tracksExpiry: !!row.tracksExpiry
  }
}

const MAX_LIMIT = 100
const DEFAULT_LIMIT = 20

adminProductsRouter.get('/', requirePermission('products.view'), async (req, res) => {
  // الترقيم والبحث اختياريان (opt-in) — لو مفيش page/limit، بيرجع كل المنتجات زي ما كان
  // الحال دايماً، عشان أي استدعاء قديم ما ينكسرش بصمت.
  const paginationRequested = req.query.page !== undefined || req.query.limit !== undefined
  const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1)
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(String(req.query.limit ?? String(DEFAULT_LIMIT)), 10) || DEFAULT_LIMIT))
  const offset = (page - 1) * limit

  const conditions: string[] = []
  const params: unknown[] = []
  if (typeof req.query.search === 'string' && req.query.search.trim()) {
    params.push(`%${req.query.search.trim()}%`)
    conditions.push(`(p.name ILIKE $${params.length} OR p.id ILIKE $${params.length} OR p.barcode ILIKE $${params.length} OR p.sku ILIKE $${params.length})`)
  }
  if (typeof req.query.categoryId === 'string' && req.query.categoryId.trim()) {
    params.push(req.query.categoryId.trim())
    conditions.push(`p.category_id = $${params.length}`)
  }
  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

  if (!paginationRequested) {
    const { rows } = await pool.query<ProductRow>(`${SELECT_PRODUCT_WITH_IMAGE} ${whereClause} ORDER BY p.name`, params)
    res.json({ products: rows.map(serialize) })
    return
  }

  const { rows: countRows } = await pool.query<{ n: string }>(`SELECT COUNT(*) as n FROM products p ${whereClause}`, params)
  const total = Number(countRows[0].n)

  const { rows } = await pool.query<ProductRow>(
    `${SELECT_PRODUCT_WITH_IMAGE} ${whereClause} ORDER BY p.name LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset]
  )
  res.json({
    products: rows.map(serialize),
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit))
  })
})

adminProductsRouter.get('/:id', requirePermission('products.view'), async (req, res) => {
  const { rows } = await pool.query<ProductRow>(`${SELECT_PRODUCT} WHERE id = $1`, [req.params.id])
  const row = rows[0]
  if (!row) {
    res.status(404).json({ error: 'product_not_found' })
    return
  }
  res.json({ product: serialize(row) })
})

// إعداد تتبع الصلاحية منفصل عن نموذج المنتج الرئيسي عن قصد — تعديل بسيط ومعزول، بدل ما
// يتوسّع التحقق الكبير الحالي لبيانات المنتج (validateBody) عشان حقلين اختياريين بس.
adminProductsRouter.patch('/:id/expiry-settings', requirePermission('products.edit'), async (req, res) => {
  const tracksExpiry = req.body?.tracksExpiry
  const defaultShelfLifeDays = req.body?.defaultShelfLifeDays
  if (typeof tracksExpiry !== 'boolean') { res.status(400).json({ error: 'invalid_tracks_expiry' }); return }
  if (defaultShelfLifeDays !== null && defaultShelfLifeDays !== undefined && (typeof defaultShelfLifeDays !== 'number' || defaultShelfLifeDays <= 0)) {
    res.status(400).json({ error: 'invalid_shelf_life' })
    return
  }

  const { rows } = await pool.query<ProductRow>(
    `UPDATE products SET tracks_expiry = $2, default_shelf_life_days = $3 WHERE id = $1
     RETURNING id, slug, category_id as "categoryId", name, description, price, old_price as "oldPrice", cost,
               unit, emoji, available, bestseller, offer, order_count as "orderCount", stock, alert_threshold as "alertThreshold",
               barcode, brand, tracks_expiry as "tracksExpiry", default_shelf_life_days as "defaultShelfLifeDays"`,
    [req.params.id, tracksExpiry ? 1 : 0, defaultShelfLifeDays ?? null]
  )
  if (!rows[0]) { res.status(404).json({ error: 'product_not_found' }); return }

  await recordAuditLog({
    adminUserId: req.user!.id,
    action: 'product_expiry_settings_updated',
    entityType: 'product',
    entityId: String(req.params.id),
    newValues: { tracksExpiry, defaultShelfLifeDays }
  })
  res.json({ product: serialize(rows[0]) })
})

// SKU مستقل عن نموذج المنتج الرئيسي (زي إعداد الصلاحية) — تعديل يدوي بسيط، أو توليد تلقائي
// بصيغة ALA-XXXXXX (راجع productSkuService.ts). التوليد التلقائي أبداً ما بيكتبش فوق SKU
// موجود بالفعل.
adminProductsRouter.patch('/:id/sku', requirePermission('products.edit'), async (req, res) => {
  const raw = req.body?.sku
  if (raw !== null && typeof raw !== 'string') { res.status(400).json({ error: 'invalid_sku' }); return }

  try {
    const result = await setProductSku(String(req.params.id), raw)
    if ('error' in result) { res.status(404).json({ error: result.error }); return }

    await recordAuditLog({
      adminUserId: req.user!.id, action: 'product_sku_updated', entityType: 'product',
      entityId: String(req.params.id), newValues: { sku: result.sku }
    })
    res.json(result)
  } catch (err) {
    if (err instanceof Error && 'code' in err && (err as { code: string }).code === '23505') {
      res.status(409).json({ error: 'sku_taken' })
      return
    }
    throw err
  }
})

adminProductsRouter.post('/:id/generate-sku', requirePermission('products.edit'), async (req, res) => {
  const result = await generateSkuForProduct(String(req.params.id))
  if ('error' in result) {
    res.status(result.error === 'product_not_found' ? 404 : 409).json({ error: result.error })
    return
  }

  await recordAuditLog({
    adminUserId: req.user!.id, action: 'product_sku_updated', entityType: 'product',
    entityId: String(req.params.id), newValues: { sku: result.sku }
  })
  res.json(result)
})

// بحث بالباركود لصفحة "مسح الباركود" — تطابق تام (مسح فعلي أو إدخال يدوي/جهاز قارئ).
adminProductsRouter.get('/by-barcode/:barcode', requirePermission('products.view'), async (req, res) => {
  const product = await findProductByBarcode(String(req.params.barcode))
  if (!product) { res.status(404).json({ error: 'product_not_found' }); return }
  res.json({ product })
})

async function validateBody(body: unknown) {
  const b = body as Record<string, unknown>
  if (
    typeof b?.slug !== 'string' || !b.slug.trim() ||
    typeof b?.categoryId !== 'string' || !b.categoryId.trim() ||
    typeof b?.name !== 'string' || !b.name.trim() ||
    typeof b?.description !== 'string' ||
    typeof b?.price !== 'number' || b.price <= 0 ||
    typeof b?.cost !== 'number' || b.cost < 0 ||
    typeof b?.unit !== 'string' || !b.unit.trim() ||
    typeof b?.emoji !== 'string' ||
    typeof b?.available !== 'boolean' ||
    typeof b?.stock !== 'number' || b.stock < 0 ||
    typeof b?.alertThreshold !== 'number' || b.alertThreshold < 0
  ) return null

  const { rows: categoryRows } = await pool.query('SELECT id FROM categories WHERE id = $1', [b.categoryId])
  if (!categoryRows[0]) return null

  return {
    slug: b.slug.trim(),
    categoryId: b.categoryId as string,
    name: (b.name as string).trim(),
    description: (b.description as string).trim(),
    price: b.price as number,
    oldPrice: typeof b.oldPrice === 'number' && b.oldPrice > 0 ? b.oldPrice : null,
    cost: b.cost as number,
    unit: (b.unit as string).trim(),
    emoji: (b.emoji as string).trim(),
    available: b.available as boolean,
    bestseller: !!b.bestseller,
    offer: !!b.offer,
    stock: b.stock as number,
    alertThreshold: b.alertThreshold as number,
    barcode: typeof b.barcode === 'string' ? b.barcode.trim() : '',
    brand: typeof b.brand === 'string' ? b.brand.trim() : ''
  }
}

adminProductsRouter.post('/', requirePermission('products.create'), async (req, res) => {
  const data = await validateBody(req.body)
  if (!data) {
    res.status(400).json({ error: 'missing_fields' })
    return
  }

  const { rows: existingRows } = await pool.query('SELECT id FROM products WHERE slug = $1', [data.slug])
  if (existingRows[0]) {
    res.status(409).json({ error: 'slug_taken' })
    return
  }

  const id = 'p' + crypto.randomBytes(4).toString('hex')
  await pool.query(
    `INSERT INTO products (id, slug, category_id, name, description, price, old_price, cost, unit, emoji, available, bestseller, offer, order_count, stock, alert_threshold, barcode, brand, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 0, $14, $15, $16, $17, $18)`,
    [
      id, data.slug, data.categoryId, data.name, data.description, data.price, data.oldPrice, data.cost, data.unit, data.emoji,
      data.available ? 1 : 0, data.bestseller ? 1 : 0, data.offer ? 1 : 0, data.stock, data.alertThreshold, data.barcode, data.brand,
      new Date().toISOString()
    ]
  )

  const { rows } = await pool.query<ProductRow>(`${SELECT_PRODUCT} WHERE id = $1`, [id])
  logEvent('admin_product_created', { productId: id })
  await recordAuditLog({
    adminUserId: req.user!.id,
    action: 'product_created',
    entityType: 'product',
    entityId: id,
    newValues: serialize(rows[0])
  })
  res.status(201).json({ product: serialize(rows[0]) })
})

adminProductsRouter.patch('/:id', requirePermission('products.edit'), async (req, res) => {
  const { rows: existingRows } = await pool.query<ProductRow>(`${SELECT_PRODUCT} WHERE id = $1`, [req.params.id])
  const existing = existingRows[0]
  if (!existing) {
    res.status(404).json({ error: 'product_not_found' })
    return
  }

  const data = await validateBody({ ...serialize(existing), ...(req.body ?? {}) })
  if (!data) {
    res.status(400).json({ error: 'missing_fields' })
    return
  }

  if (data.slug) {
    const { rows: slugOwnerRows } = await pool.query('SELECT id FROM products WHERE slug = $1 AND id != $2', [data.slug, req.params.id])
    if (slugOwnerRows[0]) {
      res.status(409).json({ error: 'slug_taken' })
      return
    }
  }

  const stockDiff = data.stock - existing.stock

  await withTransaction(async client => {
    await client.query(
      `UPDATE products SET slug=$1, category_id=$2, name=$3, description=$4, price=$5,
         old_price=$6, cost=$7, unit=$8, emoji=$9, available=$10, bestseller=$11,
         offer=$12, stock=$13, alert_threshold=$14, barcode=$15, brand=$16
       WHERE id=$17`,
      [
        data.slug, data.categoryId, data.name, data.description, data.price,
        data.oldPrice, data.cost, data.unit, data.emoji, data.available ? 1 : 0, data.bestseller ? 1 : 0,
        data.offer ? 1 : 0, data.stock, data.alertThreshold, data.barcode, data.brand,
        req.params.id
      ]
    )
    if (stockDiff !== 0) {
      await client.query(
        `INSERT INTO stock_movements (product_id, type, quantity_change, note, created_at)
         VALUES ($1, 'adjustment', $2, 'تعديل من صفحة المنتج', $3)`,
        [req.params.id, stockDiff, new Date().toISOString()]
      )
    }
    // تعديل تكلفة يدوي من صفحة المنتج بيتسجّل في نفس تاريخ التكلفة اللي بيتسجّل منه
    // الاستلام (source_type مختلف بس) — عشان تحليل الهامش يشوف كل تغيير تكلفة حقيقي،
    // مش بس اللي جاي من استلام بضاعة.
    if (data.cost !== existing.cost) {
      await client.query(
        `INSERT INTO product_cost_history (id, product_id, unit_cost, source_type, source_id)
         VALUES ($1, $2, $3, 'manual_adjustment', $4)`,
        [crypto.randomUUID(), req.params.id, data.cost, req.user!.id]
      )
    }
  })

  const { rows } = await pool.query<ProductRow>(`${SELECT_PRODUCT} WHERE id = $1`, [req.params.id])
  const before = serialize(existing)
  const after = serialize(rows[0])

  logEvent('admin_product_updated', { productId: req.params.id })
  if (stockDiff !== 0) logEvent('admin_stock_adjusted', { productId: req.params.id, quantityChange: stockDiff })
  await recordAuditLog({
    adminUserId: req.user!.id,
    action: before.available !== after.available && !after.available ? 'product_archived' : 'product_updated',
    entityType: 'product',
    entityId: String(req.params.id),
    oldValues: before,
    newValues: after
  })

  res.json({ product: after })
})
