import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { pool } from '../db.js'
import {
  createPurchaseOrder, listPurchaseOrders, getPurchaseOrderById, updateDraftPurchaseOrder, updatePurchaseOrderStatus,
  canTransitionPurchaseOrderStatus
} from './purchaseOrderService.js'

const CATEGORY_ID = 'test-cat-po'
const PRODUCT_ID = 'test-prod-po-1'
const PRODUCT_ID_2 = 'test-prod-po-2'
const SUPPLIER_ID = 'test-supplier-po'
const USER_ID = 'test-user-po'

async function resetFixtures() {
  await pool.query('DELETE FROM purchase_order_items')
  await pool.query('DELETE FROM purchase_orders')
  await pool.query('DELETE FROM suppliers WHERE id = $1', [SUPPLIER_ID])
  await pool.query('DELETE FROM products WHERE id IN ($1, $2)', [PRODUCT_ID, PRODUCT_ID_2])
  await pool.query('DELETE FROM categories WHERE id = $1', [CATEGORY_ID])
  await pool.query('DELETE FROM users WHERE id = $1', [USER_ID])

  await pool.query(
    `INSERT INTO categories (id, name, emoji, tint, sort_order) VALUES ($1, 'فئة اختبار', '🧪', '#fff', 1)`,
    [CATEGORY_ID]
  )
  await pool.query(
    `INSERT INTO products (id, slug, category_id, name, description, price, cost, unit, emoji, available, stock, created_at)
     VALUES ($1, 'po-prod-1', $2, 'منتج 1', 'وصف', 10, 5, 'وحدة', '🧪', 1, 50, now())`,
    [PRODUCT_ID, CATEGORY_ID]
  )
  await pool.query(
    `INSERT INTO products (id, slug, category_id, name, description, price, cost, unit, emoji, available, stock, created_at)
     VALUES ($1, 'po-prod-2', $2, 'منتج 2', 'وصف', 20, 8, 'وحدة', '🧪', 1, 50, now())`,
    [PRODUCT_ID_2, CATEGORY_ID]
  )
  await pool.query(
    `INSERT INTO suppliers (id, name) VALUES ($1, 'مورد اختبار أوامر الشراء')`,
    [SUPPLIER_ID]
  )
  await pool.query(
    `INSERT INTO users (id, email, password_hash, full_name, created_at, is_admin, role)
     VALUES ($1, 'po-tester@test.local', 'x', 'مختبر', now(), 1, 'admin')`,
    [USER_ID]
  )
}

describe('purchaseOrderService', () => {
  beforeEach(resetFixtures)
  afterAll(async () => {
    await pool.query('DELETE FROM purchase_order_items')
    await pool.query('DELETE FROM purchase_orders')
    await pool.query('DELETE FROM suppliers WHERE id = $1', [SUPPLIER_ID])
    await pool.query('DELETE FROM products WHERE id IN ($1, $2)', [PRODUCT_ID, PRODUCT_ID_2])
    await pool.query('DELETE FROM categories WHERE id = $1', [CATEGORY_ID])
    await pool.query('DELETE FROM users WHERE id = $1', [USER_ID])
  })

  it('creates a draft PO with a server-generated human-readable number', async () => {
    const order = await createPurchaseOrder(
      { supplierId: SUPPLIER_ID, items: [{ productId: PRODUCT_ID, orderedQty: 10, unitCost: 5 }] },
      USER_ID
    )
    expect(order.poNumber).toMatch(/^PO-\d+$/)
    expect(order.status).toBe('draft')
  })

  it('computes totals server-side, ignoring any client-sent total', async () => {
    const order = await createPurchaseOrder(
      {
        supplierId: SUPPLIER_ID,
        discount: 5,
        shippingCost: 10,
        items: [
          { productId: PRODUCT_ID, orderedQty: 10, unitCost: 5 },
          { productId: PRODUCT_ID_2, orderedQty: 2, unitCost: 8 }
        ]
      },
      USER_ID
    )
    // subtotal = 10*5 + 2*8 = 66، total = max(0, 66-5) + 10 = 71
    expect(order.subtotal).toBe(66)
    expect(order.total).toBe(71)
  })

  it('rejects a PO with no items', async () => {
    await expect(createPurchaseOrder({ supplierId: SUPPLIER_ID, items: [] }, USER_ID)).rejects.toThrow('no_items')
  })

  it('rejects a PO with a non-positive quantity', async () => {
    await expect(
      createPurchaseOrder({ supplierId: SUPPLIER_ID, items: [{ productId: PRODUCT_ID, orderedQty: 0, unitCost: 5 }] }, USER_ID)
    ).rejects.toThrow('invalid_quantity')
  })

  it('lists purchase orders filtered by status and supplier', async () => {
    const order = await createPurchaseOrder(
      { supplierId: SUPPLIER_ID, items: [{ productId: PRODUCT_ID, orderedQty: 1, unitCost: 5 }] },
      USER_ID
    )
    const bySupplier = await listPurchaseOrders({ supplierId: SUPPLIER_ID })
    expect(bySupplier.map(o => o.id)).toContain(order.id)

    const byStatus = await listPurchaseOrders({ status: 'submitted' })
    expect(byStatus.map(o => o.id)).not.toContain(order.id)
  })

  it('fetches a PO with its line items and product names', async () => {
    const order = await createPurchaseOrder(
      { supplierId: SUPPLIER_ID, items: [{ productId: PRODUCT_ID, orderedQty: 3, unitCost: 5 }] },
      USER_ID
    )
    const result = await getPurchaseOrderById(order.id)
    expect(result?.items).toHaveLength(1)
    expect(result?.items[0].productName).toBe('منتج 1')
    expect(result?.items[0].lineTotal).toBe(15)
  })

  it('allows editing a draft PO and replaces its items', async () => {
    const order = await createPurchaseOrder(
      { supplierId: SUPPLIER_ID, items: [{ productId: PRODUCT_ID, orderedQty: 1, unitCost: 5 }] },
      USER_ID
    )
    const updated = await updateDraftPurchaseOrder(order.id, {
      supplierId: SUPPLIER_ID,
      items: [{ productId: PRODUCT_ID_2, orderedQty: 4, unitCost: 8 }]
    })
    expect('error' in updated).toBe(false)
    if (!('error' in updated)) expect(updated.subtotal).toBe(32)

    const result = await getPurchaseOrderById(order.id)
    expect(result?.items).toHaveLength(1)
    expect(result?.items[0].productId).toBe(PRODUCT_ID_2)
  })

  it('rejects editing a PO that is no longer a draft', async () => {
    const order = await createPurchaseOrder(
      { supplierId: SUPPLIER_ID, items: [{ productId: PRODUCT_ID, orderedQty: 1, unitCost: 5 }] },
      USER_ID
    )
    await updatePurchaseOrderStatus(order.id, 'submitted')
    const result = await updateDraftPurchaseOrder(order.id, {
      supplierId: SUPPLIER_ID,
      items: [{ productId: PRODUCT_ID, orderedQty: 2, unitCost: 5 }]
    })
    expect(result).toEqual({ error: 'not_editable' })
  })

  it('transitions draft -> submitted -> cancelled', async () => {
    const order = await createPurchaseOrder(
      { supplierId: SUPPLIER_ID, items: [{ productId: PRODUCT_ID, orderedQty: 1, unitCost: 5 }] },
      USER_ID
    )
    const submitted = await updatePurchaseOrderStatus(order.id, 'submitted')
    expect('error' in submitted).toBe(false)
    if (!('error' in submitted)) expect(submitted.status).toBe('submitted')

    const cancelled = await updatePurchaseOrderStatus(order.id, 'cancelled')
    expect('error' in cancelled).toBe(false)
    if (!('error' in cancelled)) expect(cancelled.status).toBe('cancelled')
  })

  it('rejects an invalid transition (draft -> received directly)', async () => {
    const order = await createPurchaseOrder(
      { supplierId: SUPPLIER_ID, items: [{ productId: PRODUCT_ID, orderedQty: 1, unitCost: 5 }] },
      USER_ID
    )
    const result = await updatePurchaseOrderStatus(order.id, 'received')
    expect(result).toEqual({ error: 'invalid_transition' })
  })

  it('rejects any transition once a PO is cancelled (terminal)', async () => {
    const order = await createPurchaseOrder(
      { supplierId: SUPPLIER_ID, items: [{ productId: PRODUCT_ID, orderedQty: 1, unitCost: 5 }] },
      USER_ID
    )
    await updatePurchaseOrderStatus(order.id, 'cancelled')
    const result = await updatePurchaseOrderStatus(order.id, 'submitted')
    expect(result).toEqual({ error: 'invalid_transition' })
  })

  it('canTransitionPurchaseOrderStatus matches the service-level enforcement', () => {
    expect(canTransitionPurchaseOrderStatus('draft', 'submitted')).toBe(true)
    expect(canTransitionPurchaseOrderStatus('draft', 'received')).toBe(false)
    expect(canTransitionPurchaseOrderStatus('received', 'cancelled')).toBe(false)
    expect(canTransitionPurchaseOrderStatus('draft', 'draft')).toBe(true)
  })
})
