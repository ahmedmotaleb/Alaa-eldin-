import { pool } from '../db.js'
import { resolveProducts, type ProductCard } from './catalogService.js'

const DEFAULT_LIMIT = 10

// بيرجّع منتجات بسعرها وتوفرها الحالي بس (مش سعر وقت الطلب القديم) — مبني على تكرار
// الشراء الفعلي في طلبات سابقة غير ملغاة، بترتيب الأكثر تكراراً أولاً. منتج بقى غير متاح
// دلوقتي (اتشال أو نفد) ما بيتقترحش هنا خالص.
export async function listFrequentlyPurchased(userId: string, limit = DEFAULT_LIMIT): Promise<ProductCard[]> {
  const { rows } = await pool.query<{ productId: string }>(
    `SELECT oi.product_id as "productId"
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     WHERE o.user_id = $1 AND o.status != 'cancelled'
     GROUP BY oi.product_id
     ORDER BY COUNT(*) DESC, SUM(oi.quantity) DESC
     LIMIT $2`,
    [userId, limit * 2]
  )

  const orderedIds = rows.map(r => r.productId)
  const resolved = await resolveProducts(orderedIds)
  const byId = new Map(resolved.map(p => [p.id, p]))
  return orderedIds
    .map(id => byId.get(id))
    .filter((p): p is ProductCard => !!p && p.available)
    .slice(0, limit)
}
