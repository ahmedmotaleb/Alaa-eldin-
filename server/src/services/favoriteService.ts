import { pool } from '../db.js'
import { resolveProducts, type ProductCard } from './catalogService.js'

// المفضلة بترجّع بيانات كارت المنتج الحالية (سعر/توفر/صورة) — نفس بيانات أي مكان تاني،
// مش نسخة قديمة أو مخزّنة وقت الإضافة.
export async function listFavorites(userId: string): Promise<ProductCard[]> {
  const { rows } = await pool.query<{ productId: string, createdAt: string }>(
    'SELECT product_id as "productId", created_at as "createdAt" FROM customer_favorites WHERE user_id = $1 ORDER BY created_at DESC',
    [userId]
  )
  const resolved = await resolveProducts(rows.map(r => r.productId))
  const byId = new Map(resolved.map(p => [p.id, p]))
  return rows.map(r => byId.get(r.productId)).filter((p): p is ProductCard => !!p)
}

export async function isFavorite(userId: string, productId: string): Promise<boolean> {
  const { rows } = await pool.query('SELECT 1 FROM customer_favorites WHERE user_id = $1 AND product_id = $2', [userId, productId])
  return rows.length > 0
}

export async function addFavorite(userId: string, productId: string): Promise<void> {
  await pool.query(
    'INSERT INTO customer_favorites (user_id, product_id) VALUES ($1, $2) ON CONFLICT (user_id, product_id) DO NOTHING',
    [userId, productId]
  )
}

export async function removeFavorite(userId: string, productId: string): Promise<void> {
  await pool.query('DELETE FROM customer_favorites WHERE user_id = $1 AND product_id = $2', [userId, productId])
}
