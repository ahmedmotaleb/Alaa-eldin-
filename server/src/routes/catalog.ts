import { Router } from 'express'
import { pool } from '../db.js'

export const catalogRouter = Router()

interface CategoryRow {
  id: string
  name: string
  emoji: string
  tint: string
}

interface ProductRow {
  id: string
  slug: string
  categoryId: string
  name: string
  description: string
  price: number
  oldPrice: number | null
  unit: string
  emoji: string
  available: number
  bestseller: number
  offer: number
  orderCount: number
  primaryImage: string | null
  primaryImageAlt: string | null
}

function serializeProduct(row: ProductRow) {
  return {
    id: row.id,
    slug: row.slug,
    categoryId: row.categoryId,
    name: row.name,
    description: row.description,
    price: row.price,
    oldPrice: row.oldPrice ?? undefined,
    unit: row.unit,
    emoji: row.emoji,
    available: !!row.available,
    bestseller: !!row.bestseller,
    offer: !!row.offer,
    orderCount: row.orderCount,
    primaryImage: row.primaryImage ?? undefined,
    primaryImageAlt: row.primaryImageAlt ?? undefined
  }
}

// صورة واحدة تمثيلية لكل منتج: الصورة الأساسية (is_primary) لو موجودة، وإلا أول صورة
// بالترتيب (sort_order) — نفس سلسلة الأولوية المتبعة في كل الواجهة. الإيموجي والصورة
// النائبة (placeholder) اتحسابهم بيتم على الواجهة الأمامية لو primaryImage جت فاضية.
const PRIMARY_IMAGE_JOIN = `
  LEFT JOIN LATERAL (
    SELECT image_url, alt_text FROM product_images pi
    WHERE pi.product_id = p.id
    ORDER BY pi.is_primary DESC, pi.sort_order ASC
    LIMIT 1
  ) img ON true
`

catalogRouter.get('/categories', async (_req, res) => {
  const { rows } = await pool.query<CategoryRow>('SELECT id, name, emoji, tint FROM categories ORDER BY sort_order')
  res.json({ categories: rows })
})

catalogRouter.get('/products', async (_req, res) => {
  const { rows } = await pool.query<ProductRow>(`
    SELECT p.id, p.slug, p.category_id as "categoryId", p.name, p.description, p.price, p.old_price as "oldPrice",
           p.unit, p.emoji, p.available, p.bestseller, p.offer, p.order_count as "orderCount",
           img.image_url as "primaryImage", img.alt_text as "primaryImageAlt"
    FROM products p
    ${PRIMARY_IMAGE_JOIN}
    ORDER BY p.name
  `)
  res.json({ products: rows.map(serializeProduct) })
})
