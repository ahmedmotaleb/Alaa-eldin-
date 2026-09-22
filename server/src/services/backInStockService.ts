import type { PoolClient } from 'pg'
import { pool } from '../db.js'
import { sendPushToUser } from './pushService.js'

// اشتراك صريح لكل منتج (أو لمتغيّر محدد منه) — تصرف واضح من العميل نفسه (زرار "أعلمني عند
// التوفر")، يعتبر موافقة كافية لإرسال تنبيه واحد لهذا المنتج/المتغيّر بالذات لاحقاً. ده مختلف
// عن تفضيلات الإشعارات العامة (order_updates/promotions) اللي بتحكم إشعارات عامة مش مرتبطة
// بفعل صريح مماثل — فمفيش داعي يتحقق من أي تفضيل عام تاني هنا، نفس مبدأ إن طلب إذن الإشعارات
// نفسه أصلاً لازم يبقى مرتبط بفعل صريح من المستخدم، مش تلقائي.
//
// variantId اختياري (null = اشتراك على المنتج الأساسي نفسه، مش أي متغيّر منه) — الفهرس
// الفريد idx_back_in_stock_subscriptions_unique معتمد على COALESCE(variant_id, '') بالظبط
// (راجع migration 0059)، فـ ON CONFLICT هنا لازم يطابقه حرفياً عشان Postgres يقدر يحدد
// الفهرس المستهدف.
export async function subscribeToBackInStock(userId: string, productId: string, variantId: string | null = null): Promise<void> {
  await pool.query(
    `INSERT INTO back_in_stock_subscriptions (user_id, product_id, variant_id) VALUES ($1, $2, $3)
     ON CONFLICT (user_id, product_id, COALESCE(variant_id, '')) DO NOTHING`,
    [userId, productId, variantId]
  )
}

export async function unsubscribeFromBackInStock(userId: string, productId: string, variantId: string | null = null): Promise<void> {
  await pool.query(
    'DELETE FROM back_in_stock_subscriptions WHERE user_id = $1 AND product_id = $2 AND variant_id IS NOT DISTINCT FROM $3',
    [userId, productId, variantId]
  )
}

export async function isSubscribedToBackInStock(userId: string, productId: string, variantId: string | null = null): Promise<boolean> {
  const { rows } = await pool.query(
    'SELECT 1 FROM back_in_stock_subscriptions WHERE user_id = $1 AND product_id = $2 AND variant_id IS NOT DISTINCT FROM $3',
    [userId, productId, variantId]
  )
  return !!rows[0]
}

// بتتنفّذ جوه نفس معاملة أي عملية بتزوّد رصيد منتج أو متغيّر (استرجاع إلغاء، استبدال، استلام
// بضاعة، مرتجع عميل/مورد، شطب) — من غير أي شرط "هل كان صفر قبل كده؟"، لأن الاشتراك نفسه
// بيتمسح فور الإرسال؛ يعني استدعاء الدالة دي أكتر من مرة والمنتج لسه متاح مش بيبعت أي تنبيه
// إضافي (الاستعلام بيرجع صفوف فاضية بعد أول مرة). التنفيذ بسيط جداً وآمن للتكرار من غير أي
// تتبّع إضافي لقيمة الرصيد "قبل" العملية.
//
// variantId اختياري: لو موجود، الفحص والتنبيه واستهلاك الاشتراك كله سكوب على المتغيّر ده
// بالذات (اشتراكات المتغيرات التانية أو اشتراك المنتج الأساسي نفسه ما بتتأثرش خالص). لو غير
// موجود (null، الحالة الافتراضية)، السكوب على اشتراكات المنتج الأساسي فقط (variant_id IS NULL)
// — رجوع مخزون متغيّر واحد ما بيبعتش تنبيه لمشترك في متغيّر تاني أو في المنتج الأساسي نفسه.
export async function notifyBackInStockIfNeeded(client: PoolClient, productId: string, variantId: string | null = null): Promise<void> {
  let stock: number
  let available: boolean
  let displayName: string

  if (variantId) {
    const { rows } = await client.query<{ stock: number, available: number, productName: string, variantName: string }>(
      `SELECT v.stock, v.available, p.name as "productName", v.name as "variantName"
       FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.id = $1`,
      [variantId]
    )
    const row = rows[0]
    if (!row) return
    stock = row.stock
    available = !!row.available
    displayName = `${row.productName} - ${row.variantName}`
  } else {
    const { rows } = await client.query<{ stock: number, available: number, name: string }>(
      'SELECT stock, available, name FROM products WHERE id = $1',
      [productId]
    )
    const row = rows[0]
    if (!row) return
    stock = row.stock
    available = !!row.available
    displayName = row.name
  }
  if (stock <= 0 || !available) return

  const { rows: subscribers } = await client.query<{ userId: string }>(
    'SELECT user_id as "userId" FROM back_in_stock_subscriptions WHERE product_id = $1 AND variant_id IS NOT DISTINCT FROM $2',
    [productId, variantId]
  )
  if (subscribers.length === 0) return

  await client.query(
    'DELETE FROM back_in_stock_subscriptions WHERE product_id = $1 AND variant_id IS NOT DISTINCT FROM $2',
    [productId, variantId]
  )

  await Promise.all(subscribers.map(s =>
    sendPushToUser(s.userId, { title: 'رجع تاني!', body: `${displayName} بقى متوفر تاني — اطلبه قبل ما ينفد`, url: '/' })
  ))
}
