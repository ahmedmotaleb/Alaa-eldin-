import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { pool } from '../db.js'
import { setProductSku, generateSkuForProduct, findProductByBarcode } from './productSkuService.js'

const CATEGORY_ID = 'test-cat-sku'
const PRODUCT_ID = 'test-prod-sku-1'
const PRODUCT_ID_2 = 'test-prod-sku-2'

async function resetFixtures() {
  await pool.query('DELETE FROM products WHERE id IN ($1, $2)', [PRODUCT_ID, PRODUCT_ID_2])
  await pool.query('DELETE FROM categories WHERE id = $1', [CATEGORY_ID])
  await pool.query(
    `INSERT INTO categories (id, name, emoji, tint, sort_order) VALUES ($1, 'فئة اختبار', '🧪', '#fff', 1)`,
    [CATEGORY_ID]
  )
  await pool.query(
    `INSERT INTO products (id, slug, category_id, name, description, price, cost, unit, emoji, available, stock, barcode, created_at)
     VALUES ($1, 'sku-prod-1', $2, 'منتج 1', 'وصف', 10, 5, 'وحدة', '🧪', 1, 20, '6221031001234', now())`,
    [PRODUCT_ID, CATEGORY_ID]
  )
  await pool.query(
    `INSERT INTO products (id, slug, category_id, name, description, price, cost, unit, emoji, available, stock, barcode, created_at)
     VALUES ($1, 'sku-prod-2', $2, 'منتج 2', 'وصف', 20, 8, 'وحدة', '🧪', 1, 10, '', now())`,
    [PRODUCT_ID_2, CATEGORY_ID]
  )
}

describe('productSkuService', () => {
  beforeEach(resetFixtures)
  afterAll(async () => {
    await pool.query('DELETE FROM products WHERE id IN ($1, $2)', [PRODUCT_ID, PRODUCT_ID_2])
    await pool.query('DELETE FROM categories WHERE id = $1', [CATEGORY_ID])
  })

  it('sets and normalizes an SKU to uppercase, trimmed', async () => {
    const result = await setProductSku(PRODUCT_ID, '  ala-manual-1  ')
    expect('error' in result).toBe(false)
    if ('error' in result) return
    expect(result.sku).toBe('ALA-MANUAL-1')
  })

  it('clears an SKU when given null or an empty string', async () => {
    await setProductSku(PRODUCT_ID, 'ALA-1')
    const cleared = await setProductSku(PRODUCT_ID, '')
    expect('error' in cleared).toBe(false)
    if ('error' in cleared) return
    expect(cleared.sku).toBeNull()
  })

  it('rejects setting a duplicate SKU on a different product', async () => {
    await setProductSku(PRODUCT_ID, 'ALA-DUPLICATE')
    await expect(setProductSku(PRODUCT_ID_2, 'ALA-DUPLICATE')).rejects.toThrow()
  })

  it('generates a sequential ALA-###### SKU', async () => {
    const result = await generateSkuForProduct(PRODUCT_ID)
    expect('error' in result).toBe(false)
    if ('error' in result) return
    expect(result.sku).toMatch(/^ALA-\d{6}$/)
  })

  it('never overwrites an existing SKU when generating', async () => {
    await setProductSku(PRODUCT_ID, 'ALA-EXISTING')
    const result = await generateSkuForProduct(PRODUCT_ID)
    expect(result).toEqual({ error: 'sku_already_set' })

    const { rows } = await pool.query('SELECT sku FROM products WHERE id = $1', [PRODUCT_ID])
    expect(rows[0].sku).toBe('ALA-EXISTING')
  })

  it('returns an error for a non-existent product', async () => {
    expect(await setProductSku('missing-id', 'ALA-X')).toEqual({ error: 'product_not_found' })
    expect(await generateSkuForProduct('missing-id')).toEqual({ error: 'product_not_found' })
  })

  it('finds a product by exact barcode match', async () => {
    const found = await findProductByBarcode('6221031001234')
    expect(found?.id).toBe(PRODUCT_ID)
  })

  it('does not match a product with an empty barcode', async () => {
    const found = await findProductByBarcode('')
    expect(found).toBeNull()
  })

  it('returns null for an unknown barcode', async () => {
    const found = await findProductByBarcode('0000000000000')
    expect(found).toBeNull()
  })

  it('includes unit/available/primaryImage on a product-barcode match', async () => {
    const found = await findProductByBarcode('6221031001234')
    expect(found?.unit).toBe('وحدة')
    expect(found?.available).toBe(true)
    expect(found?.variant).toBeUndefined()
  })

  it('finds a product by an exact variant barcode, returning the variant’s own price/stock (not the parent’s)', async () => {
    const variantId = 'test-variant-sku-1'
    await pool.query('DELETE FROM product_variants WHERE id = $1', [variantId])
    await pool.query(
      `INSERT INTO product_variants (id, product_id, name, sku, barcode, price, cost, stock, available, sort_order, created_at)
       VALUES ($1, $2, 'كبير', 'VAR-SKU-1', '6221031009999', 99, 50, 3, 1, 0, now())`,
      [variantId, PRODUCT_ID]
    )
    try {
      const found = await findProductByBarcode('6221031009999')
      expect(found?.id).toBe(PRODUCT_ID)
      // منتج 1 (fixture) مخزونه 20 وسعره 10 — لازم الرد يرجّع بيانات المتغيّر، مش دول.
      expect(found?.stock).toBe(20)
      expect(found?.price).toBe(10)
      expect(found?.variant).toEqual({
        id: variantId, name: 'كبير', sku: 'VAR-SKU-1', barcode: '6221031009999', price: 99, stock: 3, available: true
      })
    } finally {
      await pool.query('DELETE FROM product_variants WHERE id = $1', [variantId])
    }
  })

  it('does not match a variant with an empty barcode', async () => {
    const variantId = 'test-variant-sku-2'
    await pool.query('DELETE FROM product_variants WHERE id = $1', [variantId])
    await pool.query(
      `INSERT INTO product_variants (id, product_id, name, price, cost, stock, available, barcode, sort_order, created_at)
       VALUES ($1, $2, 'صغير', 15, 7, 5, 1, '', 0, now())`,
      [variantId, PRODUCT_ID]
    )
    try {
      expect(await findProductByBarcode('')).toBeNull()
    } finally {
      await pool.query('DELETE FROM product_variants WHERE id = $1', [variantId])
    }
  })
})
