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
  productName: string
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
    for (const product of products) {
      await client.query(
        'INSERT INTO cycle_count_items (id, cycle_count_id, product_id, system_quantity) VALUES ($1, $2, $3, $4)',
        [crypto.randomUUID(), id, product.id, product.stock]
      )
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
    id: string; productId: string; productName: string; sku: string | null; barcode: string
    systemQuantity: number; countedQuantity: number | null
  }>(`
    SELECT cci.id, cci.product_id as "productId", p.name as "productName", p.sku, p.barcode,
           cci.system_quantity as "systemQuantity", cci.counted_quantity as "countedQuantity"
    FROM cycle_count_items cci JOIN products p ON p.id = cci.product_id
    WHERE cci.cycle_count_id = $1
    ORDER BY p.name
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
export async function recordCounts(
  cycleCountId: string,
  counts: { productId: string; countedQuantity: number }[]
): Promise<{ updated: number; skipped: string[] } | { error: 'not_found' | 'not_draft' }> {
  const draftCheck = await assertDraft(cycleCountId)
  if (draftCheck) return draftCheck

  let updated = 0
  const skipped: string[] = []
  await withTransaction(async client => {
    for (const count of counts) {
      if (!Number.isFinite(count.countedQuantity) || count.countedQuantity < 0) {
        skipped.push(count.productId)
        continue
      }
      const { rowCount } = await client.query(
        'UPDATE cycle_count_items SET counted_quantity = $1 WHERE cycle_count_id = $2 AND product_id = $3',
        [Math.trunc(count.countedQuantity), cycleCountId, count.productId]
      )
      if (rowCount) updated++
      else skipped.push(count.productId)
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
    const { rows: items } = await client.query<{ productId: string; countedQuantity: number }>(
      'SELECT product_id as "productId", counted_quantity as "countedQuantity" FROM cycle_count_items WHERE cycle_count_id = $1 AND counted_quantity IS NOT NULL',
      [cycleCountId]
    )

    let adjusted = 0
    for (const item of items) {
      const { rows: productRows } = await client.query<{ stock: number }>(
        'SELECT stock FROM products WHERE id = $1 FOR UPDATE',
        [item.productId]
      )
      const currentStock = productRows[0]?.stock
      if (currentStock === undefined) continue
      const delta = item.countedQuantity - currentStock
      if (delta === 0) continue

      await client.query('UPDATE products SET stock = $1 WHERE id = $2', [item.countedQuantity, item.productId])
      await client.query(
        `INSERT INTO stock_movements (product_id, type, quantity_change, note, created_at, quantity_before, quantity_after, created_by_user_id)
         VALUES ($1, 'adjustment', $2, $3, now(), $4, $5, $6)`,
        [item.productId, delta, `جرد دوري #${cycleCountId}`, currentStock, item.countedQuantity, userId]
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
