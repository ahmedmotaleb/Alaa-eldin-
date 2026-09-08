// منطق قاعدة البيانات لصور المنتجات، منفصل عن endpoint الرفع نفسه (الرفع للمزوّد الخارجي،
// المصادقة، التحقق من نوع الملف) عشان نقدر نختبر قواعد العمل دي (أول صورة تبقى تلقائياً
// رئيسية، وترقية الصورة التالية لما تتحذف الرئيسية) مباشرة من غير الحاجة لاتصال شبكة حقيقي.
import { pool, withTransaction } from '../db.js'

export interface ProductImageRow {
  id: string
  productId: string
  imageUrl: string
  storageKey: string
  altText: string
  sortOrder: number
  isPrimary: boolean
}

interface RawImageRow {
  id: string
  productId: string
  imageUrl: string
  storageKey: string
  altText: string
  sortOrder: number
  isPrimary: number
}

const SELECT_IMAGES = `
  SELECT id, product_id as "productId", image_url as "imageUrl", storage_key as "storageKey",
         alt_text as "altText", sort_order as "sortOrder", is_primary as "isPrimary"
  FROM product_images
`

function serialize(row: RawImageRow): ProductImageRow {
  return { ...row, isPrimary: !!row.isPrimary }
}

export async function listProductImages(productId: string): Promise<ProductImageRow[]> {
  const { rows } = await pool.query<RawImageRow>(
    `${SELECT_IMAGES} WHERE product_id = $1 ORDER BY is_primary DESC, sort_order ASC`,
    [productId]
  )
  return rows.map(serialize)
}

export async function addProductImage(params: {
  id: string
  productId: string
  imageUrl: string
  storageKey: string
  altText: string
}): Promise<ProductImageRow> {
  return withTransaction(async client => {
    const { rows: existing } = await client.query<{ count: string }>(
      'SELECT COUNT(*) as count FROM product_images WHERE product_id = $1',
      [params.productId]
    )
    const isFirst = parseInt(existing[0].count, 10) === 0
    const { rows: maxRows } = await client.query<{ max: number | null }>(
      'SELECT MAX(sort_order) as max FROM product_images WHERE product_id = $1',
      [params.productId]
    )
    const nextSort = (maxRows[0].max ?? -1) + 1

    await client.query(
      `INSERT INTO product_images (id, product_id, image_url, storage_key, alt_text, sort_order, is_primary, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [params.id, params.productId, params.imageUrl, params.storageKey, params.altText, nextSort, isFirst ? 1 : 0, new Date().toISOString()]
    )
    const { rows } = await client.query<RawImageRow>(`${SELECT_IMAGES} WHERE id = $1`, [params.id])
    return serialize(rows[0])
  })
}

export async function setPrimaryProductImage(productId: string, imageId: string): Promise<void> {
  await withTransaction(async client => {
    await client.query('UPDATE product_images SET is_primary = 0 WHERE product_id = $1', [productId])
    await client.query('UPDATE product_images SET is_primary = 1 WHERE id = $1', [imageId])
  })
}

export async function updateProductImageAlt(imageId: string, altText: string): Promise<void> {
  await pool.query('UPDATE product_images SET alt_text = $1 WHERE id = $2', [altText, imageId])
}

export async function reorderProductImages(productId: string, order: string[]): Promise<ProductImageRow[]> {
  await withTransaction(async client => {
    for (let i = 0; i < order.length; i++) {
      await client.query(
        'UPDATE product_images SET sort_order = $1 WHERE id = $2 AND product_id = $3',
        [i, order[i], productId]
      )
    }
  })
  return listProductImages(productId)
}

export async function getProductImage(productId: string, imageId: string): Promise<ProductImageRow | undefined> {
  const { rows } = await pool.query<RawImageRow>(`${SELECT_IMAGES} WHERE id = $1 AND product_id = $2`, [imageId, productId])
  return rows[0] ? serialize(rows[0]) : undefined
}

// بيحذف الصورة، وبيرقّي أقدم صورة تالية (بالـ sort_order) لتبقى الرئيسية لو اللي اتحذفت
// كانت هي الرئيسية — عشان مفيش منتج يفضل من غير أي صورة رئيسية طول ما لسه عنده صور تانية.
export async function deleteProductImage(productId: string, imageId: string, existing: ProductImageRow): Promise<void> {
  await withTransaction(async client => {
    await client.query('DELETE FROM product_images WHERE id = $1', [imageId])
    if (existing.isPrimary) {
      const { rows: nextRows } = await client.query<{ id: string }>(
        'SELECT id FROM product_images WHERE product_id = $1 ORDER BY sort_order ASC LIMIT 1',
        [productId]
      )
      if (nextRows[0]) {
        await client.query('UPDATE product_images SET is_primary = 1 WHERE id = $1', [nextRows[0].id])
      }
    }
  })
}
