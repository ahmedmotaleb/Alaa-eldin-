import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { pool } from '../db.js'
import { createProduct, updateProduct, slugifyProductName, generateUniqueProductSlug, type ProductWriteInput } from './productService.js'
import { findProductByBarcode } from './productSkuService.js'

const CATEGORY_ID = 'test-cat-product-service'
const USER_ID = 'test-user-product-service'

async function resetFixtures() {
  await pool.query(`DELETE FROM stock_movements WHERE product_id IN (SELECT id FROM products WHERE category_id = $1)`, [CATEGORY_ID])
  await pool.query(`DELETE FROM product_cost_history WHERE product_id IN (SELECT id FROM products WHERE category_id = $1)`, [CATEGORY_ID])
  await pool.query('DELETE FROM products WHERE category_id = $1', [CATEGORY_ID])
  await pool.query('DELETE FROM categories WHERE id = $1', [CATEGORY_ID])
  await pool.query('DELETE FROM users WHERE id = $1', [USER_ID])

  await pool.query(
    `INSERT INTO categories (id, name, emoji, tint, sort_order) VALUES ($1, 'فئة اختبار المنتجات', '🧪', '#fff', 1)`,
    [CATEGORY_ID]
  )
  await pool.query(
    `INSERT INTO users (id, full_name, email, password_hash, role, created_at) VALUES ($1, 'مستخدم اختبار', 'product-service-test@example.com', 'x', 'admin', now())`,
    [USER_ID]
  )
}

function baseInput(overrides: Partial<ProductWriteInput> = {}): ProductWriteInput {
  return {
    categoryId: CATEGORY_ID,
    name: 'منتج اختبار',
    description: 'وصف اختباري',
    price: 10,
    oldPrice: null,
    cost: 5,
    unit: 'قطعة',
    emoji: '🧪',
    available: true,
    bestseller: false,
    offer: false,
    stock: 20,
    alertThreshold: 5,
    barcode: '',
    brand: '',
    ...overrides
  }
}

describe('slugifyProductName', () => {
  it('produces a lowercase, hyphenated, URL-safe slug from a Latin name', () => {
    expect(slugifyProductName('Sunflower Oil 1L')).toBe('sunflower-oil-1l')
  })

  it('never returns an empty slug for an Arabic-only name', () => {
    const slug = slugifyProductName('زيت عباد الشمس')
    expect(slug.length).toBeGreaterThan(0)
    expect(slug).toMatch(/^[a-z0-9-]+$/)
  })

  it('falls back to a stable non-empty value when the name has no transliterable characters', () => {
    expect(slugifyProductName('🎉🎉🎉')).toBe('product')
  })
})

describe('createProduct / updateProduct / findProductByBarcode', () => {
  beforeEach(resetFixtures)
  afterAll(resetFixtures)

  it('creates a product without any slug being supplied, generating one automatically from the name', async () => {
    const product = await createProduct(baseInput({ name: 'شاي أحمر' }))
    expect(product.id).toBeTruthy()
    expect(product.slug).toBeTruthy()
    expect(product.slug).toMatch(/^[a-z0-9-]+$/)
  })

  it('creates a product without a barcode successfully', async () => {
    const product = await createProduct(baseInput({ name: 'سكر أبيض', barcode: '' }))
    expect(product.barcode).toBe('')
  })

  it('gives two products with the identical name different, unique slugs', async () => {
    const first = await createProduct(baseInput({ name: 'عصير برتقال' }))
    const second = await createProduct(baseInput({ name: 'عصير برتقال' }))
    expect(first.slug).not.toBe(second.slug)
    expect(second.slug).toBe(`${first.slug}-2`)

    const third = await createProduct(baseInput({ name: 'عصير برتقال' }))
    expect(third.slug).toBe(`${first.slug}-3`)
  })

  it('does not change the existing slug when the product name is edited', async () => {
    const product = await createProduct(baseInput({ name: 'زبادي طبيعي' }))
    const originalSlug = product.slug

    const update = await updateProduct(product.id, baseInput({ name: 'زبادي طبيعي كامل الدسم' }), USER_ID)
    expect(update).not.toBeNull()
    expect(update!.after.slug).toBe(originalSlug)
    expect(update!.after.name).toBe('زبادي طبيعي كامل الدسم')
  })

  it('succeeds when editing a product to clear an existing barcode to empty', async () => {
    const product = await createProduct(baseInput({ name: 'معجون طماطم', barcode: '6221030012345' }))
    expect(product.barcode).toBe('6221030012345')

    const update = await updateProduct(product.id, baseInput({ name: 'معجون طماطم', barcode: '' }), USER_ID)
    expect(update).not.toBeNull()
    expect(update!.after.barcode).toBe('')
  })

  it('still finds a product by its real barcode via findProductByBarcode', async () => {
    const barcode = '6221030099999'
    const product = await createProduct(baseInput({ name: 'زيت زيتون', barcode }))

    const found = await findProductByBarcode(barcode)
    expect(found).not.toBeNull()
    expect(found!.id).toBe(product.id)
  })

  it('returns null from findProductByBarcode for a blank barcode instead of matching every blank-barcode product', async () => {
    await createProduct(baseInput({ name: 'منتج بدون باركود 1', barcode: '' }))
    await createProduct(baseInput({ name: 'منتج بدون باركود 2', barcode: '' }))

    const found = await findProductByBarcode('')
    expect(found).toBeNull()
  })

  it('returns null from updateProduct for a non-existent product id', async () => {
    const update = await updateProduct('does-not-exist', baseInput(), USER_ID)
    expect(update).toBeNull()
  })
})

describe('generateUniqueProductSlug', () => {
  beforeEach(resetFixtures)
  afterAll(resetFixtures)

  it('reuses the base slug when nothing else has it', async () => {
    const slug = await generateUniqueProductSlug('منتج فريد تماماً')
    expect(slug).toBe(slugifyProductName('منتج فريد تماماً'))
  })

  it('picks the next free numeric suffix when the base and -2 are both taken', async () => {
    const base = slugifyProductName('اسم مكرر')
    await pool.query(
      `INSERT INTO products (id, slug, category_id, name, description, price, cost, unit, emoji, available, stock, created_at)
       VALUES ($1, $2, $3, 'اسم مكرر', '', 10, 5, 'قطعة', '🧪', 1, 1, now())`,
      ['test-dup-1', base, CATEGORY_ID]
    )
    await pool.query(
      `INSERT INTO products (id, slug, category_id, name, description, price, cost, unit, emoji, available, stock, created_at)
       VALUES ($1, $2, $3, 'اسم مكرر', '', 10, 5, 'قطعة', '🧪', 1, 1, now())`,
      ['test-dup-2', `${base}-2`, CATEGORY_ID]
    )

    const slug = await generateUniqueProductSlug('اسم مكرر')
    expect(slug).toBe(`${base}-3`)
  })
})
