// اختبارات حقيقية لخدمة webhook حالة تسليم واتساب — تحقق التوقيع (HMAC-SHA256 على البايتات
// الخام)، ومعالجة الحمولة (idempotency ضد إعادة تسليم Meta، وحماية من الترتيب العكسي).
//
// whatsappWebhookConfigured بيتحسب وقت تحميل الموديول، فلازم نضبط متغيرات البيئة قبل ما نعمل
// import — نفس الأسلوب المتّبع في captchaRoutes.test.ts.
import crypto from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

process.env.WHATSAPP_APP_SECRET = 'test-app-secret'
process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = 'test-verify-token'

const { pool } = await import('../db.js')
const {
  verifyWebhookVerifyToken, verifyWebhookSignature, processStatusWebhookPayload, whatsappWebhookConfigured
} = await import('./whatsappWebhookService.js')

const PREFIX = 'wawh-'
const ORDER_ID = `${PREFIX}order`
const PROVIDER_MESSAGE_ID = `${PREFIX}wamid.test123`

function sign(body: object): { raw: Buffer, header: string } {
  const raw = Buffer.from(JSON.stringify(body))
  const header = 'sha256=' + crypto.createHmac('sha256', 'test-app-secret').update(raw).digest('hex')
  return { raw, header }
}

function statusPayload(status: string, timestamp: number, extra: Record<string, unknown> = {}) {
  return {
    entry: [{
      id: 'waba-id',
      changes: [{
        value: { statuses: [{ id: PROVIDER_MESSAGE_ID, status, timestamp: String(timestamp), recipient_id: '201000000000', ...extra }] }
      }]
    }]
  }
}

async function seedMessage() {
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
     VALUES ($1, $2, '201000000000', 'نص الرسالة', 'sent', $3, now())`,
    [`${PREFIX}msg`, ORDER_ID, PROVIDER_MESSAGE_ID]
  )
}

beforeEach(seedMessage, 20000)
afterAll(async () => {
  await pool.query(`DELETE FROM whatsapp_message_status_events WHERE provider_message_id = $1`, [PROVIDER_MESSAGE_ID])
  await pool.query(`DELETE FROM whatsapp_messages WHERE order_id = $1`, [ORDER_ID])
  await pool.query(`DELETE FROM orders WHERE id = $1`, [ORDER_ID])
  await pool.end()
})

describe('whatsappWebhookConfigured', () => {
  it('is true when both env vars are set', () => {
    expect(whatsappWebhookConfigured).toBe(true)
  })
})

describe('verifyWebhookVerifyToken', () => {
  it('accepts the correct mode and token', () => {
    expect(verifyWebhookVerifyToken('subscribe', 'test-verify-token')).toBe(true)
  })
  it('rejects a wrong token', () => {
    expect(verifyWebhookVerifyToken('subscribe', 'wrong-token')).toBe(false)
  })
  it('rejects a wrong mode', () => {
    expect(verifyWebhookVerifyToken('unsubscribe', 'test-verify-token')).toBe(false)
  })
})

describe('verifyWebhookSignature', () => {
  it('accepts a correctly signed body', () => {
    const { raw, header } = sign({ hello: 'world' })
    expect(verifyWebhookSignature(raw, header)).toBe(true)
  })
  it('rejects a tampered body', () => {
    const { header } = sign({ hello: 'world' })
    expect(verifyWebhookSignature(Buffer.from(JSON.stringify({ hello: 'tampered' })), header)).toBe(false)
  })
  it('rejects a missing signature header', () => {
    const { raw } = sign({ hello: 'world' })
    expect(verifyWebhookSignature(raw, undefined)).toBe(false)
  })
  it('rejects a signature computed with the wrong secret', () => {
    const raw = Buffer.from(JSON.stringify({ hello: 'world' }))
    const wrongHeader = 'sha256=' + crypto.createHmac('sha256', 'wrong-secret').update(raw).digest('hex')
    expect(verifyWebhookSignature(raw, wrongHeader)).toBe(false)
  })
})

describe('processStatusWebhookPayload', () => {
  it('records a status event and updates whatsapp_messages.delivery_status', async () => {
    const now = Math.floor(Date.now() / 1000)
    const result = await processStatusWebhookPayload(statusPayload('delivered', now))
    expect(result).toEqual({ processed: 1, skipped: 0 })

    const { rows } = await pool.query<{ deliveryStatus: string }>(
      `SELECT delivery_status as "deliveryStatus" FROM whatsapp_messages WHERE provider_message_id = $1`, [PROVIDER_MESSAGE_ID]
    )
    expect(rows[0].deliveryStatus).toBe('delivered')

    const { rows: eventRows } = await pool.query(
      `SELECT status FROM whatsapp_message_status_events WHERE provider_message_id = $1`, [PROVIDER_MESSAGE_ID]
    )
    expect(eventRows).toHaveLength(1)
  })

  it('is idempotent — processing the exact same event twice only records it once', async () => {
    const now = Math.floor(Date.now() / 1000)
    await processStatusWebhookPayload(statusPayload('sent', now))
    const second = await processStatusWebhookPayload(statusPayload('sent', now))
    expect(second).toEqual({ processed: 0, skipped: 1 })

    const { rows } = await pool.query(`SELECT id FROM whatsapp_message_status_events WHERE provider_message_id = $1`, [PROVIDER_MESSAGE_ID])
    expect(rows).toHaveLength(1)
  })

  it('never regresses delivery_status when an older event arrives out of order', async () => {
    const t1 = Math.floor(Date.now() / 1000)
    const t2 = t1 + 60
    // "read" (الأحدث) بيوصل الأول، وبعدين "sent" (الأقدم زمنياً) بيوصل متأخر — سيناريو
    // ترتيب توصيل عكسي حقيقي وارد من Meta.
    await processStatusWebhookPayload(statusPayload('read', t2))
    await processStatusWebhookPayload(statusPayload('sent', t1))

    const { rows } = await pool.query<{ deliveryStatus: string }>(
      `SELECT delivery_status as "deliveryStatus" FROM whatsapp_messages WHERE provider_message_id = $1`, [PROVIDER_MESSAGE_ID]
    )
    expect(rows[0].deliveryStatus).toBe('read')
  })

  it('records a failed status with error details in the raw payload', async () => {
    const now = Math.floor(Date.now() / 1000)
    const result = await processStatusWebhookPayload(statusPayload('failed', now, { errors: [{ code: 131047, title: 'Message failed to send' }] }))
    expect(result).toEqual({ processed: 1, skipped: 0 })

    const { rows } = await pool.query<{ errorCode: string, errorTitle: string }>(
      `SELECT error_code as "errorCode", error_title as "errorTitle" FROM whatsapp_message_status_events WHERE provider_message_id = $1`,
      [PROVIDER_MESSAGE_ID]
    )
    expect(rows[0].errorCode).toBe('131047')
    expect(rows[0].errorTitle).toBe('Message failed to send')
  })

  it('skips malformed entries without throwing', async () => {
    const result = await processStatusWebhookPayload({ entry: [{ changes: [{ value: { statuses: [{ status: 'delivered' }] } }] }] })
    expect(result).toEqual({ processed: 0, skipped: 1 })
  })

  it('does nothing for a payload with no matching provider_message_id in whatsapp_messages', async () => {
    const now = Math.floor(Date.now() / 1000)
    const result = await processStatusWebhookPayload({
      entry: [{ changes: [{ value: { statuses: [{ id: 'does-not-exist', status: 'delivered', timestamp: String(now) }] } }] }]
    })
    expect(result).toEqual({ processed: 1, skipped: 0 })
  })
})
