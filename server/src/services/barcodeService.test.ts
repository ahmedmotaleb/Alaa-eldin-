import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { pool } from '../db.js'
import { createVariant } from './productVariantService.js'
import { detectBarcodeFormat, generateBarcodeForProduct, generateBarcodeForVariant } from './barcodeService.js'

const CATEGORY_ID = 'test-cat-barcode'
const PRODUCT_ID = 'test-prod-barcode-1'
const PRODUCT_ID_2 = 'test-prod-barcode-2'

async function deleteFixtures() {
  await pool.query('DELETE FROM product_variants WHERE product_id IN ($1, $2)', [PRODUCT_ID, PRODUCT_ID_2])
  await pool.query('DELETE FROM products WHERE id IN ($1, $2)', [PRODUCT_ID, PRODUCT_ID_2])
  await pool.query('DELETE FROM categories WHERE id = $1', [CATEGORY_ID])
}

async function resetFixtures() {
  await deleteFixtures()
  await pool.query(
    `INSERT INTO categories (id, name, emoji, tint, sort_order) VALUES ($1, 'فئة اختبار', '🧪', '#fff', 1)`,
    [CATEGORY_ID]
  )
  await pool.query(
    `INSERT INTO products (id, slug, category_id, name, description, price, cost, unit, emoji, available, stock, barcode, created_at)
     VALUES ($1, 'barcode-prod-1', $2, 'منتج 1', 'وصف', 10, 5, 'وحدة', '🧪', 1, 20, '4006381333931', now())`,
    [PRODUCT_ID, CATEGORY_ID]
  )
  await pool.query(
    `INSERT INTO products (id, slug, category_id, name, description, price, cost, unit, emoji, available, stock, barcode, created_at)
     VALUES ($1, 'barcode-prod-2', $2, 'منتج 2', 'وصف', 20, 8, 'وحدة', '🧪', 1, 10, '', now())`,
    [PRODUCT_ID_2, CATEGORY_ID]
  )
}

describe('barcodeService — detectBarcodeFormat', () => {
  it('detects a valid EAN-13 barcode and confirms its checksum', () => {
    // 4006381333931 مُتحقّق منه فعلياً بخوارزمية GS1 القياسية (مش مُفترَض) — checksum
    // المُحسوب لأول 12 رقم يساوي 1، ونفسه آخر رقم في القيمة دي.
    const result = detectBarcodeFormat('4006381333931')
    expect(result).toEqual({ format: 'ean13', checksumValid: true })
  })

  it('detects an EAN-13-shaped barcode with an invalid checksum', () => {
    // نفس الأرقام الاتناشر الأولى بتاعة القيمة الصالحة فوق، بس برقم تحقق مختلف عمداً (2
    // بدل 1) — نفس الطول والشكل، checksum غلط بس.
    const result = detectBarcodeFormat('4006381333932')
    expect(result).toEqual({ format: 'ean13', checksumValid: false })
  })

  it('detects a valid EAN-8 barcode', () => {
    // 96385074 باركود EAN-8 صالح (checksum صحيح، مثال معروف من توثيق GS1).
    const result = detectBarcodeFormat('96385074')
    expect(result).toEqual({ format: 'ean8', checksumValid: true })
  })

  it('falls back to Code128 for any non-EAN-shaped value', () => {
    expect(detectBarcodeFormat('BC-100001')).toEqual({ format: 'code128', checksumValid: true })
    expect(detectBarcodeFormat('ABC123')).toEqual({ format: 'code128', checksumValid: true })
  })

  it('treats an empty string as an invalid Code128 value', () => {
    expect(detectBarcodeFormat('')).toEqual({ format: 'code128', checksumValid: false })
  })
})

describe('barcodeService — generation', () => {
  beforeEach(resetFixtures)
  afterAll(async () => {
    await deleteFixtures()
    await pool.end()
  })

  it('generates a unique internal BC-###### barcode for a product missing one', async () => {
    const result = await generateBarcodeForProduct(PRODUCT_ID_2)
    expect('error' in result).toBe(false)
    if ('error' in result) return
    expect(result.barcode).toMatch(/^BC-\d{6}$/)

    const { rows } = await pool.query('SELECT barcode FROM products WHERE id = $1', [PRODUCT_ID_2])
    expect(rows[0].barcode).toBe(result.barcode)
  })

  it('never overwrites an existing product barcode without explicit confirmation', async () => {
    const result = await generateBarcodeForProduct(PRODUCT_ID)
    expect(result).toEqual({ error: 'barcode_already_set' })

    const { rows } = await pool.query('SELECT barcode FROM products WHERE id = $1', [PRODUCT_ID])
    expect(rows[0].barcode).toBe('4006381333931')
  })

  it('overwrites an existing barcode only when confirmOverwrite is explicitly true', async () => {
    const result = await generateBarcodeForProduct(PRODUCT_ID, true)
    expect('error' in result).toBe(false)
    if ('error' in result) return
    expect(result.barcode).toMatch(/^BC-\d{6}$/)
    expect(result.barcode).not.toBe('4006381333931')
  })

  it('returns an error for a non-existent product', async () => {
    expect(await generateBarcodeForProduct('missing-product-id')).toEqual({ error: 'product_not_found' })
  })

  it('generates a unique barcode for a variant missing one, independently of its parent product', async () => {
    const variant = await createVariant(PRODUCT_ID_2, {
      name: 'متغيّر تجريبي', sku: null, barcode: '', price: 15, oldPrice: null, cost: 6, stock: 5, available: true, sortOrder: 0
    })
    const result = await generateBarcodeForVariant(variant.id)
    expect('error' in result).toBe(false)
    if ('error' in result) return
    expect(result.barcode).toMatch(/^BC-\d{6}$/)

    // متغيّر جديد بس — منتجه الأب لسه من غير باركود، وميتأثرش بتوليد باركود المتغيّر.
    const { rows } = await pool.query('SELECT barcode FROM products WHERE id = $1', [PRODUCT_ID_2])
    expect(rows[0].barcode).toBe('')
  })

  it('never overwrites an existing variant barcode without explicit confirmation', async () => {
    const variant = await createVariant(PRODUCT_ID, {
      name: 'متغيّر بباركود', sku: null, barcode: 'BC-900001', price: 15, oldPrice: null, cost: 6, stock: 5, available: true, sortOrder: 0
    })
    const result = await generateBarcodeForVariant(variant.id)
    expect(result).toEqual({ error: 'barcode_already_set' })
  })

  it('returns an error for a non-existent variant', async () => {
    expect(await generateBarcodeForVariant('missing-variant-id')).toEqual({ error: 'variant_not_found' })
  })

  it('guarantees uniqueness across concurrent generation for different products (DB-level unique constraint)', async () => {
    const [resultA, resultB] = await Promise.all([
      generateBarcodeForProduct(PRODUCT_ID_2),
      (async () => {
        const variant = await createVariant(PRODUCT_ID, {
          name: 'متغيّر متزامن', sku: null, barcode: '', price: 12, oldPrice: null, cost: 5, stock: 3, available: true, sortOrder: 0
        })
        return generateBarcodeForVariant(variant.id)
      })()
    ])
    if ('error' in resultA || 'error' in resultB) throw new Error('unexpected generation error')
    expect(resultA.barcode).not.toBe(resultB.barcode)
  })
})
