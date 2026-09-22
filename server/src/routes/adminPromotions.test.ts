// اختبارات HTTP حقيقية لمسارات إدارة العروض (/api/admin/promotions) — RBAC، التحقق من
// صحة الحقول حسب النوع، والتأكد إن هدف العرض (منتج/فئة) لازم يكون موجود فعلاً.
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { app } from '../app.js'
import { pool } from '../db.js'

const PREFIX = 'apromo-'
const STRONG_PASSWORD = 'CorrectHorse9'
const CATEGORY_ID = `${PREFIX}category`
const PRODUCT_ID = `${PREFIX}product`

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

async function seedCatalog() {
  await pool.query(`INSERT INTO categories (id, name, emoji, tint, sort_order) VALUES ($1, 'فئة اختبار عروض', '🧪', '#fff', 1)`, [CATEGORY_ID])
  await pool.query(
    `INSERT INTO products (id, slug, category_id, name, description, price, cost, unit, emoji, available, stock, created_at)
     VALUES ($1, $1, $2, 'منتج اختبار عروض', 'وصف', 20, 10, 'قطعة', '🧪', 1, 50, now())`,
    [PRODUCT_ID, CATEGORY_ID]
  )
}

async function cleanup() {
  await pool.query(`DELETE FROM promotion_bundle_items WHERE promotion_id IN (SELECT id FROM promotions WHERE created_by IN (SELECT id FROM users WHERE email LIKE $1))`, [`${PREFIX}%`])
  await pool.query(`DELETE FROM promotions WHERE created_by IN (SELECT id FROM users WHERE email LIKE $1)`, [`${PREFIX}%`])
  await pool.query(`DELETE FROM products WHERE id = $1`, [PRODUCT_ID])
  await pool.query(`DELETE FROM categories WHERE id = $1`, [CATEGORY_ID])
  await pool.query(`DELETE FROM users WHERE email LIKE $1`, [`${PREFIX}%`])
}

beforeEach(async () => { await cleanup(); await seedCatalog() }, 20000)
afterAll(async () => { await cleanup(); await pool.end() })

describe('POST /api/admin/promotions — RBAC', () => {
  it('rejects an unauthenticated request', async () => {
    const res = await request(app).post('/api/admin/promotions').send({})
    expect(res.status).toBe(401)
  })

  it('rejects a role without discounts.manage (e.g. orders manager)', async () => {
    const { agent } = await adminAgent('role-orders-manager')
    const res = await agent.post('/api/admin/promotions').send({
      type: 'buy_x_get_y', name: 'عرض', active: true,
      triggerProductId: PRODUCT_ID, buyQuantity: 2, getQuantity: 1, getDiscountPercent: 100
    })
    expect(res.status).toBe(403)
  })

  it('allows role-manager (has discounts.manage)', async () => {
    const { agent } = await adminAgent('role-manager')
    const res = await agent.post('/api/admin/promotions').send({
      type: 'buy_x_get_y', name: 'اشترِ 2 واحصل على 1', active: true,
      triggerProductId: PRODUCT_ID, buyQuantity: 2, getQuantity: 1, getDiscountPercent: 100
    })
    expect(res.status).toBe(201)
    expect(res.body.promotion.name).toBe('اشترِ 2 واحصل على 1')
  })
})

describe('POST /api/admin/promotions — validation', () => {
  it('rejects buy_x_get_y with neither a trigger product nor category', async () => {
    const { agent } = await adminAgent('role-manager')
    const res = await agent.post('/api/admin/promotions').send({
      type: 'buy_x_get_y', name: 'عرض', active: true, buyQuantity: 2, getQuantity: 1, getDiscountPercent: 100
    })
    expect(res.status).toBe(400)
  })

  it('rejects a getDiscountPercent outside (0, 100]', async () => {
    const { agent } = await adminAgent('role-manager')
    const res = await agent.post('/api/admin/promotions').send({
      type: 'buy_x_get_y', name: 'عرض', active: true,
      triggerProductId: PRODUCT_ID, buyQuantity: 2, getQuantity: 1, getDiscountPercent: 150
    })
    expect(res.status).toBe(400)
  })

  it('rejects a trigger product that does not actually exist', async () => {
    const { agent } = await adminAgent('role-manager')
    const res = await agent.post('/api/admin/promotions').send({
      type: 'buy_x_get_y', name: 'عرض', active: true,
      triggerProductId: 'does-not-exist', buyQuantity: 2, getQuantity: 1, getDiscountPercent: 100
    })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('target_not_found')
  })

  it('rejects a bundle with no groups', async () => {
    const { agent } = await adminAgent('role-manager')
    const res = await agent.post('/api/admin/promotions').send({
      type: 'bundle_fixed_price', name: 'باقة', active: true, bundlePrice: 30, bundleItems: []
    })
    expect(res.status).toBe(400)
  })

  it('creates a valid multi-group bundle', async () => {
    const { agent } = await adminAgent('role-manager')
    const res = await agent.post('/api/admin/promotions').send({
      type: 'bundle_fixed_price', name: 'باقة موفرة', active: true, bundlePrice: 30,
      bundleItems: [
        { productId: PRODUCT_ID, requiredQuantity: 2 },
        { categoryId: CATEGORY_ID, requiredQuantity: 1 }
      ]
    })
    expect(res.status).toBe(201)
    expect(res.body.promotion.bundleItems).toHaveLength(2)
  })
})

describe('GET /api/admin/promotions/:id and PATCH', () => {
  it('updates an existing promotion in place', async () => {
    const { agent } = await adminAgent('role-manager')
    const created = await agent.post('/api/admin/promotions').send({
      type: 'buy_x_get_y', name: 'عرض أصلي', active: true,
      triggerProductId: PRODUCT_ID, buyQuantity: 2, getQuantity: 1, getDiscountPercent: 100
    })
    const id = created.body.promotion.id

    const updated = await agent.patch(`/api/admin/promotions/${id}`).send({
      name: 'عرض معدّل', active: false,
      triggerProductId: PRODUCT_ID, buyQuantity: 3, getQuantity: 1, getDiscountPercent: 50
    })
    expect(updated.status).toBe(200)
    expect(updated.body.promotion.name).toBe('عرض معدّل')
    expect(updated.body.promotion.active).toBe(false)
    expect(updated.body.promotion.buyQuantity).toBe(3)
  })

  it('returns 404 for a non-existent promotion', async () => {
    const { agent } = await adminAgent('role-manager')
    const res = await agent.get('/api/admin/promotions/does-not-exist')
    expect(res.status).toBe(404)
  })
})

describe('DELETE /api/admin/promotions/:id', () => {
  it('deletes a promotion and cascades its bundle items', async () => {
    const { agent } = await adminAgent('role-manager')
    const created = await agent.post('/api/admin/promotions').send({
      type: 'bundle_fixed_price', name: 'باقة للحذف', active: true, bundlePrice: 15,
      bundleItems: [{ productId: PRODUCT_ID, requiredQuantity: 1 }]
    })
    const id = created.body.promotion.id

    const deleted = await agent.delete(`/api/admin/promotions/${id}`)
    expect(deleted.status).toBe(204)

    const { rows } = await pool.query('SELECT 1 FROM promotion_bundle_items WHERE promotion_id = $1', [id])
    expect(rows).toHaveLength(0)
  })
})
