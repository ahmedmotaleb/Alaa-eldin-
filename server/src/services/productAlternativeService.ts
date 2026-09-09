import { pool } from '../db.js'

export interface AlternativeProductRow {
  id: string
  slug: string
  name: string
  price: number
  oldPrice: number | null
  unit: string
  emoji: string
  available: boolean
  primaryImage: string | null
  priority: number
}

interface RawRow {
  id: string
  slug: string
  name: string
  price: number
  oldPrice: number | null
  unit: string
  emoji: string
  available: number
  primaryImage: string | null
  priority: number
}

// بيانات خفيفة بس (زي كارت المنتج) — مش الوصف الكامل — عشان صفحة تفاصيل المنتج ما
// تحمّلش بيانات زيادة عن اللازم لصف اقتراحات صغير.
const SELECT_ALTERNATIVES = `
  SELECT p.id, p.slug, p.name, p.price, p.old_price as "oldPrice", p.unit, p.emoji, p.available,
         img.image_url as "primaryImage", pa.priority
  FROM product_alternatives pa
  JOIN products p ON p.id = pa.alternative_product_id
  LEFT JOIN LATERAL (
    SELECT image_url FROM product_images pi
    WHERE pi.product_id = p.id
    ORDER BY pi.is_primary DESC, pi.sort_order ASC
    LIMIT 1
  ) img ON true
  WHERE pa.product_id = $1
`

function serialize(row: RawRow): AlternativeProductRow {
  return { ...row, available: !!row.available }
}

// بيرجّع بدائل متاحة (available) بس للعرض العام للعميل — منتج بديل مخفي/غير متاح
// مش مفيد كاقتراح شراء.
export async function listPublicAlternatives(productId: string): Promise<AlternativeProductRow[]> {
  const { rows } = await pool.query<RawRow>(
    `${SELECT_ALTERNATIVES} AND p.available = 1 AND p.stock > 0 ORDER BY pa.priority ASC, p.name ASC`,
    [productId]
  )
  return rows.map(serialize)
}

// نسخة الإدارة: بترجّع كل البدائل المرتبطة حتى لو المنتج البديل نفسه مخفي حالياً،
// عشان الأدمن يقدر يشوف/يشيل الربط حتى لو المنتج مش معروض مؤقتاً.
export async function listAdminAlternatives(productId: string): Promise<AlternativeProductRow[]> {
  const { rows } = await pool.query<RawRow>(
    `${SELECT_ALTERNATIVES} ORDER BY pa.priority ASC, p.name ASC`,
    [productId]
  )
  return rows.map(serialize)
}

export async function addAlternative(productId: string, alternativeProductId: string, priority: number): Promise<void> {
  await pool.query(
    `INSERT INTO product_alternatives (product_id, alternative_product_id, priority)
     VALUES ($1, $2, $3)
     ON CONFLICT (product_id, alternative_product_id) DO UPDATE SET priority = $3`,
    [productId, alternativeProductId, priority]
  )
}

export async function removeAlternative(productId: string, alternativeProductId: string): Promise<void> {
  await pool.query(
    'DELETE FROM product_alternatives WHERE product_id = $1 AND alternative_product_id = $2',
    [productId, alternativeProductId]
  )
}
