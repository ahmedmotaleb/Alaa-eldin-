// اختبارات HTTP حقيقية (supertest على app.ts الفعلي) لمسارات طباعة/توليد الباركود — بتغطي
// RBAC الدقيق (view/generate/print منفصلين)، بحث المنتجات/المتغيرات، عدم خلط باركود المتغيّر
// بالمنتج الأب، وتسجيل audit log عند التوليد. نفس نمط adminReferrals.test.ts بالظبط.
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { app } from '../app.js'
import { pool } from '../db.js'

const PREFIX = 'barcoderoute-'
const CATEGORY_ID = `${PREFIX}cat`
const STRONG_PASSWORD = 'CorrectHorse9'

function uniqueEmail(label: string): string {
  return `${PREFIX}${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`
}

async function registerCustomer(agent: ReturnType<typeof request.agent>, email: string): Promise<string> {
  const res = await agent.post('/api/auth/register').send({ email, password: STRONG_PASSWORD, fullName: 'مستخدم اختبار' })
  expect(res.status).toBe(201)
  return res.body.user.id as string
}

async function promoteToAdmin(userId: string, roleId: string | null) {
  await pool.query('UPDATE users SET is_admin = 1, role = $2, role_id = $3 WHERE id = $1', [userId, 'staff', roleId])
}

async function cleanup() {
  await pool.query(`DELETE FROM product_variants WHERE product_id LIKE $1`, [`${PREFIX}%`])
  await pool.query(`DELETE FROM products WHERE id LIKE $1`, [`${PREFIX}%`])
  await pool.query('DELETE FROM categories WHERE id = $1', [CATEGORY_ID])
  await pool.query('DELETE FROM audit_logs WHERE entity_id LIKE $1', [`${PREFIX}%`])
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${PREFIX}%`])
}

beforeEach(async () => {
  await cleanup()
  await pool.query(`INSERT INTO categories (id, name, emoji, tint, sort_order) VALUES ($1, 'فئة اختبار الباركود', '🧪', '#fff', 1)`, [CATEGORY_ID])
  await pool.query(
    `INSERT INTO products (id, slug, category_id, name, description, price, cost, unit, emoji, available, stock, barcode, sku, brand, created_at)
     VALUES ($1, $1, $2, 'منتج شاي أحمر', 'وصف', 15, 6, 'قطعة', '🍵', 1, 20, '4006381333931', 'BC-SKU-1', 'ماركة أ', now())`,
    [`${PREFIX}prod-with-barcode`, CATEGORY_ID]
  )
  await pool.query(
    `INSERT INTO products (id, slug, category_id, name, description, price, cost, unit, emoji, available, stock, barcode, sku, brand, created_at)
     VALUES ($1, $1, $2, 'منتج بدون باركود', 'وصف', 9, 4, 'قطعة', '📦', 1, 15, '', NULL, '', now())`,
    [`${PREFIX}prod-no-barcode`, CATEGORY_ID]
  )
  await pool.query(
    `INSERT INTO products (id, slug, category_id, name, description, price, cost, unit, emoji, available, stock, barcode, sku, brand, created_at)
     VALUES ($1, $1, $2, 'منتج بمتغيرات', 'وصف', 30, 12, 'قطعة', '👕', 1, 8, '', NULL, '', now())`,
    [`${PREFIX}prod-variants`, CATEGORY_ID]
  )
  await pool.query(
    `INSERT INTO product_variants (id, product_id, name, sku, barcode, price, cost, stock, available, sort_order, created_at)
     VALUES ($1, $2, 'أحمر - كبير', NULL, 'BC-VAR-1', 32, 13, 4, 1, 0, now())`,
    [`${PREFIX}variant-1`, `${PREFIX}prod-variants`]
  )
}, 20000)

afterAll(async () => {
  await cleanup()
  await pool.end()
})

async function adminAgent(roleId: string) {
  const agent = request.agent(app)
  const userId = await registerCustomer(agent, uniqueEmail(roleId))
  await promoteToAdmin(userId, roleId)
  return { agent, userId }
}

describe('GET /api/admin/barcode-labels/search — RBAC', () => {
  it('rejects an unauthenticated request', async () => {
    const res = await request(app).get('/api/admin/barcode-labels/search?search=شاي')
    expect(res.status).toBe(401)
  })

  it('rejects a non-admin authenticated customer', async () => {
    const agent = request.agent(app)
    await registerCustomer(agent, uniqueEmail('customer'))
    const res = await agent.get('/api/admin/barcode-labels/search?search=شاي')
    expect(res.status).toBe(403)
  })

  it('rejects a role without products.barcode.view (e.g. a rider)', async () => {
    const { agent } = await adminAgent('role-rider')
    const res = await agent.get('/api/admin/barcode-labels/search?search=شاي')
    expect(res.status).toBe(403)
  })

  it('allows role-manager (has products.barcode.view)', async () => {
    const { agent } = await adminAgent('role-manager')
    const res = await agent.get('/api/admin/barcode-labels/search?search=شاي')
    expect(res.status).toBe(200)
  })
})

describe('GET /api/admin/barcode-labels/search — matching', () => {
  it('requires at least 2 characters and returns empty otherwise', async () => {
    const { agent } = await adminAgent('role-manager')
    const res = await agent.get('/api/admin/barcode-labels/search?search=ش')
    expect(res.status).toBe(200)
    expect(res.body.products).toEqual([])
  })

  it('matches by exact barcode', async () => {
    const { agent } = await adminAgent('role-manager')
    const res = await agent.get('/api/admin/barcode-labels/search?search=4006381333931')
    expect(res.body.products.map((p: { id: string }) => p.id)).toContain(`${PREFIX}prod-with-barcode`)
  })

  it('matches by SKU', async () => {
    const { agent } = await adminAgent('role-manager')
    const res = await agent.get('/api/admin/barcode-labels/search?search=BC-SKU-1')
    expect(res.body.products.map((p: { id: string }) => p.id)).toContain(`${PREFIX}prod-with-barcode`)
  })

  it('matches by product name tolerating Arabic normalization (أ/إ/آ, ة/ه)', async () => {
    const { agent } = await adminAgent('role-manager')
    const res = await agent.get(`/api/admin/barcode-labels/search?search=${encodeURIComponent('شاي احمر')}`)
    expect(res.body.products.map((p: { id: string }) => p.id)).toContain(`${PREFIX}prod-with-barcode`)
  })

  it('matches by brand and by category name', async () => {
    const { agent } = await adminAgent('role-manager')
    const byBrand = await agent.get(`/api/admin/barcode-labels/search?search=${encodeURIComponent('ماركة أ')}`)
    expect(byBrand.body.products.map((p: { id: string }) => p.id)).toContain(`${PREFIX}prod-with-barcode`)

    const byCategory = await agent.get(`/api/admin/barcode-labels/search?search=${encodeURIComponent('فئة اختبار الباركود')}`)
    const ids = byCategory.body.products.map((p: { id: string }) => p.id)
    expect(ids).toContain(`${PREFIX}prod-with-barcode`)
    expect(ids).toContain(`${PREFIX}prod-no-barcode`)
    expect(ids).toContain(`${PREFIX}prod-variants`)
  })

  it('matching by a variant barcode surfaces the parent product with ALL its variants (never just the matched one)', async () => {
    const { agent } = await adminAgent('role-manager')
    const res = await agent.get('/api/admin/barcode-labels/search?search=BC-VAR-1')
    const product = res.body.products.find((p: { id: string }) => p.id === `${PREFIX}prod-variants`)
    expect(product).toBeTruthy()
    expect(product.variants).toHaveLength(1)
    expect(product.variants[0].barcode).toBe('BC-VAR-1')
    // مهم: باركود المنتج الأب نفسه لازم يفضل زي ما هو (فاضي هنا) — البحث برقم باركود
    // المتغيّر ما بيغيّرش ولا بيخلط باركود المنتج الأب.
    expect(product.barcode).toBe('')
  })
})

describe('POST /api/admin/barcode-labels/generate — RBAC', () => {
  it('rejects a role with view+print but no generate permission (e.g. a picker)', async () => {
    const { agent } = await adminAgent('role-picker')
    const res = await agent.post('/api/admin/barcode-labels/generate')
      .send({ targetType: 'product', targetId: `${PREFIX}prod-no-barcode` })
    expect(res.status).toBe(403)
  })

  it('allows role-inventory-manager (has products.barcode.generate)', async () => {
    const { agent } = await adminAgent('role-inventory-manager')
    const res = await agent.post('/api/admin/barcode-labels/generate')
      .send({ targetType: 'product', targetId: `${PREFIX}prod-no-barcode` })
    expect(res.status).toBe(200)
    expect(res.body.barcode).toMatch(/^BC-\d{6}$/)
  })
})

describe('POST /api/admin/barcode-labels/generate — behavior', () => {
  it('generates a barcode for a product missing one and records an audit log entry', async () => {
    const { agent, userId } = await adminAgent('role-manager')
    const res = await agent.post('/api/admin/barcode-labels/generate')
      .send({ targetType: 'product', targetId: `${PREFIX}prod-no-barcode` })
    expect(res.status).toBe(200)

    const { rows } = await pool.query(
      `SELECT action, admin_user_id as "adminUserId", new_values as "newValues" FROM audit_logs
       WHERE entity_id = $1 AND entity_type = 'product' ORDER BY created_at DESC LIMIT 1`,
      [`${PREFIX}prod-no-barcode`]
    )
    expect(rows[0].action).toBe('product_barcode_generated')
    expect(rows[0].adminUserId).toBe(userId)
    expect(rows[0].newValues.barcode).toBe(res.body.barcode)
  })

  it('generates a barcode for a variant missing one', async () => {
    const { agent } = await adminAgent('role-manager')
    await pool.query(
      `INSERT INTO product_variants (id, product_id, name, sku, barcode, price, cost, stock, available, sort_order, created_at)
       VALUES ($1, $2, 'بدون باركود', NULL, '', 10, 4, 2, 1, 0, now())`,
      [`${PREFIX}variant-no-barcode`, `${PREFIX}prod-variants`]
    )
    const res = await agent.post('/api/admin/barcode-labels/generate')
      .send({ targetType: 'variant', targetId: `${PREFIX}variant-no-barcode` })
    expect(res.status).toBe(200)
    expect(res.body.barcode).toMatch(/^BC-\d{6}$/)
  })

  it('rejects generating over an already-set barcode without confirmOverwrite', async () => {
    const { agent } = await adminAgent('role-manager')
    const res = await agent.post('/api/admin/barcode-labels/generate')
      .send({ targetType: 'product', targetId: `${PREFIX}prod-with-barcode` })
    expect(res.status).toBe(409)
    expect(res.body.error).toBe('barcode_already_set')

    const { rows } = await pool.query('SELECT barcode FROM products WHERE id = $1', [`${PREFIX}prod-with-barcode`])
    expect(rows[0].barcode).toBe('4006381333931')
  })

  it('overwrites only when confirmOverwrite is explicitly true', async () => {
    const { agent } = await adminAgent('role-manager')
    const res = await agent.post('/api/admin/barcode-labels/generate')
      .send({ targetType: 'product', targetId: `${PREFIX}prod-with-barcode`, confirmOverwrite: true })
    expect(res.status).toBe(200)
    expect(res.body.barcode).not.toBe('4006381333931')
  })

  it('returns 404 for a non-existent target', async () => {
    const { agent } = await adminAgent('role-manager')
    const res = await agent.post('/api/admin/barcode-labels/generate')
      .send({ targetType: 'product', targetId: 'no-such-product' })
    expect(res.status).toBe(404)
  })

  it('rejects an invalid request body', async () => {
    const { agent } = await adminAgent('role-manager')
    const res = await agent.post('/api/admin/barcode-labels/generate').send({ targetType: 'bogus', targetId: 'x' })
    expect(res.status).toBe(400)
  })
})
