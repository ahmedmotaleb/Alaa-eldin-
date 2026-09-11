import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { pool } from '../db.js'
import {
  listSuppliers, getSupplierById, createSupplier, updateSupplier, setSupplierActive,
  listSupplierProductsForSupplier, listSuppliersForProduct, upsertSupplierProduct, removeSupplierProduct
} from './supplierService.js'

const CATEGORY_ID = 'test-cat-supplier'
const PRODUCT_ID = 'test-prod-supplier'
const PRODUCT_ID_2 = 'test-prod-supplier-2'

async function resetFixtures() {
  await pool.query('DELETE FROM supplier_products')
  await pool.query('DELETE FROM suppliers')
  await pool.query('DELETE FROM products WHERE id IN ($1, $2)', [PRODUCT_ID, PRODUCT_ID_2])
  await pool.query('DELETE FROM categories WHERE id = $1', [CATEGORY_ID])
  await pool.query(
    `INSERT INTO categories (id, name, emoji, tint, sort_order) VALUES ($1, 'فئة اختبار', '🧪', '#fff', 1)`,
    [CATEGORY_ID]
  )
  await pool.query(
    `INSERT INTO products (id, slug, category_id, name, description, price, cost, unit, emoji, available, stock, created_at)
     VALUES ($1, 'supplier-prod-1', $2, 'منتج 1', 'وصف', 10, 5, 'وحدة', '🧪', 1, 50, now())`,
    [PRODUCT_ID, CATEGORY_ID]
  )
  await pool.query(
    `INSERT INTO products (id, slug, category_id, name, description, price, cost, unit, emoji, available, stock, created_at)
     VALUES ($1, 'supplier-prod-2', $2, 'منتج 2', 'وصف', 20, 8, 'وحدة', '🧪', 1, 50, now())`,
    [PRODUCT_ID_2, CATEGORY_ID]
  )
}

describe('supplierService', () => {
  beforeEach(resetFixtures)
  afterAll(async () => {
    await pool.query('DELETE FROM supplier_products')
    await pool.query('DELETE FROM suppliers')
    await pool.query('DELETE FROM products WHERE id IN ($1, $2)', [PRODUCT_ID, PRODUCT_ID_2])
    await pool.query('DELETE FROM categories WHERE id = $1', [CATEGORY_ID])
  })

  it('creates a supplier requiring only a name', async () => {
    const supplier = await createSupplier({ name: 'مورد الخضار' })
    expect(supplier.name).toBe('مورد الخضار')
    expect(supplier.mobile).toBe('')
    expect(supplier.active).toBe(true)
  })

  it('lists suppliers filtered by name/mobile search', async () => {
    await createSupplier({ name: 'مورد الألبان', mobile: '01012345678' })
    await createSupplier({ name: 'مورد اللحوم', mobile: '01099998888' })

    const byName = await listSuppliers({ search: 'الألبان' })
    expect(byName).toHaveLength(1)
    expect(byName[0].name).toBe('مورد الألبان')

    const byMobile = await listSuppliers({ search: '9999' })
    expect(byMobile).toHaveLength(1)
    expect(byMobile[0].name).toBe('مورد اللحوم')
  })

  it('updates a supplier and preserves unspecified-as-empty fields', async () => {
    const created = await createSupplier({ name: 'مورد قديم' })
    const updated = await updateSupplier(created.id, { name: 'مورد جديد', email: 'x@y.com' })
    expect(updated?.name).toBe('مورد جديد')
    expect(updated?.email).toBe('x@y.com')
  })

  it('activates and deactivates a supplier', async () => {
    const created = await createSupplier({ name: 'مورد للتعطيل' })
    const deactivated = await setSupplierActive(created.id, false)
    expect(deactivated?.active).toBe(false)

    const stillListed = await listSuppliers({})
    expect(stillListed.find(s => s.id === created.id)).toBeTruthy()

    const activeOnly = await listSuppliers({ activeOnly: true })
    expect(activeOnly.find(s => s.id === created.id)).toBeFalsy()
  })

  it('returns null when updating or deactivating a non-existent supplier', async () => {
    expect(await updateSupplier('missing-id', { name: 'x' })).toBeNull()
    expect(await setSupplierActive('missing-id', true)).toBeNull()
    expect(await getSupplierById('missing-id')).toBeNull()
  })

  it('links a product to a supplier and lists it both ways', async () => {
    const supplier = await createSupplier({ name: 'مورد الربط' })
    await upsertSupplierProduct(supplier.id, PRODUCT_ID, { supplierSku: 'SUP-1', lastCost: 4.5 })

    const forSupplier = await listSupplierProductsForSupplier(supplier.id)
    expect(forSupplier).toHaveLength(1)
    expect(forSupplier[0].supplierSku).toBe('SUP-1')
    expect(forSupplier[0].lastCost).toBe(4.5)

    const forProduct = await listSuppliersForProduct(PRODUCT_ID)
    expect(forProduct).toHaveLength(1)
    expect(forProduct[0].supplierId).toBe(supplier.id)
  })

  it('enforces exactly one preferred supplier per product', async () => {
    const supplierA = await createSupplier({ name: 'مورد أ' })
    const supplierB = await createSupplier({ name: 'مورد ب' })

    await upsertSupplierProduct(supplierA.id, PRODUCT_ID, { preferred: true })
    await upsertSupplierProduct(supplierB.id, PRODUCT_ID, { preferred: true })

    const linked = await listSuppliersForProduct(PRODUCT_ID)
    const preferredOnes = linked.filter(l => l.preferred)
    expect(preferredOnes).toHaveLength(1)
    expect(preferredOnes[0].supplierId).toBe(supplierB.id)
  })

  it('upserts on conflict instead of duplicating the (supplier, product) link', async () => {
    const supplier = await createSupplier({ name: 'مورد تحديث' })
    await upsertSupplierProduct(supplier.id, PRODUCT_ID, { supplierSku: 'OLD' })
    await upsertSupplierProduct(supplier.id, PRODUCT_ID, { supplierSku: 'NEW' })

    const links = await listSupplierProductsForSupplier(supplier.id)
    expect(links).toHaveLength(1)
    expect(links[0].supplierSku).toBe('NEW')
  })

  it('removes a supplier-product link', async () => {
    const supplier = await createSupplier({ name: 'مورد للحذف' })
    await upsertSupplierProduct(supplier.id, PRODUCT_ID, {})
    await removeSupplierProduct(supplier.id, PRODUCT_ID)

    const links = await listSupplierProductsForSupplier(supplier.id)
    expect(links).toHaveLength(0)
  })

  it('cascades supplier_products deletion when a supplier is deleted', async () => {
    const supplier = await createSupplier({ name: 'مورد للحذف الكامل' })
    await upsertSupplierProduct(supplier.id, PRODUCT_ID, {})
    await pool.query('DELETE FROM suppliers WHERE id = $1', [supplier.id])

    const { rows } = await pool.query('SELECT * FROM supplier_products WHERE supplier_id = $1', [supplier.id])
    expect(rows).toHaveLength(0)
  })
})
