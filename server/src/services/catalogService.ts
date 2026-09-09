import { pool } from '../db.js'
import { listPublicAlternatives } from './productAlternativeService.js'

export const MAX_LIMIT = 100
export const DEFAULT_LIMIT = 20
const AUTOCOMPLETE_LIMIT = 8
const SIMILAR_LIMIT = 6
const MIN_SEARCH_LENGTH = 2

export type SortOption = 'popular' | 'price_asc' | 'price_desc' | 'name' | 'newest'
export type StockState = 'in_stock' | 'low_stock' | 'out_of_stock'

export interface ListProductsParams {
  page?: number
  limit?: number
  category?: string
  search?: string
  sort?: SortOption
  offer?: boolean
  bestseller?: boolean
  available?: boolean
  brand?: string
}

export interface ProductCard {
  id: string
  slug: string
  categoryId: string
  name: string
  price: number
  oldPrice?: number
  unit: string
  emoji: string
  available: boolean
  stockState: StockState
  bestseller: boolean
  offer: boolean
  orderCount: number
  primaryImage?: string
  primaryImageAlt?: string
  brand: string
}

interface ProductCardRow {
  id: string
  slug: string
  categoryId: string
  name: string
  price: number
  oldPrice: number | null
  unit: string
  emoji: string
  adminAvailable: number
  stock: number
  alertThreshold: number
  bestseller: number
  offer: number
  orderCount: number
  primaryImage: string | null
  primaryImageAlt: string | null
  brand: string
  total?: string
}

// عربي: نفس الاسم ممكن يتكتب بأكتر من شكل شائع (أ/إ/آ كلها همزة على الألف، ي بدل ى في آخر
// الكلمة، ه بدل ة في العامية) — التطبيع ده بيتم وقت المقارنة في البحث فقط، الاسم المخزّن في
// قاعدة البيانات (وعلى الواجهة) ما بيتغيرش خالص.
const NORMALIZE_SQL = (expr: string) => `lower(translate(${expr}, 'أإآىة', 'ااايه'))`

function stockStateOf(stock: number, alertThreshold: number): StockState {
  if (stock <= 0) return 'out_of_stock'
  if (stock <= alertThreshold) return 'low_stock'
  return 'in_stock'
}

function serializeCard(row: ProductCardRow): ProductCard {
  return {
    id: row.id,
    slug: row.slug,
    categoryId: row.categoryId,
    name: row.name,
    price: row.price,
    oldPrice: row.oldPrice ?? undefined,
    unit: row.unit,
    emoji: row.emoji,
    available: !!row.adminAvailable && row.stock > 0,
    stockState: stockStateOf(row.stock, row.alertThreshold),
    bestseller: !!row.bestseller,
    offer: !!row.offer,
    orderCount: row.orderCount,
    primaryImage: row.primaryImage ?? undefined,
    primaryImageAlt: row.primaryImageAlt ?? undefined,
    brand: row.brand
  }
}

const PRIMARY_IMAGE_JOIN = `
  LEFT JOIN LATERAL (
    SELECT image_url, alt_text FROM product_images pi
    WHERE pi.product_id = p.id
    ORDER BY pi.is_primary DESC, pi.sort_order ASC
    LIMIT 1
  ) img ON true
`

const CARD_SELECT = `
  SELECT p.id, p.slug, p.category_id as "categoryId", p.name, p.price, p.old_price as "oldPrice",
         p.unit, p.emoji, p.available as "adminAvailable", p.stock, p.alert_threshold as "alertThreshold",
         p.bestseller, p.offer, p.order_count as "orderCount", p.brand,
         img.image_url as "primaryImage", img.alt_text as "primaryImageAlt"
`

function sortClause(sort: SortOption | undefined, hasSearch: boolean, searchParamIndex: number): string {
  if (hasSearch && (!sort || sort === 'popular')) {
    // بحث بدون فرز محدد صراحة: الأقرب لكلمة البحث الأول (تشابه trigram)، وبعدين الأكثر مبيعاً.
    return `ORDER BY (p.barcode <> '' AND p.barcode = $${searchParamIndex}) DESC, similarity(p.name, $${searchParamIndex}) DESC, p.order_count DESC, p.name ASC`
  }
  switch (sort) {
    case 'price_asc': return 'ORDER BY p.price ASC, p.name ASC'
    case 'price_desc': return 'ORDER BY p.price DESC, p.name ASC'
    case 'name': return 'ORDER BY p.name ASC'
    case 'newest': return 'ORDER BY p.created_at DESC, p.name ASC'
    case 'popular':
    default: return 'ORDER BY p.order_count DESC, p.name ASC'
  }
}

export async function listProducts(params: ListProductsParams) {
  const page = Math.max(1, Math.floor(params.page ?? 1) || 1)
  const limit = Math.min(MAX_LIMIT, Math.max(1, Math.floor(params.limit ?? DEFAULT_LIMIT) || DEFAULT_LIMIT))
  const offset = (page - 1) * limit

  const conditions: string[] = []
  const values: unknown[] = []

  if (params.category) {
    values.push(params.category)
    conditions.push(`p.category_id = $${values.length}`)
  }
  if (params.brand) {
    values.push(params.brand)
    conditions.push(`p.brand = $${values.length}`)
  }
  if (params.offer) conditions.push('p.offer = 1')
  if (params.bestseller) conditions.push('p.bestseller = 1')
  if (typeof params.available === 'boolean') {
    conditions.push(params.available ? '(p.available = 1 AND p.stock > 0)' : '(p.available = 0 OR p.stock <= 0)')
  }

  const trimmedSearch = (params.search ?? '').trim()
  let searchParamIndex = -1
  if (trimmedSearch) {
    values.push(trimmedSearch)
    searchParamIndex = values.length
    if (trimmedSearch.length >= MIN_SEARCH_LENGTH) {
      values.push(`%${trimmedSearch}%`)
      const likeIdx = values.length
      conditions.push(`(
        p.barcode = $${searchParamIndex}
        OR ${NORMALIZE_SQL('p.name')} ILIKE ${NORMALIZE_SQL(`$${likeIdx}`)}
        OR ${NORMALIZE_SQL('p.brand')} ILIKE ${NORMALIZE_SQL(`$${likeIdx}`)}
        OR ${NORMALIZE_SQL('c.name')} ILIKE ${NORMALIZE_SQL(`$${likeIdx}`)}
        OR p.name % $${searchParamIndex}
      )`)
    } else {
      // أقل من الحد الأدنى لطول البحث (حرفين): يُسمح فقط بمطابقة باركود دقيقة فورية.
      conditions.push(`p.barcode = $${searchParamIndex}`)
    }
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  values.push(limit)
  const limitIdx = values.length
  values.push(offset)
  const offsetIdx = values.length

  const sql = `
    ${CARD_SELECT}, count(*) OVER() as total
    FROM products p
    JOIN categories c ON c.id = p.category_id
    ${PRIMARY_IMAGE_JOIN}
    ${where}
    ${sortClause(params.sort, searchParamIndex !== -1, searchParamIndex)}
    LIMIT $${limitIdx} OFFSET $${offsetIdx}
  `

  const { rows } = await pool.query<ProductCardRow>(sql, values)
  const total = rows.length ? Number(rows[0].total) : 0
  return {
    products: rows.map(serializeCard),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) }
  }
}

export async function resolveProducts(ids: string[]): Promise<ProductCard[]> {
  const uniqueIds = [...new Set(ids)].filter(id => typeof id === 'string' && id.length > 0).slice(0, 200)
  if (!uniqueIds.length) return []
  const { rows } = await pool.query<ProductCardRow>(
    `${CARD_SELECT} FROM products p ${PRIMARY_IMAGE_JOIN} WHERE p.id = ANY($1::text[])`,
    [uniqueIds]
  )
  return rows.map(serializeCard)
}

export async function autocompleteProducts(rawQuery: string) {
  const trimmed = rawQuery.trim()
  if (trimmed.length < MIN_SEARCH_LENGTH) return []
  const { products } = await listProducts({ search: trimmed, limit: AUTOCOMPLETE_LIMIT, page: 1 })
  return products
}

interface GalleryImageRow {
  id: string
  url: string
  altText: string
  isPrimary: number
  sortOrder: number
}

interface ProductDetailRow {
  id: string
  slug: string
  categoryId: string
  categoryName: string
  name: string
  description: string
  price: number
  oldPrice: number | null
  unit: string
  emoji: string
  brand: string
  adminAvailable: number
  stock: number
  alertThreshold: number
}

export async function getProductBySlug(slug: string) {
  const { rows } = await pool.query<ProductDetailRow>(
    `SELECT p.id, p.slug, p.category_id as "categoryId", c.name as "categoryName", p.name, p.description,
            p.price, p.old_price as "oldPrice", p.unit, p.emoji, p.brand,
            p.available as "adminAvailable", p.stock, p.alert_threshold as "alertThreshold"
     FROM products p
     JOIN categories c ON c.id = p.category_id
     WHERE p.slug = $1`,
    [slug]
  )
  const product = rows[0]
  if (!product) return null

  const [{ rows: images }, alternatives, similarRes] = await Promise.all([
    pool.query<GalleryImageRow>(
      `SELECT id, image_url as "url", alt_text as "altText", is_primary as "isPrimary", sort_order as "sortOrder"
       FROM product_images WHERE product_id = $1 ORDER BY is_primary DESC, sort_order ASC`,
      [product.id]
    ),
    listPublicAlternatives(product.id),
    listProducts({ category: product.categoryId, limit: SIMILAR_LIMIT + 1 })
  ])

  const similarProducts = similarRes.products.filter(p => p.id !== product.id).slice(0, SIMILAR_LIMIT)

  return {
    id: product.id,
    slug: product.slug,
    categoryId: product.categoryId,
    categoryName: product.categoryName,
    name: product.name,
    description: product.description,
    price: product.price,
    oldPrice: product.oldPrice ?? undefined,
    unit: product.unit,
    emoji: product.emoji,
    brand: product.brand,
    available: !!product.adminAvailable && product.stock > 0,
    stockState: stockStateOf(product.stock, product.alertThreshold),
    gallery: images.map(img => ({
      id: img.id,
      url: img.url,
      altText: img.altText,
      isPrimary: !!img.isPrimary,
      sortOrder: img.sortOrder
    })),
    alternatives,
    similarProducts
  }
}
