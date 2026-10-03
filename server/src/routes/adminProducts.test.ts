// اختبارات تكامل حقيقية لحذف/استعادة المنتجات (soft delete) — بتغطي المسار الفردي
// (DELETE /:id و POST /:id/restore)، مسار التحديد الجماعي (/bulk مع action=delete/restore)،
// فصل صلاحية products.delete عن products.edit، واستبعاد المنتجات المحذوفة من القايمة
// والتصدير الافتراضيين.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { app } from '../app.js'
import { pool } from '../db.js'

const PREFIX = 'aprodsdel-'
const STRONG_PASSWORD = 'CorrectHorse9'
const CATEGORY_ID = `${PREFIX}cat`
const EDIT_ONLY_ROLE_ID = `${PREFIX}role-edit-only`

function uniqueEmail(label: string): string {
  return `${PREFIX}${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`
}

async function fullAdminAgent(): Promise<ReturnType<typeof request.agent>> {
  const agent = request.agent(app)
  const email = uniqueEmail('fulladmin')
  const res = await agent.post('/api/auth/register').send({ email, password: STRONG_PASSWORD, fullName: 'مسؤول اختبار الحذف' })
  expect(res.status).toBe(201)
  await pool.query('UPDATE users SET is_admin = 1, role = $2, role_id = NULL WHERE id = $1', [res.body.user.id, 'admin'])
  return agent
}

// مستخدم عنده products.edit بس (مش products.delete) — بيتأكد إن الفصل بين الاثنين فعلي
// مش بس نظري.
async function editOnlyAgent(): Promise<ReturnType<typeof request.agent>> {
  const agent = request.agent(app)
  const email = uniqueEmail('editonly')
  const res = await agent.post('/api/auth/register').send({ email, password: STRONG_PASSWORD, fullName: 'موظف تعديل بس' })
  expect(res.status).toBe(201)
  await pool.query('UPDATE users SET is_admin = 1, role_id = $2 WHERE id = $1', [res.body.user.id, EDIT_ONLY_ROLE_ID])
  return agent
}

async function createTestProduct(idSuffix: string): Promise<string> {
  const id = `${PREFIX}p-${idSuffix}`
  await pool.query(
    `INSERT INTO products (id, slug, category_id, name, description, price, cost, unit, emoji, available, stock, brand, sku, barcode, created_at)
     VALUES ($1, $1, $2, 'منتج اختبار حذف', 'وصف', 10, 5, 'قطعة', '🧪', 1, 20, '', $3, '', now())`,
    [id, CATEGORY_ID, `SKU-${id}`]
  )
  return id
}

async function cleanupFixtures() {
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${PREFIX}%`])
  await pool.query('DELETE FROM audit_logs WHERE entity_id LIKE $1 OR entity_id = $2', [`${PREFIX}%`, 'bulk'])
  await pool.query('DELETE FROM products WHERE category_id = $1', [CATEGORY_ID])
  await pool.query('DELETE FROM role_permissions WHERE role_id = $1', [EDIT_ONLY_ROLE_ID])
  await pool.query('DELETE FROM roles WHERE id = $1', [EDIT_ONLY_ROLE_ID])
  await pool.query('DELETE FROM categories WHERE id = $1', [CATEGORY_ID])
}

async function setupFixtures() {
  await cleanupFixtures()
  await pool.query(
    `INSERT INTO categories (id, name, emoji, tint, sort_order) VALUES ($1, 'فئة اختبار الحذف', '🧪', '#fff', 1)`,
    [CATEGORY_ID]
  )
  await pool.query(`INSERT INTO roles (id, name, is_system) VALUES ($1, $2, 0)`, [EDIT_ONLY_ROLE_ID, `${PREFIX}دور تعديل بس`])
  await pool.query(`INSERT INTO role_permissions (role_id, permission) VALUES ($1, 'products.view'), ($1, 'products.edit')`, [EDIT_ONLY_ROLE_ID])
}

afterAll(async () => {
  await cleanupFixtures()
  await pool.end()
})

describe('product soft delete (/api/admin/products)', () => {
  beforeAll(setupFixtures)

  it('soft-deletes a single product: hides it from the default list, keeps the row, sets available=0', async () => {
    const agent = await fullAdminAgent()
    const productId = await createTestProduct('single-1')

    const del = await agent.delete(`/api/admin/products/${productId}`)
    expect(del.status).toBe(200)
    expect(del.body.product.deleted).toBe(true)
    expect(del.body.product.available).toBe(false)

    const { rows } = await pool.query('SELECT deleted_at, available FROM products WHERE id = $1', [productId])
    expect(rows[0].deleted_at).not.toBeNull()
    expect(rows[0].available).toBe(0)

    const list = await agent.get('/api/admin/products')
    expect(list.status).toBe(200)
    expect(list.body.products.some((p: { id: string }) => p.id === productId)).toBe(false)
  })

  it('is idempotent: deleting an already-deleted product returns 404, not an error', async () => {
    const agent = await fullAdminAgent()
    const productId = await createTestProduct('idempotent-del')
    expect((await agent.delete(`/api/admin/products/${productId}`)).status).toBe(200)

    const second = await agent.delete(`/api/admin/products/${productId}`)
    expect(second.status).toBe(404)
    expect(second.body.error).toBe('product_not_found')
  })

  it('returns 404 for deleting a product id that never existed', async () => {
    const agent = await fullAdminAgent()
    const res = await agent.delete('/api/admin/products/does-not-exist')
    expect(res.status).toBe(404)
  })

  it('restores a soft-deleted product without automatically re-publishing it (available stays 0)', async () => {
    const agent = await fullAdminAgent()
    const productId = await createTestProduct('restore-1')
    await agent.delete(`/api/admin/products/${productId}`)

    const restore = await agent.post(`/api/admin/products/${productId}/restore`)
    expect(restore.status).toBe(200)
    expect(restore.body.product.deleted).toBe(false)
    expect(restore.body.product.available).toBe(false)

    const { rows } = await pool.query('SELECT deleted_at, available FROM products WHERE id = $1', [productId])
    expect(rows[0].deleted_at).toBeNull()
    expect(rows[0].available).toBe(0)

    const list = await agent.get('/api/admin/products')
    expect(list.body.products.some((p: { id: string }) => p.id === productId)).toBe(true)
  })

  it('is idempotent: restoring a product that is not deleted returns 404', async () => {
    const agent = await fullAdminAgent()
    const productId = await createTestProduct('idempotent-restore')
    const res = await agent.post(`/api/admin/products/${productId}/restore`)
    expect(res.status).toBe(404)
  })

  it('status=deleted shows only soft-deleted products, status=all shows both', async () => {
    const agent = await fullAdminAgent()
    const active = await createTestProduct('status-active')
    const deleted = await createTestProduct('status-deleted')
    await agent.delete(`/api/admin/products/${deleted}`)

    const deletedView = await agent.get('/api/admin/products?status=deleted')
    const deletedIds = deletedView.body.products.map((p: { id: string }) => p.id)
    expect(deletedIds).toContain(deleted)
    expect(deletedIds).not.toContain(active)

    const allView = await agent.get('/api/admin/products?status=all')
    const allIds = allView.body.products.map((p: { id: string }) => p.id)
    expect(allIds).toContain(deleted)
    expect(allIds).toContain(active)
  })

  it('excludes soft-deleted products from the CSV export', async () => {
    const agent = await fullAdminAgent()
    const kept = await createTestProduct('export-kept')
    const deleted = await createTestProduct('export-deleted')
    await agent.delete(`/api/admin/products/${deleted}`)

    const res = await agent.get('/api/admin/products/export')
    expect(res.status).toBe(200)
    expect(res.text).toContain(kept)
    expect(res.text).not.toContain(deleted)
  })

  it('bulk-deletes multiple selected products via /bulk with action=delete', async () => {
    const agent = await fullAdminAgent()
    const a = await createTestProduct('bulk-del-a')
    const b = await createTestProduct('bulk-del-b')

    const res = await agent.patch('/api/admin/products/bulk').send({ productIds: [a, b], action: 'delete' })
    expect(res.status).toBe(200)
    expect(res.body.updated).toBe(2)

    const { rows } = await pool.query('SELECT id FROM products WHERE id IN ($1, $2) AND deleted_at IS NOT NULL', [a, b])
    expect(rows).toHaveLength(2)
  })

  it('bulk-restores multiple selected products via /bulk with action=restore', async () => {
    const agent = await fullAdminAgent()
    const a = await createTestProduct('bulk-res-a')
    const b = await createTestProduct('bulk-res-b')
    await agent.patch('/api/admin/products/bulk').send({ productIds: [a, b], action: 'delete' })

    const res = await agent.patch('/api/admin/products/bulk').send({ productIds: [a, b], action: 'restore' })
    expect(res.status).toBe(200)
    expect(res.body.updated).toBe(2)

    const { rows } = await pool.query('SELECT id FROM products WHERE id IN ($1, $2) AND deleted_at IS NULL', [a, b])
    expect(rows).toHaveLength(2)
  })

  it('rejects single delete for a user who only has products.edit, not products.delete', async () => {
    const agent = await editOnlyAgent()
    const productId = await createTestProduct('perm-single')

    const res = await agent.delete(`/api/admin/products/${productId}`)
    expect(res.status).toBe(403)

    const { rows } = await pool.query('SELECT deleted_at FROM products WHERE id = $1', [productId])
    expect(rows[0].deleted_at).toBeNull()
  })

  it('rejects bulk delete for a user who only has products.edit, not products.delete', async () => {
    const agent = await editOnlyAgent()
    const productId = await createTestProduct('perm-bulk')

    const res = await agent.patch('/api/admin/products/bulk').send({ productIds: [productId], action: 'delete' })
    expect(res.status).toBe(403)

    const { rows } = await pool.query('SELECT deleted_at FROM products WHERE id = $1', [productId])
    expect(rows[0].deleted_at).toBeNull()
  })

  it('still allows a products.edit-only user to use non-destructive bulk actions', async () => {
    const agent = await editOnlyAgent()
    const productId = await createTestProduct('perm-nondestructive')

    const res = await agent.patch('/api/admin/products/bulk').send({ productIds: [productId], action: 'set_unavailable' })
    expect(res.status).toBe(200)
    expect(res.body.updated).toBe(1)
  })
})
