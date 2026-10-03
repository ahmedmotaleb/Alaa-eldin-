import { pool } from '../db.js'

export interface SkuUpdateResult {
  id: string
  sku: string | null
}

// SKU بيتطبّع لحروف كبيرة ومن غير مسافات زيادة — عشان "ala-1" و"ALA-1" ما يتحسبوش قيمتين
// مختلفتين تصادفياً. NULL/فاضي يعني "امسح الـ SKU الحالي" (مسموح ترجع المنتج لحالة من غير SKU).
export async function setProductSku(productId: string, rawSku: string | null): Promise<SkuUpdateResult | { error: string }> {
  const sku = rawSku?.trim().toUpperCase() || null
  const { rows } = await pool.query<SkuUpdateResult>(
    'UPDATE products SET sku = $2 WHERE id = $1 RETURNING id, sku',
    [productId, sku]
  )
  if (!rows[0]) return { error: 'product_not_found' }
  return rows[0]
}

// توليد SKU تلقائي بصيغة ALA-000123 (sequence حقيقي في قاعدة البيانات، مش رقم عشوائي أو
// عداد في الذاكرة) — أبداً ما بيكتبش فوق SKU موجود بالفعل لمنتج، حتى لو اتنادى بالغلط.
export async function generateSkuForProduct(productId: string): Promise<SkuUpdateResult | { error: string }> {
  const { rows: existingRows } = await pool.query<{ sku: string | null }>('SELECT sku FROM products WHERE id = $1', [productId])
  if (!existingRows[0]) return { error: 'product_not_found' }
  if (existingRows[0].sku) return { error: 'sku_already_set' }

  const { rows: seqRows } = await pool.query<{ n: number }>("SELECT nextval('product_sku_seq') as n")
  const sku = `ALA-${String(seqRows[0].n).padStart(6, '0')}`

  const { rows } = await pool.query<SkuUpdateResult>(
    'UPDATE products SET sku = $2 WHERE id = $1 RETURNING id, sku',
    [productId, sku]
  )
  return rows[0]
}

export interface BarcodeVariantInfo {
  id: string
  name: string
  sku: string | null
  barcode: string
  price: number
  stock: number
  available: boolean
}

export interface BarcodeProductRow {
  id: string
  slug: string
  name: string
  barcode: string
  sku: string | null
  stock: number
  price: number
  oldPrice?: number
  unit: string
  available: boolean
  emoji: string
  primaryImage?: string
  // موجودة بس لو التطابق كان على باركود متغيّر (مش باركود المنتج الأساسي نفسه) — السعر/المخزون
  // المعروضين فوق في هذه الحالة بيكونوا بالفعل بتاعة المتغيّر (راجع lookup تحت)، مش المنتج
  // الأساسي، عشان مانوريش مخزون/سعر غلط لمتغيّر مُسكَن.
  variant?: BarcodeVariantInfo
}

interface ProductBarcodeHit {
  id: string
  slug: string
  name: string
  barcode: string
  sku: string | null
  stock: number
  price: number
  oldPrice: number | null
  unit: string
  available: number
  emoji: string
  primaryImage: string | null
}

const SELECT_PRODUCT_BARCODE_HIT = `
  SELECT p.id, p.slug, p.name, p.barcode, p.sku, p.stock, p.price, p.old_price as "oldPrice",
         p.unit, p.available, p.emoji, img.image_url as "primaryImage"
  FROM products p
  LEFT JOIN LATERAL (
    SELECT image_url FROM product_images pi
    WHERE pi.product_id = p.id
    ORDER BY pi.is_primary DESC, pi.sort_order ASC
    LIMIT 1
  ) img ON true
`

function serializeHit(row: ProductBarcodeHit): BarcodeProductRow {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    barcode: row.barcode,
    sku: row.sku,
    stock: row.stock,
    price: row.price,
    oldPrice: row.oldPrice ?? undefined,
    unit: row.unit,
    available: !!row.available,
    emoji: row.emoji,
    primaryImage: row.primaryImage ?? undefined
  }
}

// تطابق تام بس (مفيش بحث تقريبي أبداً على رقم باركود) — بيدوّر أولاً على باركود المنتج
// الأساسي، وبعدين لو ملقاش، على باركود متغيّر فعلي (راجع مسح الباركود: المنتج ممكن يتسجّل
// بأكتر من باركود فعلي واحد لكل متغيّر — مقاس/وزن مختلف غالباً). لو التطابق على متغيّر،
// الرد بيرجّع بيانات المنتج الأساسي (اسم/صورة/إيموجي) + بيانات المتغيّر المطابق تحديداً
// (سعره ومخزونه الحقيقيين، مش بتوع المنتج الأساسي) — عشان الأدمن ميشوفش مخزون غلط.
export async function findProductByBarcode(barcode: string): Promise<BarcodeProductRow | null> {
  const { rows: productRows } = await pool.query<ProductBarcodeHit>(
    `${SELECT_PRODUCT_BARCODE_HIT} WHERE p.barcode = $1 AND p.barcode <> '' AND p.deleted_at IS NULL`,
    [barcode]
  )
  if (productRows[0]) return serializeHit(productRows[0])

  const { rows: variantRows } = await pool.query<ProductBarcodeHit & {
    variantId: string, variantName: string, variantSku: string | null, variantBarcode: string,
    variantPrice: number, variantStock: number, variantAvailable: number
  }>(
    `SELECT p.id, p.slug, p.name, p.barcode, p.sku, p.stock, p.price, p.old_price as "oldPrice",
            p.unit, p.available, p.emoji, img.image_url as "primaryImage",
            v.id as "variantId", v.name as "variantName", v.sku as "variantSku", v.barcode as "variantBarcode",
            v.price as "variantPrice", v.stock as "variantStock", v.available as "variantAvailable"
     FROM product_variants v
     JOIN products p ON p.id = v.product_id
     LEFT JOIN LATERAL (
       SELECT image_url FROM product_images pi
       WHERE pi.product_id = p.id
       ORDER BY pi.is_primary DESC, pi.sort_order ASC
       LIMIT 1
     ) img ON true
     WHERE v.barcode = $1 AND v.barcode <> '' AND p.deleted_at IS NULL`,
    [barcode]
  )
  const variantHit = variantRows[0]
  if (!variantHit) return null

  return {
    ...serializeHit(variantHit),
    variant: {
      id: variantHit.variantId,
      name: variantHit.variantName,
      sku: variantHit.variantSku,
      barcode: variantHit.variantBarcode,
      price: variantHit.variantPrice,
      stock: variantHit.variantStock,
      available: !!variantHit.variantAvailable
    }
  }
}
