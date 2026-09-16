import { Router } from 'express'
import multer from 'multer'
import { pool } from '../db.js'
import { requireAdmin, requirePermission } from '../auth.js'
import { recordAuditLog } from '../services/auditLogService.js'
import { logEvent } from '../logger.js'
import { setProductSku, generateSkuForProduct, findProductByBarcode } from '../services/productSkuService.js'
import { toCsv, parseCsv, csvRecords } from '../csv.js'
import { validateImportRows, importValidatedRows, type ImportConfirmRow } from '../services/productImportService.js'
import { SELECT_PRODUCT, serializeProduct, createProduct, updateProduct, type ProductRow, type ProductWriteInput } from '../services/productService.js'

const csvUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } })

export const adminProductsRouter = Router()
adminProductsRouter.use(requireAdmin)

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
    res.json({ products: rows.map(serializeProduct) })
    return
  }

  const { rows: countRows } = await pool.query<{ n: string }>(`SELECT COUNT(*) as n FROM products p ${whereClause}`, params)
  const total = Number(countRows[0].n)

  const { rows } = await pool.query<ProductRow>(
    `${SELECT_PRODUCT_WITH_IMAGE} ${whereClause} ORDER BY p.name LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset]
  )
  res.json({
    products: rows.map(serializeProduct),
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit))
  })
})

// مسجّلة قبل '/:id' عمداً — نفس شكل المسار (segment واحد)، فلو اتسجلت بعده هيتقفل عليها
// '/:id' الأول (id='export') وميوصلوش الطلب هنا أبداً.
adminProductsRouter.get('/export', requirePermission('products.view'), async (_req, res) => {
  const { rows } = await pool.query<ProductRow>(`${SELECT_PRODUCT} ORDER BY name`)
  const csv = toCsv(
    ['id', 'sku', 'barcode', 'name', 'price', 'oldPrice', 'cost', 'stock', 'alertThreshold', 'available', 'brand'],
    rows.map(p => [p.id, p.sku ?? '', p.barcode, p.name, p.price, p.oldPrice ?? '', p.cost, p.stock, p.alertThreshold, p.available ? '1' : '0', p.brand])
  )
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', 'attachment; filename="products.csv"')
  res.send('﻿' + csv)
})

// استيراد جماعي — تحديث فقط لمنتجات موجودة بالفعل (المطابقة بالـ sku أولاً، وبالـ id
// كبديل)، ومقصور على حقول تشغيلية آمنة (سعر/تكلفة/مخزون/توفر) — عمداً بدون إنشاء منتجات
// جديدة من CSV (ده محتاج تحقق أوسع بكتير: slug فريد، قسم صحيح، إلخ) وبدون تعديل الاسم أو
// القسم، تقليلاً لمخاطر استيراد ملف فيه أخطاء يبوّظ الكتالوج. كل صف بيتقيّم لوحده والباقي
// بيكمل حتى لو صف واحد فشل.
adminProductsRouter.post('/import', requirePermission('products.edit'), csvUpload.single('file'), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'missing_file' })
    return
  }

  const records = csvRecords(parseCsv(req.file.buffer.toString('utf-8')))
  let updated = 0
  const skipped: { row: number; reason: string }[] = []

  for (let i = 0; i < records.length; i++) {
    const r = records[i]
    const identifier = r.sku?.trim() || r.id?.trim()
    if (!identifier) {
      skipped.push({ row: i + 2, reason: 'missing_sku_or_id' })
      continue
    }

    const fields: string[] = []
    const params: unknown[] = []
    function setField(column: string, raw: string | undefined, parse: (v: string) => unknown) {
      if (raw === undefined || raw.trim() === '') return
      params.push(parse(raw.trim()))
      fields.push(`${column} = $${params.length}`)
    }
    setField('price', r.price, Number)
    setField('old_price', r.oldPrice, v => v === '' ? null : Number(v))
    setField('cost', r.cost, Number)
    setField('stock', r.stock, v => Math.trunc(Number(v)))
    setField('alert_threshold', r.alertThreshold, v => Math.trunc(Number(v)))
    setField('available', r.available, v => (v === '1' || v.toLowerCase() === 'true') ? 1 : 0)
    setField('brand', r.brand, String)

    if (fields.length === 0) {
      skipped.push({ row: i + 2, reason: 'no_fields_to_update' })
      continue
    }
    if (params.some(p => typeof p === 'number' && !Number.isFinite(p))) {
      skipped.push({ row: i + 2, reason: 'invalid_number' })
      continue
    }

    params.push(identifier)
    const { rowCount } = await pool.query(
      `UPDATE products SET ${fields.join(', ')} WHERE sku = $${params.length} OR id = $${params.length}`,
      params
    )
    if (rowCount) updated++
    else skipped.push({ row: i + 2, reason: 'product_not_found' })
  }

  logEvent('admin_product_updated', { source: 'csv_import', updated, skippedCount: skipped.length })
  res.json({ updated, skipped })
})

// استيراد بمرحلتين بيسمح بإنشاء منتجات جديدة فعلاً (مش بس تحديث الموجود) — المرحلة الأولى
// هنا بس قراءة وتحقق (preview)، مفيش أي تعديل على قاعدة البيانات؛ التأكيد الفعلي في
// /import/confirm بعد ما المستخدم يشوف ويختار الصفوف الصالحة من المعاينة.
adminProductsRouter.post('/import/preview', requirePermission('inventory.import'), csvUpload.single('file'), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'missing_file' })
    return
  }
  const records = csvRecords(parseCsv(req.file.buffer.toString('utf-8')))
  if (records.length > 5000) {
    res.status(400).json({ error: 'file_too_large' })
    return
  }
  const rows = await validateImportRows(records)
  const summary = {
    total: rows.length,
    creatable: rows.filter(r => r.action === 'create').length,
    updatable: rows.filter(r => r.action === 'update').length,
    invalid: rows.filter(r => r.action === 'invalid').length
  }
  res.json({ rows, summary })
})

function parseConfirmRows(body: unknown): ImportConfirmRow[] | null {
  const b = body as Record<string, unknown>
  if (!Array.isArray(b?.rows)) return null
  const rows: ImportConfirmRow[] = []
  for (const raw of b.rows) {
    const r = raw as Record<string, unknown>
    if (typeof r?.rowNumber !== 'number') return null
    if (r.action !== 'create' && r.action !== 'update') return null
    if (r.action === 'update' && typeof r.productId !== 'string') return null
    rows.push({
      rowNumber: r.rowNumber,
      action: r.action,
      productId: typeof r.productId === 'string' ? r.productId : undefined,
      data: (r.data ?? {}) as ImportConfirmRow['data']
    })
  }
  return rows
}

adminProductsRouter.post('/import/confirm', requirePermission('inventory.import'), async (req, res) => {
  const rows = parseConfirmRows(req.body)
  if (!rows || rows.length === 0) {
    res.status(400).json({ error: 'missing_fields' })
    return
  }

  const summary = await importValidatedRows(rows, req.user!.id)
  logEvent('admin_product_updated', { source: 'csv_staged_import', created: summary.created, updated: summary.updated, failedCount: summary.failed.length })
  await recordAuditLog({
    adminUserId: req.user!.id,
    action: 'product_csv_import_confirmed',
    entityType: 'product',
    entityId: 'bulk',
    newValues: { created: summary.created, updated: summary.updated, failed: summary.failed.length }
  })
  res.json(summary)
})

adminProductsRouter.get('/:id', requirePermission('products.view'), async (req, res) => {
  const { rows } = await pool.query<ProductRow>(`${SELECT_PRODUCT} WHERE id = $1`, [req.params.id])
  const row = rows[0]
  if (!row) {
    res.status(404).json({ error: 'product_not_found' })
    return
  }
  res.json({ product: serializeProduct(row) })
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
  res.json({ product: serializeProduct(rows[0]) })
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

type ValidateBodyResult = { ok: true; data: ProductWriteInput } | { ok: false; error: string }

// بيرجّع خطأ محدد لكل حقل غلط بدل خطأ عام واحد (missing_fields) — عشان رسالة الخطأ في لوحة
// التحكم توضّح فعلياً الحقل المطلوب تصليحه. ملحوظة: الرابط (slug) مش من ضمن الحقول المتحقق
// منها هنا خالص — أبداً مش بيتاخد أو بيتوثق فيه من الفرونت إند (راجع productService.ts:
// توليد السيرفر للرابط وقت الإنشاء بس، وثبوته الكامل وقت التعديل).
async function validateBody(body: unknown): Promise<ValidateBodyResult> {
  const b = (body ?? {}) as Record<string, unknown>

  if (typeof b.categoryId !== 'string' || !b.categoryId.trim()) return { ok: false, error: 'invalid_category' }
  if (typeof b.name !== 'string' || !b.name.trim()) return { ok: false, error: 'invalid_name' }
  if (typeof b.description !== 'string') return { ok: false, error: 'invalid_description' }
  if (typeof b.price !== 'number' || !Number.isFinite(b.price) || b.price <= 0) return { ok: false, error: 'invalid_price' }
  if (typeof b.cost !== 'number' || !Number.isFinite(b.cost) || b.cost < 0) return { ok: false, error: 'invalid_cost' }
  if (typeof b.unit !== 'string' || !b.unit.trim()) return { ok: false, error: 'invalid_unit' }
  if (typeof b.emoji !== 'string') return { ok: false, error: 'invalid_emoji' }
  if (typeof b.available !== 'boolean') return { ok: false, error: 'invalid_available' }
  if (typeof b.stock !== 'number' || !Number.isFinite(b.stock) || b.stock < 0) return { ok: false, error: 'invalid_stock' }
  if (typeof b.alertThreshold !== 'number' || !Number.isFinite(b.alertThreshold) || b.alertThreshold < 0) return { ok: false, error: 'invalid_alert_threshold' }

  const { rows: categoryRows } = await pool.query('SELECT id FROM categories WHERE id = $1', [b.categoryId])
  if (!categoryRows[0]) return { ok: false, error: 'category_not_found' }

  return {
    ok: true,
    data: {
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
}

adminProductsRouter.post('/', requirePermission('products.create'), async (req, res) => {
  const result = await validateBody(req.body)
  if (!result.ok) {
    res.status(400).json({ error: result.error })
    return
  }

  const product = await createProduct(result.data)
  logEvent('admin_product_created', { productId: product.id })
  await recordAuditLog({
    adminUserId: req.user!.id,
    action: 'product_created',
    entityType: 'product',
    entityId: product.id,
    newValues: product
  })
  res.status(201).json({ product })
})

adminProductsRouter.patch('/:id', requirePermission('products.edit'), async (req, res) => {
  const { rows: existingRows } = await pool.query<ProductRow>(`${SELECT_PRODUCT} WHERE id = $1`, [req.params.id])
  const existing = existingRows[0]
  if (!existing) {
    res.status(404).json({ error: 'product_not_found' })
    return
  }

  // أي slug جاي من الفرونت إند بيتجاهل تماماً هنا — الرابط الحالي للمنتج ثابت دايماً على
  // التعديل (راجع productService.updateProduct)، حتى لو الاسم اتغيّر أو الفرونت إند بعت
  // حقل slug بالغلط.
  const result = await validateBody({ ...serializeProduct(existing), ...(req.body ?? {}) })
  if (!result.ok) {
    res.status(400).json({ error: result.error })
    return
  }

  const update = await updateProduct(String(req.params.id), result.data, req.user!.id)
  if (!update) {
    res.status(404).json({ error: 'product_not_found' })
    return
  }
  const { before, after, stockDiff } = update

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
