// اختبارات HTTP حقيقية لمسارات حركات المخزون اليدوية (/api/admin/stock-movements) — بما
// فيها الجزء الجديد: دعم المتغيّرات (variantId) وحماية الرصيد السالب تحت تزامن حقيقي.
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { app } from '../app.js'
import { pool } from '../db.js'

const PREFIX = 'astkmv-'
const STRONG_PASSWORD = 'CorrectHorse9'
const CATEGORY_ID = `${PREFIX}category`
const PRODUCT_ID = `${PREFIX}product`
const VARIANT_ID = `${PREFIX}variant`

function uniqueEmail(label: string): string {
  return `${PREFIX}${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`
}

async function registerCustomer(agent: ReturnType<typeof request.agent>, email: string): Promise<string> {
  const res = await agent.post('/api/auth/register').send({ email, password: STRONG_PASSWORD, fullName: 'مستخدم اختبار' })
  expect(res.status).toBe(201)
  return res.body.user.id as string
}

async function adminAgent() {
  const agent = request.agent(app)
  const userId = await registerCustomer(agent, uniqueEmail('admin'))
  await pool.query('UPDATE users SET is_admin = 1, role = $2 WHERE id = $1', [userId, 'staff'])
  return { agent, userId }
}

async function seedCatalog() {
  await pool.query(`INSERT INTO categories (id, name, emoji, tint, sort_order) VALUES ($1, 'فئة اختبار', '🧪', '#fff', 1)`, [CATEGORY_ID])
  await pool.query(
    `INSERT INTO products (id, slug, category_id, name, description, price, cost, unit, emoji, available, stock, created_at)
     VALUES ($1, $1, $2, 'منتج اختبار', 'وصف', 40, 15, 'قطعة', '🧪', 1, 10, now())`,
    [PRODUCT_ID, CATEGORY_ID]
  )
  await pool.query(
    `INSERT INTO product_variants (id, product_id, name, price, cost, stock, available, sort_order, created_at)
     VALUES ($1, $2, 'متغيّر اختبار', 45, 18, 5, 1, 0, now())`,
    [VARIANT_ID, PRODUCT_ID]
  )
}

async function cleanup() {
  await pool.query(`DELETE FROM stock_movements WHERE product_id = $1`, [PRODUCT_ID])
  await pool.query(`DELETE FROM product_variants WHERE product_id = $1`, [PRODUCT_ID])
  await pool.query(`DELETE FROM products WHERE id = $1`, [PRODUCT_ID])
  await pool.query(`DELETE FROM categories WHERE id = $1`, [CATEGORY_ID])
  await pool.query(`DELETE FROM users WHERE email LIKE $1`, [`${PREFIX}%`])
}

beforeEach(async () => { await cleanup(); await seedCatalog() }, 20000)
afterAll(async () => { await cleanup(); await pool.end() })

describe('POST /api/admin/stock-movements — RBAC', () => {
  it('rejects an unauthenticated request', async () => {
    const res = await request(app).post('/api/admin/stock-movements').send({ productId: PRODUCT_ID, type: 'restock', quantityChange: 1 })
    expect(res.status).toBe(401)
  })
})

describe('POST /api/admin/stock-movements — product-level (no variantId)', () => {
  it('increases product stock and records the movement', async () => {
    const { agent } = await adminAgent()
    const res = await agent.post('/api/admin/stock-movements').send({ productId: PRODUCT_ID, type: 'restock', quantityChange: 5, note: 'توريد' })
    expect(res.status).toBe(201)
    expect(res.body.newStock).toBe(15)
    expect(res.body.movement.variantId).toBeNull()

    const { rows } = await pool.query<{ stock: number }>('SELECT stock FROM products WHERE id = $1', [PRODUCT_ID])
    expect(rows[0].stock).toBe(15)
  })

  it('rejects a decrease that would push stock negative', async () => {
    const { agent } = await adminAgent()
    const res = await agent.post('/api/admin/stock-movements').send({ productId: PRODUCT_ID, type: 'damage', quantityChange: -50 })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('insufficient_stock')

    const { rows } = await pool.query<{ stock: number }>('SELECT stock FROM products WHERE id = $1', [PRODUCT_ID])
    expect(rows[0].stock).toBe(10)
  })

  it('is safe under concurrent overlapping decrements — never goes negative', async () => {
    const { agent } = await adminAgent()
    // المخزون 10 — تعديلان متزامنان بناقص 6 لكل واحد: لازم واحد بس ينجح (الرصيد مايكفيش للاتنين).
    const [first, second] = await Promise.all([
      agent.post('/api/admin/stock-movements').send({ productId: PRODUCT_ID, type: 'damage', quantityChange: -6 }),
      agent.post('/api/admin/stock-movements').send({ productId: PRODUCT_ID, type: 'damage', quantityChange: -6 })
    ])
    const statuses = [first.status, second.status].sort()
    expect(statuses).toEqual([201, 400])

    const { rows } = await pool.query<{ stock: number }>('SELECT stock FROM products WHERE id = $1', [PRODUCT_ID])
    expect(rows[0].stock).toBe(4)
  })
})

describe('POST /api/admin/stock-movements — variant-level (variantId set)', () => {
  it('increases variant stock, leaves the parent product stock untouched, and records variantId', async () => {
    const { agent } = await adminAgent()
    const res = await agent.post('/api/admin/stock-movements').send({ productId: PRODUCT_ID, variantId: VARIANT_ID, type: 'restock', quantityChange: 3 })
    expect(res.status).toBe(201)
    expect(res.body.newStock).toBe(8)
    expect(res.body.movement.variantId).toBe(VARIANT_ID)
    expect(res.body.movement.variantName).toBe('متغيّر اختبار')

    const { rows: variantRows } = await pool.query<{ stock: number }>('SELECT stock FROM product_variants WHERE id = $1', [VARIANT_ID])
    expect(variantRows[0].stock).toBe(8)
    const { rows: productRows } = await pool.query<{ stock: number }>('SELECT stock FROM products WHERE id = $1', [PRODUCT_ID])
    expect(productRows[0].stock).toBe(10)
  })

  it('rejects a variant decrease that would push its stock negative, without touching the parent product', async () => {
    const { agent } = await adminAgent()
    const res = await agent.post('/api/admin/stock-movements').send({ productId: PRODUCT_ID, variantId: VARIANT_ID, type: 'loss', quantityChange: -50 })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('insufficient_stock')

    const { rows: variantRows } = await pool.query<{ stock: number }>('SELECT stock FROM product_variants WHERE id = $1', [VARIANT_ID])
    expect(variantRows[0].stock).toBe(5)
  })

  it('rejects a variantId that does not belong to the given productId', async () => {
    const { agent } = await adminAgent()
    const res = await agent.post('/api/admin/stock-movements').send({ productId: PRODUCT_ID, variantId: 'does-not-exist', type: 'restock', quantityChange: 1 })
    expect(res.status).toBe(404)
    expect(res.body.error).toBe('product_not_found')
  })

  it('is safe under concurrent overlapping decrements on the same variant — never goes negative', async () => {
    const { agent } = await adminAgent()
    // رصيد المتغيّر 5 — تعديلان متزامنان بناقص 3 لكل واحد: لازم واحد بس ينجح.
    const [first, second] = await Promise.all([
      agent.post('/api/admin/stock-movements').send({ productId: PRODUCT_ID, variantId: VARIANT_ID, type: 'loss', quantityChange: -3 }),
      agent.post('/api/admin/stock-movements').send({ productId: PRODUCT_ID, variantId: VARIANT_ID, type: 'loss', quantityChange: -3 })
    ])
    const statuses = [first.status, second.status].sort()
    expect(statuses).toEqual([201, 400])

    const { rows } = await pool.query<{ stock: number }>('SELECT stock FROM product_variants WHERE id = $1', [VARIANT_ID])
    expect(rows[0].stock).toBe(2)
  })
})

describe('GET /api/admin/stock-movements — variant filter', () => {
  it('filters movements by variantId and includes variantName', async () => {
    const { agent } = await adminAgent()
    await agent.post('/api/admin/stock-movements').send({ productId: PRODUCT_ID, type: 'restock', quantityChange: 1 })
    await agent.post('/api/admin/stock-movements').send({ productId: PRODUCT_ID, variantId: VARIANT_ID, type: 'restock', quantityChange: 2 })

    const res = await agent.get(`/api/admin/stock-movements?variantId=${VARIANT_ID}`)
    expect(res.status).toBe(200)
    expect(res.body.movements).toHaveLength(1)
    expect(res.body.movements[0].variantId).toBe(VARIANT_ID)
    expect(res.body.movements[0].variantName).toBe('متغيّر اختبار')
  })
})
