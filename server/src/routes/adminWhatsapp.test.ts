// اختبارات HTTP حقيقية لمسار إعادة إرسال تأكيد الطلب فقط (/api/admin/whatsapp/orders/:id/resend-confirmation)
// — باقي مسارات واتساب (القوالب، الإرسال العام) مغطاة بالفعل في whatsappService.test.ts على
// مستوى الخدمة. سلوك "مُفعّل فعلياً" (نجاح حقيقي) مغطى في whatsappOrderConfirmation.test.ts.
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { app } from '../app.js'
import { pool } from '../db.js'

const PREFIX = 'awa-resend-'
const STRONG_PASSWORD = 'CorrectHorse9'
const ORDER_ID = `${PREFIX}order`

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
  await pool.query('UPDATE users SET is_admin = 1, role = $2 WHERE id = $1', [userId, 'admin'])
  return { agent, userId }
}

async function seedOrder() {
  await pool.query(
    `INSERT INTO orders (id, order_number, created_at, delivery_slot, payment_method, customer_full_name, customer_mobile,
                          customer_governorate, customer_address, subtotal, delivery_fee, total, status, discount_amount)
     VALUES ($1, $1, now(), 'now', 'COD', 'عميل اختبار', '01012345678', 'القاهرة', 'عنوان', 100, 0, 100, 'placed', 0)`,
    [ORDER_ID]
  )
}

async function cleanup() {
  await pool.query('DELETE FROM whatsapp_messages WHERE order_id = $1', [ORDER_ID])
  await pool.query('DELETE FROM orders WHERE id = $1', [ORDER_ID])
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${PREFIX}%`])
}

beforeEach(async () => { await cleanup(); await seedOrder() })
afterAll(async () => { await cleanup(); await pool.end() })

describe('POST /api/admin/whatsapp/orders/:orderId/resend-confirmation', () => {
  it('rejects an unauthenticated request', async () => {
    const res = await request(app).post(`/api/admin/whatsapp/orders/${ORDER_ID}/resend-confirmation`)
    expect(res.status).toBe(401)
  })

  it('404s for an order that does not exist', async () => {
    const { agent } = await adminAgent()
    const res = await agent.post('/api/admin/whatsapp/orders/no-such-order/resend-confirmation')
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'order_not_found' })
  })

  // بيئة الاختبار مالهاش بيانات اعتماد واتساب حقيقية ولا اسم قالب معتمد
  // (whatsappOrderConfirmationReady=false) — فده بيتأكد إن المسار بيرفض بأمان (409) من
  // غير ما يحاول يتصل بأي API، ومفيش أي صف بيتسجّل في whatsapp_messages.
  it('reports whatsapp_order_confirmation_not_ready (409) without recording any message', async () => {
    const { agent } = await adminAgent()
    const res = await agent.post(`/api/admin/whatsapp/orders/${ORDER_ID}/resend-confirmation`)
    expect(res.status).toBe(409)
    expect(res.body).toEqual({ error: 'whatsapp_order_confirmation_not_ready' })

    const { rows } = await pool.query('SELECT count(*) as n FROM whatsapp_messages WHERE order_id = $1', [ORDER_ID])
    expect(Number(rows[0].n)).toBe(0)
  })
})

describe('GET /api/admin/whatsapp/status', () => {
  it('includes an orderConfirmation config breakdown alongside the base configured flag', async () => {
    const { agent } = await adminAgent()
    const res = await agent.get('/api/admin/whatsapp/status')
    expect(res.status).toBe(200)
    expect(res.body.configured).toBe(false)
    expect(res.body.orderConfirmation).toEqual({
      apiConfigured: false, templateConfigured: false, templateName: null, language: 'ar'
    })
  })
})

describe('GET /api/admin/whatsapp/orders/:orderId/confirmation-status', () => {
  it('rejects an unauthenticated request', async () => {
    const res = await request(app).get(`/api/admin/whatsapp/orders/${ORDER_ID}/confirmation-status`)
    expect(res.status).toBe(401)
  })

  it('returns null status when no automatic notification was ever claimed for this order', async () => {
    const { agent } = await adminAgent()
    const res = await agent.get(`/api/admin/whatsapp/orders/${ORDER_ID}/confirmation-status`)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ status: null })
  })
})
