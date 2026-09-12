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

export interface BarcodeProductRow {
  id: string
  name: string
  barcode: string
  sku: string | null
  stock: number
  price: number
  emoji: string
}

export async function findProductByBarcode(barcode: string): Promise<BarcodeProductRow | null> {
  const { rows } = await pool.query<BarcodeProductRow>(
    `SELECT id, name, barcode, sku, stock, price, emoji FROM products WHERE barcode = $1 AND barcode <> ''`,
    [barcode]
  )
  return rows[0] ?? null
}
