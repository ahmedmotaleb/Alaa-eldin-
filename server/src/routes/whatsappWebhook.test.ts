// اختبارات HTTP حقيقية لمسار /api/webhooks/whatsapp — تركّز على الجزء اللي مش ممكن يتغطى
// على مستوى الخدمة فقط: مصافحة GET الفعلية عبر querystring، وتحقق POST للتوقيع باستخدام
// rawBody الفعلي المُلتقط في app.ts (مش جسم مُعاد تسلسله)، فوق HTTP حقيقي كامل (supertest).
import crypto from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'

process.env.WHATSAPP_APP_SECRET = 'test-webhook-app-secret'
process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = 'test-webhook-verify-token'

const { app } = await import('../app.js')
const { pool } = await import('../db.js')

const PREFIX = 'wawhroute-'
const ORDER_ID = `${PREFIX}order`
const PROVIDER_MESSAGE_ID = `${PREFIX}wamid.abc`

function sign(rawBody: Buffer): string {
  return 'sha256=' + crypto.createHmac('sha256', 'test-webhook-app-secret').update(rawBody).digest('hex')
}

async function seed() {
  await pool.query(`DELETE FROM whatsapp_message_status_events WHERE provider_message_id = $1`, [PROVIDER_MESSAGE_ID])
  await pool.query(`DELETE FROM whatsapp_messages WHERE order_id = $1`, [ORDER_ID])
  await pool.query(`DELETE FROM orders WHERE id = $1`, [ORDER_ID])
  await pool.query(
    `INSERT INTO orders (id, order_number, created_at, delivery_slot, payment_method, customer_full_name, customer_mobile,
                          customer_governorate, customer_address, subtotal, delivery_fee, total, status, discount_amount)
     VALUES ($1, $1, now(), 'now', 'COD', 'عميل اختبار', '01000000000', 'القاهرة', 'عنوان', 100, 0, 100, 'placed', 0)`,
    [ORDER_ID]
  )
  await pool.query(
    `INSERT INTO whatsapp_messages (id, order_id, to_number, body, status, provider_message_id, created_at)
     VALUES ($1, $2, '201000000000', 'نص', 'sent', $3, now())`,
    [`${PREFIX}msg`, ORDER_ID, PROVIDER_MESSAGE_ID]
  )
}

beforeEach(seed, 20000)
afterAll(async () => {
  await pool.query(`DELETE FROM whatsapp_message_status_events WHERE provider_message_id = $1`, [PROVIDER_MESSAGE_ID])
  await pool.query(`DELETE FROM whatsapp_messages WHERE order_id = $1`, [ORDER_ID])
  await pool.query(`DELETE FROM orders WHERE id = $1`, [ORDER_ID])
  await pool.end()
})

describe('GET /api/webhooks/whatsapp — verification handshake', () => {
  it('echoes hub.challenge when the verify token matches', async () => {
    const res = await request(app).get('/api/webhooks/whatsapp').query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'test-webhook-verify-token', 'hub.challenge': '12345' })
    expect(res.status).toBe(200)
    expect(res.text).toBe('12345')
  })

  it('rejects a wrong verify token', async () => {
    const res = await request(app).get('/api/webhooks/whatsapp').query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong', 'hub.challenge': '12345' })
    expect(res.status).toBe(403)
  })
})

describe('POST /api/webhooks/whatsapp — signature verification', () => {
  it('accepts a correctly signed status payload and updates delivery_status', async () => {
    const payload = {
      entry: [{ changes: [{ value: { statuses: [{ id: PROVIDER_MESSAGE_ID, status: 'delivered', timestamp: String(Math.floor(Date.now() / 1000)), recipient_id: '201000000000' }] } }] }]
    }
    const rawBody = Buffer.from(JSON.stringify(payload))

    const res = await request(app)
      .post('/api/webhooks/whatsapp')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', sign(rawBody))
      .send(payload)
    expect(res.status).toBe(200)

    const { rows } = await pool.query<{ deliveryStatus: string }>(
      `SELECT delivery_status as "deliveryStatus" FROM whatsapp_messages WHERE provider_message_id = $1`, [PROVIDER_MESSAGE_ID]
    )
    expect(rows[0].deliveryStatus).toBe('delivered')
  })

  it('rejects a request with no signature header', async () => {
    const res = await request(app).post('/api/webhooks/whatsapp').send({ entry: [] })
    expect(res.status).toBe(401)
  })

  it('rejects a request with an invalid signature', async () => {
    const payload = { entry: [] }
    const res = await request(app)
      .post('/api/webhooks/whatsapp')
      .set('X-Hub-Signature-256', 'sha256=' + 'a'.repeat(64))
      .send(payload)
    expect(res.status).toBe(401)
  })

  it('rejects a payload that was tampered with after signing (raw body integrity)', async () => {
    const signed = Buffer.from(JSON.stringify({ entry: [] }))
    const validSignature = sign(signed)
    // بنبعت جسم مختلف عن اللي اتعمل عليه التوقيع — لازم يترفض حتى لو الجسم المُرسل شكله سليم.
    const res = await request(app)
      .post('/api/webhooks/whatsapp')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', validSignature)
      .send({ entry: [{ tampered: true }] })
    expect(res.status).toBe(401)
  })
})
