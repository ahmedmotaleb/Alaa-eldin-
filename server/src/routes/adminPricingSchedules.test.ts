// اختبارات HTTP حقيقية لمسارات جدولة الأسعار (/api/admin/pricing-schedules) — RBAC وتحقق
// من صحة الحقول. منطق التعارض/التنفيذ نفسه مغطى بالفعل في pricingScheduleService.test.ts.
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { app } from '../app.js'
import { pool } from '../db.js'

const PREFIX = 'apxsch-'
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
  await pool.query(`INSERT INTO categories (id, name, emoji, tint, sort_order) VALUES ($1, 'فئة اختبار', '🧪', '#fff', 1)`, [CATEGORY_ID])
  await pool.query(
    `INSERT INTO products (id, slug, category_id, name, description, price, cost, unit, emoji, available, stock, created_at)
     VALUES ($1, $1, $2, 'منتج اختبار جدولة', 'وصف', 40, 15, 'قطعة', '🧪', 1, 50, now())`,
    [PRODUCT_ID, CATEGORY_ID]
  )
}

async function cleanup() {
  await pool.query(`DELETE FROM product_price_schedules WHERE created_by IN (SELECT id FROM users WHERE email LIKE $1)`, [`${PREFIX}%`])
  await pool.query(`DELETE FROM products WHERE id = $1`, [PRODUCT_ID])
  await pool.query(`DELETE FROM categories WHERE id = $1`, [CATEGORY_ID])
  await pool.query(`DELETE FROM users WHERE email LIKE $1`, [`${PREFIX}%`])
}

beforeEach(async () => { await cleanup(); await seedCatalog() }, 20000)
afterAll(async () => { await cleanup(); await pool.end() })

function futureIso(minutes = 30): string {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString()
}

describe('POST /api/admin/pricing-schedules — RBAC', () => {
  it('rejects an unauthenticated request', async () => {
    const res = await request(app).post('/api/admin/pricing-schedules').send({})
    expect(res.status).toBe(401)
  })

  it('rejects a role without products.pricing.bulk_update (e.g. a picker)', async () => {
    const { agent } = await adminAgent('role-picker')
    const res = await agent.post('/api/admin/pricing-schedules').send({ productId: PRODUCT_ID, newPrice: 30, startsAt: futureIso() })
    expect(res.status).toBe(403)
  })

  it('allows a manager (has products.pricing.bulk_update)', async () => {
    const { agent } = await adminAgent('role-manager')
    const res = await agent.post('/api/admin/pricing-schedules').send({ productId: PRODUCT_ID, newPrice: 30, startsAt: futureIso() })
    expect(res.status).toBe(201)
    expect(res.body.schedule.expectedCurrentPrice).toBe(40)
  })
})

describe('POST /api/admin/pricing-schedules — validation', () => {
  it('rejects both productId and variantId set together', async () => {
    const { agent } = await adminAgent('role-manager')
    const res = await agent.post('/api/admin/pricing-schedules').send({ productId: PRODUCT_ID, variantId: 'some-variant', newPrice: 30, startsAt: futureIso() })
    expect(res.status).toBe(400)
  })

  it('rejects neither productId nor variantId set', async () => {
    const { agent } = await adminAgent('role-manager')
    const res = await agent.post('/api/admin/pricing-schedules').send({ newPrice: 30, startsAt: futureIso() })
    expect(res.status).toBe(400)
  })

  it('rejects a non-positive price', async () => {
    const { agent } = await adminAgent('role-manager')
    const res = await agent.post('/api/admin/pricing-schedules').send({ productId: PRODUCT_ID, newPrice: 0, startsAt: futureIso() })
    expect(res.status).toBe(400)
  })

  it('rejects a target product that does not exist', async () => {
    const { agent } = await adminAgent('role-manager')
    const res = await agent.post('/api/admin/pricing-schedules').send({ productId: 'does-not-exist', newPrice: 30, startsAt: futureIso() })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('target_not_found')
  })
})

describe('GET and DELETE /api/admin/pricing-schedules', () => {
  it('lists created schedules and allows cancelling a pending one', async () => {
    const { agent } = await adminAgent('role-manager')
    const created = await agent.post('/api/admin/pricing-schedules').send({ productId: PRODUCT_ID, newPrice: 30, startsAt: futureIso() })
    const id = created.body.schedule.id

    const listed = await agent.get(`/api/admin/pricing-schedules?productId=${PRODUCT_ID}`)
    expect(listed.status).toBe(200)
    expect(listed.body.schedules.map((s: { id: string }) => s.id)).toContain(id)

    const cancelled = await agent.delete(`/api/admin/pricing-schedules/${id}`)
    expect(cancelled.status).toBe(204)

    const relisted = await agent.get(`/api/admin/pricing-schedules?productId=${PRODUCT_ID}`)
    expect(relisted.body.schedules.find((s: { id: string }) => s.id === id).status).toBe('cancelled')
  })

  it('returns 409 when trying to cancel a non-existent or already-cancelled schedule', async () => {
    const { agent } = await adminAgent('role-manager')
    const res = await agent.delete('/api/admin/pricing-schedules/does-not-exist')
    expect(res.status).toBe(409)
  })
})
