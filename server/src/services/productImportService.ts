import crypto from 'node:crypto'
import { pool, withTransaction } from '../db.js'

// أرقام هندية/فارسية شرقية (٠-٩) مرفوضة صراحة في أي حقل رقمي في ملف الاستيراد — لو انقبلت
// بصمت وتحوّلت لأرقام غربية، احتمال يبقى في غموض حول الرقم الحقيقي اللي المستخدم قصده (خصوصاً
// لو الملف جاي من مصدر خارجي بلغة عربية). أفضل نرفض الصف بوضوح ونطلب تصحيحه يدوياً.
const EASTERN_DIGITS = /[٠-٩]/

function parseStrictMoney(raw: string): number | null {
  if (EASTERN_DIGITS.test(raw)) return null
  if (!/^-?\d+(\.\d+)?$/.test(raw.trim())) return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

function parseStrictNonNegativeInt(raw: string): number | null {
  if (EASTERN_DIGITS.test(raw)) return null
  if (!/^\d+$/.test(raw.trim())) return null
  const n = Number(raw)
  return Number.isInteger(n) && n >= 0 ? n : null
}

function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw.trim() === '') return fallback
  const v = raw.trim().toLowerCase()
  return v === '1' || v === 'true'
}

export type ImportRowAction = 'create' | 'update' | 'invalid'

export interface ImportRowData {
  sku?: string
  barcode?: string
  slug?: string
  categoryId?: string
  name?: string
  description?: string
  price?: number
  oldPrice?: number | null
  cost?: number
  unit?: string
  emoji?: string
  stock?: number
  alertThreshold?: number
  available?: boolean
  brand?: string
}

export interface ImportRowResult {
  rowNumber: number
  action: ImportRowAction
  productId?: string
  data: ImportRowData
  errors: string[]
  warnings: string[]
}

// المرحلة الأولى (Parse+Validate+Preview) — بس قراءة، مفيش أي تعديل على قاعدة البيانات هنا.
// كل صف بيتقيّم لوحده تماماً ومستقل عن باقي الصفوف (غير التكرار داخل نفس الملف نفسه، اللي
// لازم يتفحص كمان عشان صفين جداد بنفس الـ slug/sku ما يتقبلوش الاتنين).
export async function validateImportRows(records: Record<string, string | undefined>[]): Promise<ImportRowResult[]> {
  const { rows: categories } = await pool.query<{ id: string }>('SELECT id FROM categories')
  const categoryIds = new Set(categories.map(c => c.id))

  const { rows: existingProducts } = await pool.query<{ id: string; sku: string | null; slug: string; barcode: string }>(
    'SELECT id, sku, slug, barcode FROM products'
  )
  const bySku = new Map(existingProducts.filter(p => p.sku).map(p => [p.sku as string, p]))
  const byId = new Map(existingProducts.map(p => [p.id, p]))
  const existingSlugs = new Set(existingProducts.map(p => p.slug))
  const existingBarcodes = new Set(existingProducts.filter(p => p.barcode).map(p => p.barcode))

  const seenSkusInBatch = new Set<string>()
  const seenSlugsInBatch = new Set<string>()
  const seenBarcodesInBatch = new Set<string>()

  const results: ImportRowResult[] = []

  for (let i = 0; i < records.length; i++) {
    const r = records[i]
    const rowNumber = i + 2
    const errors: string[] = []
    const warnings: string[] = []

    const id = r.id?.trim()
    const sku = r.sku?.trim()
    const matched = (id && byId.get(id)) || (sku && bySku.get(sku))

    if (matched) {
      // تحديث — نفس الحقول التشغيلية الآمنة بالظبط اللي مسار الاستيراد "تحديث فقط" الحالي
      // بيسمح بيها (سعر/تكلفة/مخزون/توفر)، من غير تعديل الاسم/القسم/الرابط للمنتج الموجود.
      const data: ImportRowData = {}
      const setNum = (field: 'price' | 'cost' | 'stock' | 'alertThreshold', raw: string | undefined, parse: (v: string) => number | null, label: string) => {
        if (raw === undefined || raw.trim() === '') return
        const v = parse(raw.trim())
        if (v === null) errors.push(`${label}: قيمة غير صحيحة (تأكد من عدم استخدام أرقام هندية أو نص غير رقمي)`)
        else (data as Record<string, number>)[field] = v
      }
      setNum('price', r.price, v => { const n = parseStrictMoney(v); return n !== null && n > 0 ? n : null }, 'السعر')
      setNum('cost', r.cost, v => { const n = parseStrictMoney(v); return n !== null && n >= 0 ? n : null }, 'التكلفة')
      setNum('stock', r.stock, parseStrictNonNegativeInt, 'المخزون')
      setNum('alertThreshold', r.alertThreshold, parseStrictNonNegativeInt, 'حد التنبيه')
      if (r.oldPrice !== undefined && r.oldPrice.trim() !== '') {
        const op = parseStrictMoney(r.oldPrice.trim())
        if (op === null) errors.push('السعر قبل الخصم: قيمة غير صحيحة')
        else data.oldPrice = op > 0 ? op : null
      }
      if (r.available !== undefined && r.available.trim() !== '') data.available = parseBoolean(r.available, true)
      if (r.brand !== undefined && r.brand.trim() !== '') data.brand = r.brand.trim()

      if (errors.length === 0 && Object.keys(data).length === 0) {
        errors.push('لا يوجد أي حقل صالح للتحديث في هذا الصف')
      }
      results.push({ rowNumber, action: errors.length ? 'invalid' : 'update', productId: matched.id, data, errors, warnings })
      continue
    }

    if (!id && !sku && !r.name?.trim() && !r.categoryId?.trim() && !r.price?.trim()) {
      errors.push('صف فارغ أو ناقص البيانات الأساسية')
      results.push({ rowNumber, action: 'invalid', data: {}, errors, warnings })
      continue
    }

    // إنشاء منتج جديد — لازم البيانات الأساسية كاملة وصحيحة، مفيش إنشاء جزئي صامت.
    const data: ImportRowData = {}

    const name = r.name?.trim()
    if (!name) errors.push('اسم المنتج مطلوب لإنشاء منتج جديد')
    else data.name = name

    const categoryId = r.categoryId?.trim()
    if (!categoryId) errors.push('القسم (categoryId) مطلوب لإنشاء منتج جديد')
    else if (!categoryIds.has(categoryId)) errors.push('القسم المُحدد غير موجود')
    else data.categoryId = categoryId

    const slug = r.slug?.trim()
    if (!slug) errors.push('الرابط (slug) مطلوب لإنشاء منتج جديد')
    else if (existingSlugs.has(slug) || seenSlugsInBatch.has(slug)) errors.push('الرابط (slug) مستخدم بالفعل')
    else { data.slug = slug; seenSlugsInBatch.add(slug) }

    const unit = r.unit?.trim()
    if (!unit) errors.push('الوحدة مطلوبة لإنشاء منتج جديد')
    else data.unit = unit

    if (r.price === undefined || r.price.trim() === '') {
      errors.push('السعر مطلوب لإنشاء منتج جديد')
    } else {
      const price = parseStrictMoney(r.price.trim())
      if (price === null || price <= 0) errors.push('السعر: قيمة غير صحيحة (لازم يكون رقم أكبر من صفر)')
      else data.price = price
    }

    if (r.oldPrice !== undefined && r.oldPrice.trim() !== '') {
      const op = parseStrictMoney(r.oldPrice.trim())
      if (op === null) errors.push('السعر قبل الخصم: قيمة غير صحيحة')
      else data.oldPrice = op > 0 ? op : null
    }

    if (r.cost !== undefined && r.cost.trim() !== '') {
      const cost = parseStrictMoney(r.cost.trim())
      if (cost === null || cost < 0) errors.push('التكلفة: قيمة غير صحيحة')
      else data.cost = cost
    } else {
      data.cost = 0
    }

    if (r.stock !== undefined && r.stock.trim() !== '') {
      const stock = parseStrictNonNegativeInt(r.stock.trim())
      if (stock === null) errors.push('المخزون لازم يكون عدد صحيح غير سالب (أرقام غربية 0-9 فقط)')
      else data.stock = stock
    } else {
      data.stock = 0
    }

    if (r.alertThreshold !== undefined && r.alertThreshold.trim() !== '') {
      const alertThreshold = parseStrictNonNegativeInt(r.alertThreshold.trim())
      if (alertThreshold === null) errors.push('حد التنبيه لازم يكون عدد صحيح غير سالب')
      else data.alertThreshold = alertThreshold
    } else {
      data.alertThreshold = 0
    }

    data.available = parseBoolean(r.available, true)
    data.brand = r.brand?.trim() ?? ''
    data.description = r.description?.trim() ?? ''
    data.emoji = r.emoji?.trim() ?? ''

    if (sku) {
      if (seenSkusInBatch.has(sku) || bySku.has(sku)) errors.push('SKU مستخدم بالفعل')
      else { data.sku = sku; seenSkusInBatch.add(sku) }
    }
    const barcode = r.barcode?.trim()
    if (barcode) {
      if (seenBarcodesInBatch.has(barcode) || existingBarcodes.has(barcode)) errors.push('الباركود مستخدم بالفعل')
      else { data.barcode = barcode; seenBarcodesInBatch.add(barcode) }
    }

    results.push({ rowNumber, action: errors.length ? 'invalid' : 'create', data, errors, warnings })
  }

  return results
}

export interface ImportConfirmRow {
  rowNumber: number
  action: 'create' | 'update'
  productId?: string
  data: ImportRowData
}

export interface ImportSummary {
  created: number
  updated: number
  skipped: number
  failed: { rowNumber: number; reason: string }[]
}

const CHUNK_SIZE = 200

// المرحلة الأخيرة (Confirm+Import) — بتاخد بس الصفوف اللي المستخدم اختارها من الـ preview
// (المفروض تكون كلها صالحة أصلاً)، لكن بتعيد فحص القيود الحرجة (slug/sku الفريد) من جوه نفس
// الـ transaction عشان تغطي أي تغيير حصل في قاعدة البيانات بين لحظة الـ preview ولحظة التأكيد
// الفعلي (سباق نادر لكن ممكن). كل جزء من الصفوف بيتنفذ في transaction محدودة الحجم لوحده،
// عشان ملف ضخم جداً ما يمسكش قفل واحد طويل على الجدول كله.
export async function importValidatedRows(rows: ImportConfirmRow[], _createdByUserId: string): Promise<ImportSummary> {
  let created = 0
  let updated = 0
  const failed: { rowNumber: number; reason: string }[] = []

  for (let start = 0; start < rows.length; start += CHUNK_SIZE) {
    const chunk = rows.slice(start, start + CHUNK_SIZE)
    await withTransaction(async client => {
      for (const row of chunk) {
        try {
          if (row.action === 'create') {
            const d = row.data
            if (!d.name || !d.categoryId || !d.slug || !d.unit || d.price === undefined) {
              failed.push({ rowNumber: row.rowNumber, reason: 'missing_fields' })
              continue
            }
            const { rows: slugRows } = await client.query('SELECT id FROM products WHERE slug = $1', [d.slug])
            if (slugRows[0]) { failed.push({ rowNumber: row.rowNumber, reason: 'slug_taken' }); continue }
            if (d.sku) {
              const { rows: skuRows } = await client.query('SELECT id FROM products WHERE sku = $1', [d.sku])
              if (skuRows[0]) { failed.push({ rowNumber: row.rowNumber, reason: 'sku_taken' }); continue }
            }
            const { rows: categoryRows } = await client.query('SELECT id FROM categories WHERE id = $1', [d.categoryId])
            if (!categoryRows[0]) { failed.push({ rowNumber: row.rowNumber, reason: 'category_not_found' }); continue }

            const id = 'p' + crypto.randomBytes(4).toString('hex')
            await client.query(
              `INSERT INTO products (id, slug, category_id, name, description, price, old_price, cost, unit, emoji, available, stock, alert_threshold, barcode, brand, sku, created_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
              [
                id, d.slug, d.categoryId, d.name, d.description ?? '', d.price, d.oldPrice ?? null, d.cost ?? 0, d.unit, d.emoji ?? '',
                d.available === false ? 0 : 1, d.stock ?? 0, d.alertThreshold ?? 0, d.barcode ?? '', d.brand ?? '', d.sku ?? null,
                new Date().toISOString()
              ]
            )
            created++
          } else {
            if (!row.productId) { failed.push({ rowNumber: row.rowNumber, reason: 'missing_product_id' }); continue }
            const d = row.data
            const fields: string[] = []
            const params: unknown[] = []
            const set = (column: string, value: unknown) => { params.push(value); fields.push(`${column} = $${params.length}`) }
            if (d.price !== undefined) set('price', d.price)
            if (d.oldPrice !== undefined) set('old_price', d.oldPrice)
            if (d.cost !== undefined) set('cost', d.cost)
            if (d.stock !== undefined) set('stock', d.stock)
            if (d.alertThreshold !== undefined) set('alert_threshold', d.alertThreshold)
            if (d.available !== undefined) set('available', d.available ? 1 : 0)
            if (d.brand !== undefined) set('brand', d.brand)

            if (fields.length === 0) { failed.push({ rowNumber: row.rowNumber, reason: 'no_fields_to_update' }); continue }
            params.push(row.productId)
            const { rowCount } = await client.query(`UPDATE products SET ${fields.join(', ')} WHERE id = $${params.length}`, params)
            if (rowCount) updated++
            else failed.push({ rowNumber: row.rowNumber, reason: 'product_not_found' })
          }
        } catch (err) {
          failed.push({ rowNumber: row.rowNumber, reason: err instanceof Error ? err.message : 'unknown_error' })
        }
      }
    })
  }

  return { created, updated, skipped: 0, failed }
}
