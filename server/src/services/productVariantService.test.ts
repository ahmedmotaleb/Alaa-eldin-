import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import crypto from 'node:crypto'
import { pool, withTransaction } from '../db.js'
import {
  listVariantsForProduct, createVariant, updateVariant, deleteVariant,
  lockVariantForOrder, deductVariantStock, restoreVariantStock, type VariantInput
} from './productVariantService.js'

const CATEGORY_ID = 'test-cat-variants'
const PRODUCT_ID = 'test-prod-variants'
const ORDER_ID = 'test-order-variants'

function baseInput(overrides: Partial<VariantInput> = {}): VariantInput {
  return { name: 'أحمر - كبير', sku: null, barcode: '', price: 50, oldPrice: null, cost: 25, stock: 10, available: true, sortOrder: 0, ...overrides }
}

async function resetFixtures() {
  await pool.query('DELETE FROM stock_movements')
  await pool.query('DELETE FROM order_items WHERE order_id = $1', [ORDER_ID])
  await pool.query('DELETE FROM orders WHERE id = $1', [ORDER_ID])
  await pool.query('DELETE FROM inventory_batches WHERE product_id = $1', [PRODUCT_ID])
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

async function insertBatch(variantId: string | null, quantityRemaining: number, expiryDate: string | null, createdAt: string) {
  const id = crypto.randomUUID()
  await pool.query(
    `INSERT INTO inventory_batches (id, product_id, variant_id, quantity_received, quantity_remaining, unit_cost, expiry_date, created_at)
     VALUES ($1, $2, $3, $4, $4, 5, $5, $6)`,
    [id, PRODUCT_ID, variantId, quantityRemaining, expiryDate, createdAt]
  )
  return id
}

async function insertTestOrder() {
  await pool.query(
    `INSERT INTO orders (id, order_number, created_at, delivery_slot, payment_method, customer_full_name, customer_mobile, customer_governorate, customer_address, subtotal, delivery_fee, total, status, discount_amount)
     VALUES ($1, $1, now(), 'now', 'COD', 'عميل', '01012345678', 'القاهرة', 'عنوان', 100, 0, 100, 'placed', 0)
     ON CONFLICT (id) DO NOTHING`,
    [ORDER_ID]
  )
}

describe('productVariantService — variant batches/FEFO', () => {
  it('lockVariantForOrder falls back to raw stock when the variant has no batches', async () => {
    const variant = await createVariant(PRODUCT_ID, baseInput({ stock: 10 }))
    const locked = await withTransaction(client => lockVariantForOrder(client, variant.id))
    expect(locked?.stock).toBe(10)
  })

  it('lockVariantForOrder uses sellable batch stock (excluding expired) instead of raw stock once the variant has batches', async () => {
    const variant = await createVariant(PRODUCT_ID, baseInput({ stock: 999 }))
    await insertBatch(variant.id, 4, '2999-01-01', new Date().toISOString())
    await insertBatch(variant.id, 3, '2000-01-01', new Date().toISOString()) // expired — excluded
    const locked = await withTransaction(client => lockVariantForOrder(client, variant.id))
    expect(locked?.stock).toBe(4)
  })

  it('deductVariantStock consumes variant batches in FEFO order and records batch_consumptions', async () => {
    await insertTestOrder()
    const variant = await createVariant(PRODUCT_ID, baseInput({ stock: 10 }))
    const soonBatch = await insertBatch(variant.id, 3, '2999-01-01', new Date().toISOString())
    const laterBatch = await insertBatch(variant.id, 10, '2999-06-01', new Date().toISOString())
    const orderId = ORDER_ID

    await withTransaction(async client => {
      const locked = await lockVariantForOrder(client, variant.id)
      await deductVariantStock(client, locked!, 5, orderId)
    })

    const { rows } = await pool.query<{ id: string; quantityRemaining: number }>(
      'SELECT id, quantity_remaining as "quantityRemaining" FROM inventory_batches WHERE id = ANY($1::text[])',
      [[soonBatch, laterBatch]]
    )
    const soon = rows.find(r => r.id === soonBatch)!
    const later = rows.find(r => r.id === laterBatch)!
    expect(soon.quantityRemaining).toBe(0)
    expect(later.quantityRemaining).toBe(8)
  })

  it('deductVariantStock does not touch base-product batches (variant_id IS NULL) for the same product', async () => {
    await insertTestOrder()
    const variant = await createVariant(PRODUCT_ID, baseInput({ stock: 10 }))
    const baseBatch = await insertBatch(null, 20, '2999-01-01', new Date().toISOString())
    const variantBatch = await insertBatch(variant.id, 5, '2999-01-01', new Date().toISOString())

    await withTransaction(async client => {
      const locked = await lockVariantForOrder(client, variant.id)
      await deductVariantStock(client, locked!, 3, ORDER_ID)
    })

    const { rows } = await pool.query<{ id: string; quantityRemaining: number }>(
      'SELECT id, quantity_remaining as "quantityRemaining" FROM inventory_batches WHERE id = ANY($1::text[])',
      [[baseBatch, variantBatch]]
    )
    expect(rows.find(r => r.id === baseBatch)!.quantityRemaining).toBe(20)
    expect(rows.find(r => r.id === variantBatch)!.quantityRemaining).toBe(2)
  })

  it('restoreVariantStock restores exactly the batches consumed by the original sale', async () => {
    await insertTestOrder()
    const variant = await createVariant(PRODUCT_ID, baseInput({ stock: 10 }))
    const batchId = await insertBatch(variant.id, 5, '2999-01-01', new Date().toISOString())
    const orderId = ORDER_ID

    await withTransaction(async client => {
      const locked = await lockVariantForOrder(client, variant.id)
      await deductVariantStock(client, locked!, 4, orderId)
    })

    let { rows } = await pool.query<{ quantityRemaining: number }>(
      'SELECT quantity_remaining as "quantityRemaining" FROM inventory_batches WHERE id = $1', [batchId]
    )
    expect(rows[0].quantityRemaining).toBe(1)

    await withTransaction(client => restoreVariantStock(client, variant.id, 4, orderId, 'cancel_restore'))

    ;({ rows } = await pool.query<{ quantityRemaining: number }>(
      'SELECT quantity_remaining as "quantityRemaining" FROM inventory_batches WHERE id = $1', [batchId]
    ))
    expect(rows[0].quantityRemaining).toBe(5)
  })
})
