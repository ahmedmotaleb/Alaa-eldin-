import type { PoolClient } from 'pg'
import { pool } from '../db.js'
import { sendPushToUser } from './pushService.js'

// اشتراك صريح لكل منتج — تصرف واضح من العميل نفسه (زرار "أعلمني عند التوفر")، يعتبر موافقة
// كافية لإرسال تنبيه واحد لهذا المنتج بالذات لاحقاً. ده مختلف عن تفضيلات الإشعارات العامة
// (order_updates/promotions) اللي بتحكم إشعارات عامة مش مرتبطة بفعل صريح مماثل — فمفيش داعي
// يتحقق من أي تفضيل عام تاني هنا، نفس مبدأ إن طلب إذن الإشعارات نفسه أصلاً لازم يبقى مرتبط
// بفعل صريح من المستخدم، مش تلقائي.
export async function subscribeToBackInStock(userId: string, productId: string): Promise<void> {
  await pool.query(
    `INSERT INTO back_in_stock_subscriptions (user_id, product_id) VALUES ($1, $2)
     ON CONFLICT (user_id, product_id) DO NOTHING`,
    [userId, productId]
  )
}

export async function unsubscribeFromBackInStock(userId: string, productId: string): Promise<void> {
  await pool.query('DELETE FROM back_in_stock_subscriptions WHERE user_id = $1 AND product_id = $2', [userId, productId])
}

export async function isSubscribedToBackInStock(userId: string, productId: string): Promise<boolean> {
  const { rows } = await pool.query('SELECT 1 FROM back_in_stock_subscriptions WHERE user_id = $1 AND product_id = $2', [userId, productId])
  return !!rows[0]
}

// بتتنفّذ جوه نفس معاملة أي عملية بتزوّد رصيد منتج (استرجاع إلغاء، استبدال، استلام بضاعة،
// مرتجع عميل/مورد) — من غير أي شرط "هل كان صفر قبل كده؟"، لأن الاشتراك نفسه بيتمسح فور
// الإرسال؛ يعني استدعاء الدالة دي أكتر من مرة والمنتج لسه متاح مش بيبعت أي تنبيه إضافي
// (الاستعلام بيرجع صفوف فاضية بعد أول مرة). التنفيذ بسيط جداً وآمن للتكرار من غير أي تتبّع
// إضافي لقيمة الرصيد "قبل" العملية.
export async function notifyBackInStockIfNeeded(client: PoolClient, productId: string): Promise<void> {
  const { rows: productRows } = await client.query<{ stock: number, available: number, name: string }>(
    'SELECT stock, available, name FROM products WHERE id = $1',
    [productId]
  )
  const product = productRows[0]
  if (!product || product.stock <= 0 || !product.available) return

  const { rows: subscribers } = await client.query<{ userId: string }>(
    'SELECT user_id as "userId" FROM back_in_stock_subscriptions WHERE product_id = $1',
    [productId]
  )
  if (subscribers.length === 0) return

  await client.query('DELETE FROM back_in_stock_subscriptions WHERE product_id = $1', [productId])

  await Promise.all(subscribers.map(s =>
    sendPushToUser(s.userId, { title: 'رجع تاني!', body: `${product.name} بقى متوفر تاني — اطلبه قبل ما ينفد`, url: '/' })
  ))
}
