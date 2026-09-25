import crypto from 'node:crypto'
import { pool, withTransaction } from '../db.js'

export type CycleCountStatus = 'draft' | 'completed' | 'cancelled'

export interface CycleCountSummary {
  id: string
  categoryId: string | null
  categoryName: string | null
  status: CycleCountStatus
  note: string
  createdAt: string
  completedAt: string | null
  itemCount: number
  countedCount: number
  varianceCount: number
}

export interface CycleCountItem {
  id: string
  productId: string
  variantId: string | null
  productName: string
  variantName: string | null
  sku: string | null
  barcode: string
  systemQuantity: number
  countedQuantity: number | null
  variance: number | null
}

export interface CycleCountDetail extends CycleCountSummary {
  items: CycleCountItem[]
}

// بيلقط مخزون النظام الحالي لحظة الإنشاء (كل المنتجات، أو منتجات قسم واحد لو اتحدد) كنقطة
// بداية للعد الفعلي. اللقطة دي للعرض/المقارنة بس — التسوية الفعلية عند الإكمال بتستخدم
// المخزون الحالي وقتها (راجع completeCycleCount).
//
// منتج عنده متغيّرات (product_variants): بياخد صف واحد *لكل متغيّر* بمخزون المتغيّر نفسه،
// مش صف واحد بمخزون الأب — نفس القاعدة المتّبعة بالفعل في bulkStockService (توليد قالب
// CSV) لأن مخزون الأب مش المرجع الحقيقي لمنتج له متغيّرات. منتج من غير متغيّرات بياخد صف
// واحد بمخزون الأب زي ما كان الحال دايماً.
export async function createCycleCount(input: { categoryId?: string | null; note?: string; userId: string }): Promise<{ id: string } | { error: 'category_not_found' }> {
  if (input.categoryId) {
    const { rows } = await pool.query('SELECT id FROM categories WHERE id = $1', [input.categoryId])
    if (!rows[0]) return { error: 'category_not_found' }
  }

  const id = crypto.randomUUID()
  await withTransaction(async client => {
    await client.query(
      'INSERT INTO cycle_counts (id, category_id, note, created_by_user_id, created_at) VALUES ($1, $2, $3, $4, now())',
      [id, input.categoryId ?? null, input.note?.trim() ?? '', input.userId]
    )
    const { rows: products } = await client.query<{ id: string; stock: number }>(
      input.categoryId ? 'SELECT id, stock FROM products WHERE category_id = $1' : 'SELECT id, stock FROM products',
      input.categoryId ? [input.categoryId] : []
    )
    const productIds = products.map(p => p.id)
    const { rows: variants } = productIds.length
      ? await client.query<{ id: string; productId: string; stock: number }>(
          'SELECT id, product_id as "productId", stock FROM product_variants WHERE product_id = ANY($1::text[])',
          [productIds]
        )
      : { rows: [] }
    const variantsByProduct = new Map<string, { id: string; stock: number }[]>()
    for (const v of variants) {
      if (!variantsByProduct.has(v.productId)) variantsByProduct.set(v.productId, [])
      variantsByProduct.get(v.productId)!.push(v)
    }

    for (const product of products) {
      const productVariants = variantsByProduct.get(product.id) ?? []
      if (productVariants.length === 0) {
        await client.query(
          'INSERT INTO cycle_count_items (id, cycle_count_id, product_id, variant_id, system_quantity) VALUES ($1, $2, $3, NULL, $4)',
          [crypto.randomUUID(), id, product.id, product.stock]
        )
      } else {
        for (const v of productVariants) {
          await client.query(
            'INSERT INTO cycle_count_items (id, cycle_count_id, product_id, variant_id, system_quantity) VALUES ($1, $2, $3, $4, $5)',
            [crypto.randomUUID(), id, product.id, v.id, v.stock]
          )
        }
      }
    }
  })
  return { id }
}

export async function listCycleCounts(): Promise<CycleCountSummary[]> {
  const { rows } = await pool.query<{
    id: string; categoryId: string | null; categoryName: string | null; status: CycleCountStatus
    note: string; createdAt: string; completedAt: string | null
    itemCount: string; countedCount: string; varianceCount: string
  }>(`
    SELECT cc.id, cc.category_id as "categoryId", cat.name as "categoryName", cc.status,
           cc.note, cc.created_at as "createdAt", cc.completed_at as "completedAt",
           COUNT(cci.id) as "itemCount",
           COUNT(cci.id) FILTER (WHERE cci.counted_quantity IS NOT NULL) as "countedCount",
           COUNT(cci.id) FILTER (WHERE cci.counted_quantity IS NOT NULL AND cci.counted_quantity != cci.system_quantity) as "varianceCount"
    FROM cycle_counts cc
    LEFT JOIN categories cat ON cat.id = cc.category_id
    LEFT JOIN cycle_count_items cci ON cci.cycle_count_id = cc.id
    GROUP BY cc.id, cat.name
    ORDER BY cc.created_at DESC
  `)
  return rows.map(r => ({
    ...r,
    itemCount: Number(r.itemCount),
    countedCount: Number(r.countedCount),
    varianceCount: Number(r.varianceCount)
  }))
}

export async function getCycleCount(id: string): Promise<CycleCountDetail | null> {
  const { rows: ccRows } = await pool.query<{
    id: string; categoryId: string | null; categoryName: string | null; status: CycleCountStatus
    note: string; createdAt: string; completedAt: string | null
  }>(`
    SELECT cc.id, cc.category_id as "categoryId", cat.name as "categoryName", cc.status,
           cc.note, cc.created_at as "createdAt", cc.completed_at as "completedAt"
    FROM cycle_counts cc LEFT JOIN categories cat ON cat.id = cc.category_id
    WHERE cc.id = $1
  `, [id])
  const cc = ccRows[0]
  if (!cc) return null

  const { rows: itemRows } = await pool.query<{
    id: string; productId: string; variantId: string | null; productName: string; variantName: string | null
    sku: string | null; barcode: string; systemQuantity: number; countedQuantity: number | null
  }>(`
    SELECT cci.id, cci.product_id as "productId", cci.variant_id as "variantId", p.name as "productName",
           v.name as "variantName",
           COALESCE(v.sku, p.sku) as sku, COALESCE(v.barcode, p.barcode) as barcode,
           cci.system_quantity as "systemQuantity", cci.counted_quantity as "countedQuantity"
    FROM cycle_count_items cci
    JOIN products p ON p.id = cci.product_id
    LEFT JOIN product_variants v ON v.id = cci.variant_id
    WHERE cci.cycle_count_id = $1
    ORDER BY p.name, v.sort_order NULLS FIRST
  `, [id])

  const items: CycleCountItem[] = itemRows.map(r => ({
    ...r,
    variance: r.countedQuantity === null ? null : r.countedQuantity - r.systemQuantity
  }))

  return {
    ...cc,
    items,
    itemCount: items.length,
    countedCount: items.filter(i => i.countedQuantity !== null).length,
    varianceCount: items.filter(i => i.variance !== null && i.variance !== 0).length
  }
}

async function assertDraft(id: string): Promise<{ error: 'not_found' | 'not_draft' } | null> {
  const { rows } = await pool.query<{ status: CycleCountStatus }>('SELECT status FROM cycle_counts WHERE id = $1', [id])
  if (!rows[0]) return { error: 'not_found' }
  if (rows[0].status !== 'draft') return { error: 'not_draft' }
  return null
}

// بيسجّل الكميات المعدودة فعلياً — productId مش موجود في الجرد ده بيتجاهل (مرجوع في
// skipped) بدل ما يفشل العملية كلها، لأن غالباً المصدر بيانات مُدخلة يدوياً أو CSV مرفوع.
// variantId لازم يتبعت صراحة (أو يتسيب فاضي/null) لما المنتج له أكتر من صف (متغيّرات) —
// من غيره الـ WHERE هيتطابق مع IS NOT DISTINCT FROM NULL بس، يعني هيفشل يلاقي صف المتغيّر.
export async function recordCounts(
  cycleCountId: string,
  counts: { productId: string; variantId?: string | null; countedQuantity: number }[]
): Promise<{ updated: number; skipped: string[] } | { error: 'not_found' | 'not_draft' }> {
  const draftCheck = await assertDraft(cycleCountId)
  if (draftCheck) return draftCheck

  let updated = 0
  const skipped: string[] = []
  await withTransaction(async client => {
    for (const count of counts) {
      const key = count.variantId ?? count.productId
      if (!Number.isFinite(count.countedQuantity) || count.countedQuantity < 0) {
        skipped.push(key)
        continue
      }
      const { rowCount } = await client.query(
        'UPDATE cycle_count_items SET counted_quantity = $1 WHERE cycle_count_id = $2 AND product_id = $3 AND variant_id IS NOT DISTINCT FROM $4',
        [Math.trunc(count.countedQuantity), cycleCountId, count.productId, count.variantId ?? null]
      )
      if (rowCount) updated++
      else skipped.push(key)
    }
  })
  return { updated, skipped }
}

// التسوية الفعلية — بتتم فقط لعناصر اتعدت فعلاً (counted_quantity != null). بتقفل صف
// المنتج (FOR UPDATE) وتقارن بمخزونه *الحالي* وقت الإكمال (مش اللقطة القديمة وقت الإنشاء)،
// عشان أي بيع/تجديد حصل في الفترة بين إنشاء الجرد وإكماله يتفضل محسوب صح، والفرق المسجّل
// في حركة المخزون يعكس التغيير الحقيقي المطلوب مش فرق زمن قديم.
export async function completeCycleCount(
  cycleCountId: string,
  userId: string
): Promise<{ adjustedCount: number } | { error: 'not_found' | 'not_draft' }> {
  const draftCheck = await assertDraft(cycleCountId)
  if (draftCheck) return draftCheck

  const adjustedCount = await withTransaction(async client => {
    const { rows: items } = await client.query<{ productId: string; variantId: string | null; countedQuantity: number }>(
      'SELECT product_id as "productId", variant_id as "variantId", counted_quantity as "countedQuantity" FROM cycle_count_items WHERE cycle_count_id = $1 AND counted_quantity IS NOT NULL',
      [cycleCountId]
    )

    let adjusted = 0
    for (const item of items) {
      let currentStock: number | undefined
      if (item.variantId) {
        const { rows } = await client.query<{ stock: number }>(
          'SELECT stock FROM product_variants WHERE id = $1 FOR UPDATE',
          [item.variantId]
        )
        currentStock = rows[0]?.stock
        if (currentStock === undefined) continue
        if (item.countedQuantity === currentStock) continue
        await client.query('UPDATE product_variants SET stock = $1 WHERE id = $2', [item.countedQuantity, item.variantId])
      } else {
        const { rows } = await client.query<{ stock: number }>(
          'SELECT stock FROM products WHERE id = $1 FOR UPDATE',
          [item.productId]
        )
        currentStock = rows[0]?.stock
        if (currentStock === undefined) continue
        if (item.countedQuantity === currentStock) continue
        await client.query('UPDATE products SET stock = $1 WHERE id = $2', [item.countedQuantity, item.productId])
      }

      const delta = item.countedQuantity - currentStock
      await client.query(
        `INSERT INTO stock_movements (product_id, variant_id, type, quantity_change, note, created_at, quantity_before, quantity_after, created_by_user_id)
         VALUES ($1, $2, 'adjustment', $3, $4, now(), $5, $6, $7)`,
        [item.productId, item.variantId, delta, `جرد دوري #${cycleCountId}`, currentStock, item.countedQuantity, userId]
      )
      adjusted++
    }

    await client.query("UPDATE cycle_counts SET status = 'completed', completed_at = now() WHERE id = $1", [cycleCountId])
    return adjusted
  })

  return { adjustedCount }
}

export async function cancelCycleCount(cycleCountId: string): Promise<{ ok: true } | { error: 'not_found' | 'not_draft' }> {
  const draftCheck = await assertDraft(cycleCountId)
  if (draftCheck) return draftCheck
  await pool.query("UPDATE cycle_counts SET status = 'cancelled' WHERE id = $1", [cycleCountId])
  return { ok: true }
}
