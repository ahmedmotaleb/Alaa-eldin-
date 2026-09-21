// اختبارات HTTP حقيقية (supertest على app.ts الفعلي) لمسار البحث الشامل — بتغطي الحد الأدنى
// لطول البحث، المطابقة عبر كل نوع كيان، التطبيع العربي، سقف النتائج لكل مجموعة، وأهم حاجة:
// RBAC الحقيقي على مستوى السيرفر (نوع مش مسموح بيه أبداً ما بيرجعش، حتى لو اتطلب صراحة عن
// طريق ?types=).
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { app } from '../app.js'
import { pool } from '../db.js'

const PREFIX = 'gsearch-'
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

async function adminAgent(roleId: string | null) {
  const agent = request.agent(app)
  const userId = await registerCustomer(agent, uniqueEmail(roleId ?? 'legacy'))
  await promoteToAdmin(userId, roleId)
  return { agent, userId }
}

async function cleanup() {
  await pool.query(`DELETE FROM purchase_order_items WHERE purchase_order_id LIKE $1`, [`${PREFIX}%`])
  await pool.query(`DELETE FROM purchase_orders WHERE id LIKE $1`, [`${PREFIX}%`])
  await pool.query(`DELETE FROM suppliers WHERE id LIKE $1`, [`${PREFIX}%`])
  await pool.query(`DELETE FROM product_variants WHERE product_id LIKE $1`, [`${PREFIX}%`])
  await pool.query(`DELETE FROM products WHERE id LIKE $1`, [`${PREFIX}%`])
  await pool.query(`DELETE FROM categories WHERE id = $1`, [CATEGORY_ID])
  await pool.query(`DELETE FROM orders WHERE id LIKE $1`, [`${PREFIX}%`])
  await pool.query(`DELETE FROM users WHERE email LIKE $1`, [`${PREFIX}%`])
}

beforeEach(async () => {
  await cleanup()

  await pool.query(
    `INSERT INTO categories (id, name, emoji, tint, sort_order) VALUES ($1, 'فئة بحث', '🧪', '#fff', 1)`,
    [CATEGORY_ID]
  )
  await pool.query(
    `INSERT INTO products (id, slug, category_id, name, description, price, cost, unit, emoji, available, stock, barcode, sku, brand, created_at)
     VALUES ($1, $1, $2, 'شاي أحمر فاخر', 'وصف', 15, 6, 'قطعة', '🍵', 1, 20, '4006381333931', 'GS-SKU-1', 'ماركة أ', now())`,
    [`${PREFIX}prod-1`, CATEGORY_ID]
  )
  await pool.query(
    `INSERT INTO products (id, slug, category_id, name, description, price, cost, unit, emoji, available, stock, barcode, sku, brand, created_at)
     VALUES ($1, $1, $2, 'منتج بمتغيرات', 'وصف', 30, 12, 'قطعة', '👕', 1, 8, '', NULL, '', now())`,
    [`${PREFIX}prod-variants`, CATEGORY_ID]
  )
  await pool.query(
    `INSERT INTO product_variants (id, product_id, name, sku, barcode, price, cost, stock, available, sort_order, created_at)
     VALUES ($1, $2, 'أحمر - كبير', NULL, 'GS-VAR-1', 32, 13, 4, 1, 0, now())`,
    [`${PREFIX}variant-1`, `${PREFIX}prod-variants`]
  )
  await pool.query(
    `INSERT INTO orders (id, order_number, created_at, delivery_slot, payment_method, customer_full_name, customer_mobile, customer_address, subtotal, delivery_fee, total, status)
     VALUES ($1, $1, now(), 'now', 'cod', 'أحمد إبراهيم', '01012345678', 'عنوان', 100, 10, 110, 'placed')`,
    [`${PREFIX}order-1`]
  )
  await pool.query(
    `INSERT INTO suppliers (id, name, mobile, active, created_at, updated_at)
     VALUES ($1, 'مورد الشاي الرئيسي', '01099998888', 1, now(), now())`,
    [`${PREFIX}supplier-1`]
  )
  await pool.query(
    `INSERT INTO purchase_orders (id, po_number, supplier_id, status, created_at, updated_at)
     VALUES ($1, $2, $3, 'draft', now(), now())`,
    [`${PREFIX}po-1`, `${PREFIX}PO-500001`, `${PREFIX}supplier-1`]
  )
}, 20000)

afterAll(async () => {
  await cleanup()
  await pool.end()
})

describe('GET /api/admin/search — access control', () => {
  it('rejects an unauthenticated request', async () => {
    const res = await request(app).get('/api/admin/search?q=شاي')
    expect(res.status).toBe(401)
  })

  it('rejects a non-admin authenticated customer', async () => {
    const agent = request.agent(app)
    await registerCustomer(agent, uniqueEmail('customer'))
    const res = await agent.get('/api/admin/search?q=شاي')
    expect(res.status).toBe(403)
  })

  it('requires at least 2 characters and returns an empty object otherwise', async () => {
    const { agent } = await adminAgent('role-manager')
    const res = await agent.get(`/api/admin/search?q=${encodeURIComponent('ش')}`)
    expect(res.status).toBe(200)
    expect(res.body.results).toEqual({})
  })

  it('sends standard rate-limit headers (endpoint is rate limited)', async () => {
    const { agent } = await adminAgent('role-manager')
    const res = await agent.get(`/api/admin/search?q=${encodeURIComponent('شاي')}`)
    expect(res.headers['ratelimit-limit']).toBeDefined()
  })
})

describe('GET /api/admin/search — matching per entity type', () => {
  it('matches a product by exact barcode', async () => {
    const { agent } = await adminAgent('role-manager')
    const res = await agent.get('/api/admin/search?q=4006381333931')
    expect(res.body.results.products?.map((p: { id: string }) => p.id)).toContain(`${PREFIX}prod-1`)
  })

  it('matches a product by exact SKU', async () => {
    const { agent } = await adminAgent('role-manager')
    const res = await agent.get('/api/admin/search?q=GS-SKU-1')
    expect(res.body.results.products?.map((p: { id: string }) => p.id)).toContain(`${PREFIX}prod-1`)
  })

  it('matches a product by name tolerating Arabic normalization (أ/إ/آ)', async () => {
    const { agent } = await adminAgent('role-manager')
    const res = await agent.get(`/api/admin/search?q=${encodeURIComponent('شاي إحمر')}`)
    expect(res.body.results.products?.map((p: { id: string }) => p.id)).toContain(`${PREFIX}prod-1`)
  })

  it('matches a product via its variant barcode (surfaces the parent product)', async () => {
    const { agent } = await adminAgent('role-manager')
    const res = await agent.get('/api/admin/search?q=GS-VAR-1')
    expect(res.body.results.products?.map((p: { id: string }) => p.id)).toContain(`${PREFIX}prod-variants`)
  })

  it('matches an order by exact order number', async () => {
    const { agent } = await adminAgent('role-manager')
    const res = await agent.get(`/api/admin/search?q=${encodeURIComponent(`${PREFIX}order-1`)}`)
    expect(res.body.results.orders?.map((o: { id: string }) => o.id)).toContain(`${PREFIX}order-1`)
  })

  it('matches an order by exact customer mobile', async () => {
    const { agent } = await adminAgent('role-manager')
    const res = await agent.get('/api/admin/search?q=01012345678')
    expect(res.body.results.orders?.map((o: { id: string }) => o.id)).toContain(`${PREFIX}order-1`)
  })

  it('matches an order by customer name tolerating Arabic normalization', async () => {
    const { agent } = await adminAgent('role-manager')
    const res = await agent.get(`/api/admin/search?q=${encodeURIComponent('احمد ابراهيم')}`)
    expect(res.body.results.orders?.map((o: { id: string }) => o.id)).toContain(`${PREFIX}order-1`)
  })

  it('matches a customer by name and by mobile', async () => {
    const { agent } = await adminAgent('role-manager')
    const customerId = await registerCustomer(request.agent(app), uniqueEmail('cust'))
    await pool.query('UPDATE users SET full_name = $2, mobile = $3 WHERE id = $1', [customerId, 'سارة محمود', '01055554444'])

    const byName = await agent.get(`/api/admin/search?q=${encodeURIComponent('ساره محمود')}`)
    expect(byName.body.results.customers?.map((c: { id: string }) => c.id)).toContain(customerId)

    const byMobile = await agent.get('/api/admin/search?q=01055554444')
    expect(byMobile.body.results.customers?.map((c: { id: string }) => c.id)).toContain(customerId)
  })

  it('never returns a staff/admin account as a "customer" search result', async () => {
    const { agent, userId } = await adminAgent('role-manager')
    const res = await agent.get(`/api/admin/search?q=${encodeURIComponent('مستخدم اختبار')}`)
    expect(res.body.results.customers?.map((c: { id: string }) => c.id) ?? []).not.toContain(userId)
  })

  it('matches a supplier by name and by mobile', async () => {
    const { agent } = await adminAgent('role-manager')
    const byName = await agent.get(`/api/admin/search?q=${encodeURIComponent('مورد الشاي')}`)
    expect(byName.body.results.suppliers?.map((s: { id: string }) => s.id)).toContain(`${PREFIX}supplier-1`)

    const byMobile = await agent.get('/api/admin/search?q=01099998888')
    expect(byMobile.body.results.suppliers?.map((s: { id: string }) => s.id)).toContain(`${PREFIX}supplier-1`)
  })

  it('matches a purchase order by exact PO number', async () => {
    const { agent } = await adminAgent('role-manager')
    const res = await agent.get(`/api/admin/search?q=${encodeURIComponent(`${PREFIX}PO-500001`)}`)
    expect(res.body.results.purchase_orders?.map((po: { id: string }) => po.id)).toContain(`${PREFIX}po-1`)
  })
})

describe('GET /api/admin/search — ranking and result caps', () => {
  it('caps each entity group at 5 results even when more rows match', async () => {
    const extraIds: string[] = []
    for (let i = 0; i < 6; i++) {
      const id = `${PREFIX}prod-cap-${i}`
      extraIds.push(id)
      await pool.query(
        `INSERT INTO products (id, slug, category_id, name, description, price, cost, unit, emoji, available, stock, barcode, created_at)
         VALUES ($1, $1, $2, 'منتج مكرر للسقف', 'وصف', 5, 2, 'قطعة', '📦', 1, 5, '', now())`,
        [id, CATEGORY_ID]
      )
    }
    const { agent } = await adminAgent('role-manager')
    const res = await agent.get(`/api/admin/search?q=${encodeURIComponent('منتج مكرر للسقف')}`)
    expect(res.body.results.products).toHaveLength(5)
  })

  it('ranks an exact barcode match above a product whose name merely contains the term', async () => {
    // "شاي" هنا مش رقم باركود حقيقي شكلياً، بس كفاية لإثبات إن مطابقة p.barcode التامة
    // (rank 0) بتترتب قبل مطابقة الاسم المُطبَّع العادية (rank 2) بغض النظر عن ترتيب الإدراج.
    await pool.query(
      `INSERT INTO products (id, slug, category_id, name, description, price, cost, unit, emoji, available, stock, barcode, created_at)
       VALUES ($1, $1, $2, 'منتج بباركود غريب', 'وصف', 8, 3, 'قطعة', '📦', 1, 10, 'شاي', now())`,
      [`${PREFIX}prod-exact-barcode`, CATEGORY_ID]
    )
    const { agent } = await adminAgent('role-manager')
    const res = await agent.get(`/api/admin/search?q=${encodeURIComponent('شاي')}`)
    const ids = res.body.results.products?.map((p: { id: string }) => p.id) ?? []
    expect(ids[0]).toBe(`${PREFIX}prod-exact-barcode`)
    expect(ids).toContain(`${PREFIX}prod-1`)
  })
})

describe('GET /api/admin/search — RBAC (server decides allowed entity types, never trust the client)', () => {
  it('a role-picker (no products/customers/purchases permission) sees only orders, even for a query matching everything', async () => {
    const { agent } = await adminAgent('role-picker')
    const res = await agent.get('/api/admin/search?q=شاي')
    expect(Object.keys(res.body.results)).not.toContain('products')
    expect(Object.keys(res.body.results)).not.toContain('customers')
    expect(Object.keys(res.body.results)).not.toContain('suppliers')
    expect(Object.keys(res.body.results)).not.toContain('purchase_orders')
  })

  it('never returns a forbidden entity type even when explicitly requested via ?types=', async () => {
    const { agent } = await adminAgent('role-picker')
    const res = await agent.get(`/api/admin/search?q=${encodeURIComponent('مورد الشاي')}&types=suppliers,orders`)
    expect(res.body.results.suppliers).toBeUndefined()
  })

  it('role-manager (full purchasing access) can see suppliers and purchase orders', async () => {
    const { agent } = await adminAgent('role-manager')
    const res = await agent.get(`/api/admin/search?q=${encodeURIComponent('مورد الشاي')}`)
    expect(res.body.results.suppliers?.map((s: { id: string }) => s.id)).toContain(`${PREFIX}supplier-1`)
  })
})
