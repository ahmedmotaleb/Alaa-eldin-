import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import crypto from 'node:crypto'
import { pool } from '../db.js'
import {
  createSupplierReturn, getSupplierReturnById, updateSupplierReturnStatus, canTransitionSupplierReturnStatus
} from './supplierReturnService.js'

const CATEGORY_ID = 'test-cat-sr'
const PRODUCT_ID = 'test-prod-sr'
const SUPPLIER_ID = 'test-supplier-sr'
const USER_ID = 'test-user-sr'

async function resetFixtures() {
  await pool.query('DELETE FROM supplier_return_items')
  await pool.query('DELETE FROM supplier_returns')
  await pool.query('DELETE FROM batch_consumptions')
  await pool.query('DELETE FROM stock_movements WHERE product_id = $1', [PRODUCT_ID])
  await pool.query('DELETE FROM suppliers WHERE id = $1', [SUPPLIER_ID])
  await pool.query('DELETE FROM products WHERE id = $1', [PRODUCT_ID])
  await pool.query('DELETE FROM categories WHERE id = $1', [CATEGORY_ID])
  await pool.query('DELETE FROM users WHERE id = $1', [USER_ID])

  await pool.query(
    `INSERT INTO categories (id, name, emoji, tint, sort_order) VALUES ($1, 'فئة اختبار', '🧪', '#fff', 1)`,
    [CATEGORY_ID]
  )
  await pool.query(
    `INSERT INTO products (id, slug, category_id, name, description, price, cost, unit, emoji, available, stock, created_at)
     VALUES ($1, 'sr-prod', $2, 'منتج مرتجع مورد', 'وصف', 10, 5, 'وحدة', '🧪', 1, 20, now())`,
    [PRODUCT_ID, CATEGORY_ID]
  )
  await pool.query(`INSERT INTO suppliers (id, name) VALUES ($1, 'مورد اختبار المرتجعات')`, [SUPPLIER_ID])
  await pool.query(
    `INSERT INTO users (id, email, password_hash, full_name, created_at, is_admin, role)
     VALUES ($1, 'sr-tester@test.local', 'x', 'مختبر', now(), 1, 'admin')`,
    [USER_ID]
  )
}

describe('supplierReturnService', () => {
  beforeEach(resetFixtures)
  afterAll(async () => {
    await pool.query('DELETE FROM supplier_return_items')
    await pool.query('DELETE FROM supplier_returns')
    await pool.query('DELETE FROM batch_consumptions')
    await pool.query('DELETE FROM stock_movements WHERE product_id = $1', [PRODUCT_ID])
    await pool.query('DELETE FROM suppliers WHERE id = $1', [SUPPLIER_ID])
    await pool.query('DELETE FROM products WHERE id = $1', [PRODUCT_ID])
    await pool.query('DELETE FROM categories WHERE id = $1', [CATEGORY_ID])
    await pool.query('DELETE FROM users WHERE id = $1', [USER_ID])
  })

  it('creates a draft return without touching stock', async () => {
    const supplierReturn = await createSupplierReturn(
      { supplierId: SUPPLIER_ID, items: [{ productId: PRODUCT_ID, quantity: 5 }] },
      USER_ID
    )
    expect(supplierReturn.returnNumber).toMatch(/^SR-\d+$/)
    expect(supplierReturn.status).toBe('draft')

    const { rows } = await pool.query('SELECT stock FROM products WHERE id = $1', [PRODUCT_ID])
    expect(rows[0].stock).toBe(20)
  })

  it('decreases stock only when the return is approved', async () => {
    const supplierReturn = await createSupplierReturn(
      { supplierId: SUPPLIER_ID, items: [{ productId: PRODUCT_ID, quantity: 5 }] },
      USER_ID
    )
    const approved = await updateSupplierReturnStatus(supplierReturn.id, 'approved', USER_ID)
    expect('error' in approved).toBe(false)

    const { rows } = await pool.query('SELECT stock FROM products WHERE id = $1', [PRODUCT_ID])
    expect(rows[0].stock).toBe(15)

    const { rows: movements } = await pool.query(`SELECT * FROM stock_movements WHERE product_id = $1`, [PRODUCT_ID])
    expect(movements).toHaveLength(1)
    expect(movements[0].type).toBe('supplier_return')
  })

  it('restores stock when an approved return is cancelled', async () => {
    const supplierReturn = await createSupplierReturn(
      { supplierId: SUPPLIER_ID, items: [{ productId: PRODUCT_ID, quantity: 5 }] },
      USER_ID
    )
    await updateSupplierReturnStatus(supplierReturn.id, 'approved', USER_ID)
    const cancelled = await updateSupplierReturnStatus(supplierReturn.id, 'cancelled', USER_ID)
    expect('error' in cancelled).toBe(false)

    const { rows } = await pool.query('SELECT stock FROM products WHERE id = $1', [PRODUCT_ID])
    expect(rows[0].stock).toBe(20)
  })

  it('rejects an invalid transition (draft -> sent directly)', async () => {
    const supplierReturn = await createSupplierReturn(
      { supplierId: SUPPLIER_ID, items: [{ productId: PRODUCT_ID, quantity: 5 }] },
      USER_ID
    )
    const result = await updateSupplierReturnStatus(supplierReturn.id, 'sent', USER_ID)
    expect(result).toEqual({ error: 'invalid_transition' })
  })

  it('returns not_found when changing status of a supplier return id that does not exist', async () => {
    const result = await updateSupplierReturnStatus('no-such-return', 'approved', USER_ID)
    expect(result).toEqual({ error: 'not_found' })
  })

  it('does not allow cancelling after sent', async () => {
    const supplierReturn = await createSupplierReturn(
      { supplierId: SUPPLIER_ID, items: [{ productId: PRODUCT_ID, quantity: 5 }] },
      USER_ID
    )
    await updateSupplierReturnStatus(supplierReturn.id, 'approved', USER_ID)
    await updateSupplierReturnStatus(supplierReturn.id, 'sent', USER_ID)
    const result = await updateSupplierReturnStatus(supplierReturn.id, 'cancelled', USER_ID)
    expect(result).toEqual({ error: 'invalid_transition' })
  })

  it('progresses through the full sent -> completed workflow', async () => {
    const supplierReturn = await createSupplierReturn(
      { supplierId: SUPPLIER_ID, items: [{ productId: PRODUCT_ID, quantity: 3 }] },
      USER_ID
    )
    await updateSupplierReturnStatus(supplierReturn.id, 'approved', USER_ID)
    await updateSupplierReturnStatus(supplierReturn.id, 'sent', USER_ID)
    const completed = await updateSupplierReturnStatus(supplierReturn.id, 'completed', USER_ID)
    expect('error' in completed).toBe(false)
    if (!('error' in completed)) expect(completed.status).toBe('completed')
  })

  it('fetches a return with its items', async () => {
    const supplierReturn = await createSupplierReturn(
      { supplierId: SUPPLIER_ID, items: [{ productId: PRODUCT_ID, quantity: 2 }] },
      USER_ID
    )
    const result = await getSupplierReturnById(supplierReturn.id)
    expect(result?.items).toHaveLength(1)
    expect(result?.items[0].productName).toBe('منتج مرتجع مورد')
  })

  it('canTransitionSupplierReturnStatus matches service enforcement', () => {
    expect(canTransitionSupplierReturnStatus('draft', 'approved')).toBe(true)
    expect(canTransitionSupplierReturnStatus('draft', 'sent')).toBe(false)
    expect(canTransitionSupplierReturnStatus('completed', 'cancelled')).toBe(false)
  })
})

const VARIANT_PRODUCT_ID = 'test-prod-sr-variant'
let variantId = ''
let otherProductId = 'test-prod-sr-other'

async function resetVariantFixtures() {
  await pool.query('DELETE FROM supplier_return_items')
  await pool.query('DELETE FROM supplier_returns')
  await pool.query('DELETE FROM batch_consumptions')
  await pool.query('DELETE FROM stock_movements')
  await pool.query('DELETE FROM suppliers WHERE id = $1', [SUPPLIER_ID])
  await pool.query('DELETE FROM product_variants WHERE product_id = $1', [VARIANT_PRODUCT_ID])
  await pool.query('DELETE FROM products WHERE id = ANY($1::text[])', [[VARIANT_PRODUCT_ID, otherProductId]])
  await pool.query('DELETE FROM categories WHERE id = $1', [CATEGORY_ID])
  await pool.query('DELETE FROM users WHERE id = $1', [USER_ID])

  await pool.query(
    `INSERT INTO categories (id, name, emoji, tint, sort_order) VALUES ($1, 'فئة اختبار', '🧪', '#fff', 1)`,
    [CATEGORY_ID]
  )
  await pool.query(
    `INSERT INTO products (id, slug, category_id, name, description, price, cost, unit, emoji, available, stock, created_at)
     VALUES ($1, 'sr-variant-prod', $2, 'منتج له متغيرات', 'وصف', 10, 5, 'وحدة', '🧪', 1, 0, now())`,
    [VARIANT_PRODUCT_ID, CATEGORY_ID]
  )
  await pool.query(
    `INSERT INTO products (id, slug, category_id, name, description, price, cost, unit, emoji, available, stock, created_at)
     VALUES ($1, 'sr-other-prod', $2, 'منتج آخر', 'وصف', 10, 5, 'وحدة', '🧪', 1, 0, now())`,
    [otherProductId, CATEGORY_ID]
  )
  variantId = `var-${crypto.randomUUID()}`
  await pool.query(
    `INSERT INTO product_variants (id, product_id, name, sku, barcode, price, old_price, cost, stock, available, sort_order, created_at)
     VALUES ($1, $2, 'أزرق', null, '', 10, null, 5, 8, 1, 0, now())`,
    [variantId, VARIANT_PRODUCT_ID]
  )
  await pool.query(`INSERT INTO suppliers (id, name) VALUES ($1, 'مورد اختبار المرتجعات')`, [SUPPLIER_ID])
  await pool.query(
    `INSERT INTO users (id, email, password_hash, full_name, created_at, is_admin, role)
     VALUES ($1, 'sr-var-tester@test.local', 'x', 'مختبر', now(), 1, 'admin')`,
    [USER_ID]
  )
}

describe('supplierReturnService — variant returns', () => {
  beforeEach(resetVariantFixtures)
  afterAll(async () => {
    await pool.query('DELETE FROM supplier_return_items')
    await pool.query('DELETE FROM supplier_returns')
    await pool.query('DELETE FROM batch_consumptions')
    await pool.query('DELETE FROM stock_movements')
    await pool.query('DELETE FROM suppliers WHERE id = $1', [SUPPLIER_ID])
    await pool.query('DELETE FROM product_variants WHERE product_id = $1', [VARIANT_PRODUCT_ID])
    await pool.query('DELETE FROM products WHERE id = ANY($1::text[])', [[VARIANT_PRODUCT_ID, otherProductId]])
    await pool.query('DELETE FROM categories WHERE id = $1', [CATEGORY_ID])
    await pool.query('DELETE FROM users WHERE id = $1', [USER_ID])
    await pool.end()
  })

  it('rejects a variant claimed against the wrong product (IDOR guard)', async () => {
    const result = await createSupplierReturn(
      { supplierId: SUPPLIER_ID, items: [{ productId: otherProductId, variantId, quantity: 1 }] },
      USER_ID
    )
    expect(result).toEqual({ error: 'variant_mismatch' })
  })

  it('writes off variant stock (not the base product) when a variant return is approved', async () => {
    const supplierReturn = await createSupplierReturn(
      { supplierId: SUPPLIER_ID, items: [{ productId: VARIANT_PRODUCT_ID, variantId, quantity: 3 }] },
      USER_ID
    )
    expect('error' in supplierReturn).toBe(false)
    if ('error' in supplierReturn) return

    const approved = await updateSupplierReturnStatus(supplierReturn.id, 'approved', USER_ID)
    expect('error' in approved).toBe(false)

    const { rows: variantRows } = await pool.query('SELECT stock FROM product_variants WHERE id = $1', [variantId])
    expect(variantRows[0].stock).toBe(5) // 8 - 3

    const { rows: productRows } = await pool.query('SELECT stock FROM products WHERE id = $1', [VARIANT_PRODUCT_ID])
    expect(productRows[0].stock).toBe(0) // base product untouched
  })

  it('restores variant stock when an approved variant return is cancelled', async () => {
    const supplierReturn = await createSupplierReturn(
      { supplierId: SUPPLIER_ID, items: [{ productId: VARIANT_PRODUCT_ID, variantId, quantity: 3 }] },
      USER_ID
    )
    expect('error' in supplierReturn).toBe(false)
    if ('error' in supplierReturn) return

    await updateSupplierReturnStatus(supplierReturn.id, 'approved', USER_ID)
    const cancelled = await updateSupplierReturnStatus(supplierReturn.id, 'cancelled', USER_ID)
    expect('error' in cancelled).toBe(false)

    const { rows: variantRows } = await pool.query('SELECT stock FROM product_variants WHERE id = $1', [variantId])
    expect(variantRows[0].stock).toBe(8)
  })

  it('fetches a variant return with its variant name attached to the item', async () => {
    const supplierReturn = await createSupplierReturn(
      { supplierId: SUPPLIER_ID, items: [{ productId: VARIANT_PRODUCT_ID, variantId, quantity: 1 }] },
      USER_ID
    )
    expect('error' in supplierReturn).toBe(false)
    if ('error' in supplierReturn) return
    const result = await getSupplierReturnById(supplierReturn.id)
    expect(result?.items[0].variantId).toBe(variantId)
    expect(result?.items[0].variantName).toBe('أزرق')
  })
})
