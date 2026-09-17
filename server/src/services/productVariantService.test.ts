import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { pool, withTransaction } from '../db.js'
import {
  listVariantsForProduct, createVariant, updateVariant, deleteVariant,
  lockVariantForOrder, type VariantInput
} from './productVariantService.js'

const CATEGORY_ID = 'test-cat-variants'
const PRODUCT_ID = 'test-prod-variants'
const ORDER_ID = 'test-order-variants'

function baseInput(overrides: Partial<VariantInput> = {}): VariantInput {
  return { name: 'أحمر - كبير', sku: null, barcode: '', price: 50, cost: 25, stock: 10, available: true, sortOrder: 0, ...overrides }
}

async function resetFixtures() {
  await pool.query('DELETE FROM stock_movements')
  await pool.query('DELETE FROM order_items WHERE order_id = $1', [ORDER_ID])
  await pool.query('DELETE FROM orders WHERE id = $1', [ORDER_ID])
  await pool.query('DELETE FROM product_variants WHERE product_id = $1', [PRODUCT_ID])
  await pool.query('DELETE FROM products WHERE id = $1', [PRODUCT_ID])
  await pool.query('DELETE FROM categories WHERE id = $1', [CATEGORY_ID])

  await pool.query(`INSERT INTO categories (id, name, emoji, tint, sort_order) VALUES ($1, 'فئة اختبار', '🧪', '#fff', 1)`, [CATEGORY_ID])
  await pool.query(
    `INSERT INTO products (id, slug, category_id, name, description, price, cost, unit, emoji, available, stock, created_at)
     VALUES ($1, $1, $2, 'منتج اختبار', 'وصف', 20, 10, 'وحدة', '🧪', 1, 50, now())`,
    [PRODUCT_ID, CATEGORY_ID]
  )
}

beforeEach(resetFixtures)
afterAll(async () => {
  await resetFixtures()
  await pool.end()
})

describe('productVariantService CRUD', () => {
  it('creates a variant scoped to its parent product', async () => {
    const variant = await createVariant(PRODUCT_ID, baseInput())
    expect(variant.productId).toBe(PRODUCT_ID)
    expect(variant.name).toBe('أحمر - كبير')
    expect(variant.price).toBe(50)
    expect(variant.available).toBe(true)
  })

  it('lists variants for a product ordered by sortOrder', async () => {
    await createVariant(PRODUCT_ID, baseInput({ name: 'ثاني', sortOrder: 2 }))
    await createVariant(PRODUCT_ID, baseInput({ name: 'أول', sortOrder: 1 }))
    const variants = await listVariantsForProduct(PRODUCT_ID)
    expect(variants.map(v => v.name)).toEqual(['أول', 'ثاني'])
  })

  it('updates a variant in place', async () => {
    const variant = await createVariant(PRODUCT_ID, baseInput())
    const updated = await updateVariant(variant.id, baseInput({ price: 75, stock: 3, available: false }))
    expect(updated?.price).toBe(75)
    expect(updated?.stock).toBe(3)
    expect(updated?.available).toBe(false)
  })

  it('returns null when updating a variant that does not exist', async () => {
    const result = await updateVariant('does-not-exist', baseInput())
    expect(result).toBeNull()
  })

  it('deletes a variant with no order history', async () => {
    const variant = await createVariant(PRODUCT_ID, baseInput())
    const result = await deleteVariant(variant.id)
    expect(result).toEqual({ ok: true })
    expect(await listVariantsForProduct(PRODUCT_ID)).toEqual([])
  })

  it('rejects deleting a nonexistent variant', async () => {
    const result = await deleteVariant('does-not-exist')
    expect(result).toEqual({ ok: false, error: 'variant_not_found' })
  })

  it('rejects deleting a variant that already has real order history', async () => {
    const variant = await createVariant(PRODUCT_ID, baseInput())
    await pool.query(
      `INSERT INTO orders (id, order_number, created_at, delivery_slot, payment_method, customer_full_name, customer_mobile, customer_governorate, customer_address, subtotal, delivery_fee, total, status, discount_amount)
       VALUES ($1, $1, now(), 'now', 'COD', 'عميل', '01012345678', 'القاهرة', 'عنوان', 100, 0, 100, 'placed', 0)`,
      [ORDER_ID]
    )
    await pool.query(
      `INSERT INTO order_items (order_id, product_id, variant_id, name, unit, unit_price, quantity, line_total)
       VALUES ($1, $2, $3, 'اسم', 'وحدة', 50, 1, 50)`,
      [ORDER_ID, PRODUCT_ID, variant.id]
    )

    const result = await deleteVariant(variant.id)
    expect(result).toEqual({ ok: false, error: 'variant_has_orders' })
    expect(await listVariantsForProduct(PRODUCT_ID)).toHaveLength(1)
  })

  it('lockVariantForOrder returns null for a nonexistent variant', async () => {
    const locked = await withTransaction(client => lockVariantForOrder(client, 'does-not-exist'))
    expect(locked).toBeNull()
  })
})
