import { pool } from '../db.js'

// أفعال "آمنة" بالتعريف — بتعدّل حقول قابلة للتصحيح فوراً (الظهور/القسم/العلامة التجارية)
// ولا تحذف أو تُفقد أي بيانات، على عكس عملية حذف مثلاً. السيرفر بالفعل مفيهوش أي DELETE
// للمنتج الأساسي (منتجات مرتبطة بطلبات/سلة/مفضلة تاريخياً)، فمتعمّدين عدم إضافة حذف جماعي هنا.
export type BulkProductActionType = 'set_available' | 'set_unavailable' | 'set_category' | 'set_brand'

export interface BulkProductActionResult {
  updated: number
  failed: { productId: string, reason: string }[]
}

// سقف دفاعي بسيط لعدد المنتجات في طلب واحد — التحديد في الواجهة مقصور على الصفحة الحالية
// من الجدول (20 صف)، فده مش متوقع يتلامس عملياً، بس بيمنع أي طلب ضخم غير متوقع.
const MAX_IDS = 200

export async function applyBulkProductAction(
  productIds: string[],
  action: BulkProductActionType,
  payload: { categoryId?: string, brand?: string }
): Promise<BulkProductActionResult> {
  const ids = Array.from(new Set(productIds.map(id => id.trim()).filter(Boolean))).slice(0, MAX_IDS)
  if (ids.length === 0) return { updated: 0, failed: [] }

  if (action === 'set_category') {
    const categoryId = payload.categoryId?.trim()
    if (!categoryId) return { updated: 0, failed: ids.map(id => ({ productId: id, reason: 'missing_category' })) }
    const { rows: catRows } = await pool.query('SELECT id FROM categories WHERE id = $1', [categoryId])
    if (!catRows[0]) return { updated: 0, failed: ids.map(id => ({ productId: id, reason: 'category_not_found' })) }
    return applyUpdate('UPDATE products SET category_id = $1 WHERE id = ANY($2::text[]) RETURNING id', [categoryId, ids], ids)
  }

  if (action === 'set_brand') {
    const brand = payload.brand?.trim() ?? ''
    return applyUpdate('UPDATE products SET brand = $1 WHERE id = ANY($2::text[]) RETURNING id', [brand, ids], ids)
  }

  const available = action === 'set_available' ? 1 : 0
  return applyUpdate('UPDATE products SET available = $1 WHERE id = ANY($2::text[]) RETURNING id', [available, ids], ids)
}

async function applyUpdate(sql: string, params: unknown[], requestedIds: string[]): Promise<BulkProductActionResult> {
  const { rows } = await pool.query<{ id: string }>(sql, params)
  const updatedIds = new Set(rows.map(r => r.id))
  const failed = requestedIds.filter(id => !updatedIds.has(id)).map(id => ({ productId: id, reason: 'product_not_found' }))
  return { updated: rows.length, failed }
}
