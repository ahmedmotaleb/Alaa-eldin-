// اختبارات sendOrderConfirmationWhatsApp في حالة "مُفعّل فعلياً" (WHATSAPP_ACCESS_TOKEN/
// WHATSAPP_PHONE_NUMBER_ID متضبطين) — whatsappConfigured بيتحسب مرة واحدة وقت تحميل
// الموديول، فأي اختبار محتاج قيمة بيئة مختلفة لازم يضبط process.env الأول، بعدين
// vi.resetModules()، بعدين import ديناميكي جديد — نفس الأسلوب المتّبع في turnstileService.test.ts.
// fetch نفسها بتتقلّد بالكامل — مفيش أي اتصال حقيقي بـ Meta هنا أبداً.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import crypto from 'node:crypto'

const ORIGINAL_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN
const ORIGINAL_PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID

async function loadConfigured() {
  process.env.WHATSAPP_ACCESS_TOKEN = 'test-token'
  process.env.WHATSAPP_PHONE_NUMBER_ID = 'test-phone-id'
  vi.resetModules()
  const whatsappService = await import('./whatsappService.js')
  const { pool } = await import('../db.js')
  return { whatsappService, pool }
}

async function insertOrder(pool: import('pg').Pool, orderId: string, opts: { deliveryDate?: string | null; guestTrackingToken?: string | null } = {}) {
  await pool.query(
    `INSERT INTO orders (id, order_number, created_at, delivery_slot, delivery_date, payment_method, customer_full_name, customer_mobile,
                          customer_governorate, customer_address, subtotal, delivery_fee, total, status, discount_amount, guest_tracking_token)
     VALUES ($1, $1, now(), 'now', $2, 'COD', 'أحمد محمود', '01012345678', 'القاهرة', 'شارع التحرير 10', 150, 0, 150, 'placed', 0, $3)`,
    [orderId, opts.deliveryDate ?? null, opts.guestTrackingToken ?? null]
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
  if (ORIGINAL_TOKEN === undefined) delete process.env.WHATSAPP_ACCESS_TOKEN
  else process.env.WHATSAPP_ACCESS_TOKEN = ORIGINAL_TOKEN
  if (ORIGINAL_PHONE_ID === undefined) delete process.env.WHATSAPP_PHONE_NUMBER_ID
  else process.env.WHATSAPP_PHONE_NUMBER_ID = ORIGINAL_PHONE_ID
})

describe('sendOrderConfirmationWhatsApp — configured', () => {
  let orderId: string

  beforeEach(() => {
    orderId = `test-order-wa-confirm-${crypto.randomUUID()}`
  })

  afterAll(async () => {
    const { pool } = await import('../db.js')
    await pool.query('DELETE FROM whatsapp_messages WHERE order_id LIKE $1', ['test-order-wa-confirm-%'])
    await pool.query('DELETE FROM orders WHERE id LIKE $1', ['test-order-wa-confirm-%'])
    await pool.end()
  })

  it('sends a real confirmation with correctly substituted variables, Western digits, and a guest tracking URL', async () => {
    const { whatsappService, pool } = await loadConfigured()
    await insertOrder(pool, orderId, { deliveryDate: '2026-01-15', guestTrackingToken: 'guest-token-abc' })

    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ messages: [{ id: 'wamid.test123' }] }) })
    vi.stubGlobal('fetch', fetchMock)

    await whatsappService.sendOrderConfirmationWhatsApp({
      orderId,
      orderNumber: orderId,
      customerName: 'أحمد محمود',
      customerMobile: '01012345678',
      customerAddress: 'القاهرة - شارع التحرير 10',
      paymentMethod: 'COD',
      total: 150.5,
      deliveryDate: '2026-01-15',
      deliverySlotId: 'now',
      guestTrackingToken: 'guest-token-abc'
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/test-phone-id/messages')
    const sentBody = JSON.parse(options.body as string)
    expect(sentBody.to).toBe('201012345678') // 01012345678 -> 201012345678، مش الرقم الأصلي
    expect(sentBody.text.body).toContain('أحمد محمود')
    expect(sentBody.text.body).toContain('150.50')
    expect(sentBody.text.body).toContain('الدفع عند الاستلام')
    expect(sentBody.text.body).toContain('أقرب وقت (خلال ساعتين)') // تسمية الميعاد المُحلّلة من delivery_slots
    expect(sentBody.text.body).toContain('15 يناير 2026') // أرقام غربية بالكامل
    expect(sentBody.text.body).not.toMatch(/[٠-٩]/) // ولا رقم هندي-عربي واحد
    expect(sentBody.text.body).toContain(`/track/${encodeURIComponent(orderId)}?t=guest-token-abc`)

    const { rows } = await pool.query(
      `SELECT status, notification_type as "notificationType" FROM whatsapp_messages WHERE order_id = $1`, [orderId]
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('sent')
    expect(rows[0].notificationType).toBe('order_confirmation')
  })

  it('uses the account tracking URL (no token) when the order belongs to a registered customer', async () => {
    const { whatsappService, pool } = await loadConfigured()
    await insertOrder(pool, orderId, { guestTrackingToken: null })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ messages: [{ id: 'wamid.x' }] }) }))

    await whatsappService.sendOrderConfirmationWhatsApp({
      orderId, orderNumber: orderId, customerName: 'سارة', customerMobile: '01012345678',
      customerAddress: 'الجيزة - عنوان', paymentMethod: 'COD', total: 80,
      deliveryDate: null, deliverySlotId: 'evening', guestTrackingToken: null
    })

    const { rows } = await pool.query<{ body: string }>(`SELECT body FROM whatsapp_messages WHERE order_id = $1`, [orderId])
    expect(rows[0].body).toContain(`/track/${encodeURIComponent(orderId)}`)
    expect(rows[0].body).not.toContain('?t=')
    expect(rows[0].body).toContain('أقرب موعد متاح') // من غير تاريخ توصيل محدد
  })

  it('records a failed attempt on a provider error, without throwing', async () => {
    const { whatsappService, pool } = await loadConfigured()
    await insertOrder(pool, orderId)
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))

    await expect(whatsappService.sendOrderConfirmationWhatsApp({
      orderId, orderNumber: orderId, customerName: 'عميل', customerMobile: '01012345678',
      customerAddress: 'عنوان', paymentMethod: 'COD', total: 50,
      deliveryDate: null, deliverySlotId: 'now', guestTrackingToken: null
    })).resolves.toBeUndefined()

    const { rows } = await pool.query(`SELECT status, error FROM whatsapp_messages WHERE order_id = $1`, [orderId])
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('failed')
  })

  it('does not send a second automatic confirmation for the same order (idempotent)', async () => {
    const { whatsappService, pool } = await loadConfigured()
    await insertOrder(pool, orderId)
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ messages: [{ id: 'wamid.dup' }] }) })
    vi.stubGlobal('fetch', fetchMock)

    const input = {
      orderId, orderNumber: orderId, customerName: 'عميل', customerMobile: '01012345678',
      customerAddress: 'عنوان', paymentMethod: 'COD', total: 50,
      deliveryDate: null, deliverySlotId: 'now', guestTrackingToken: null
    }
    await whatsappService.sendOrderConfirmationWhatsApp(input)
    await whatsappService.sendOrderConfirmationWhatsApp(input) // محاكاة إعادة محاولة checkout/استرجاع idempotency key

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const { rows } = await pool.query(`SELECT count(*) as n FROM whatsapp_messages WHERE order_id = $1`, [orderId])
    expect(Number(rows[0].n)).toBe(1)
  })

  it('force=true (manual admin resend) bypasses the idempotency check and sends again', async () => {
    const { whatsappService, pool } = await loadConfigured()
    await insertOrder(pool, orderId)
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ messages: [{ id: 'wamid.resend' }] }) })
    vi.stubGlobal('fetch', fetchMock)

    const input = {
      orderId, orderNumber: orderId, customerName: 'عميل', customerMobile: '01012345678',
      customerAddress: 'عنوان', paymentMethod: 'COD', total: 50,
      deliveryDate: null, deliverySlotId: 'now', guestTrackingToken: null
    }
    await whatsappService.sendOrderConfirmationWhatsApp(input)
    await whatsappService.sendOrderConfirmationWhatsApp(input, true)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const { rows } = await pool.query(`SELECT count(*) as n FROM whatsapp_messages WHERE order_id = $1`, [orderId])
    expect(Number(rows[0].n)).toBe(2)
  })

  it('hasSentNotification reflects a real successful send', async () => {
    const { whatsappService, pool } = await loadConfigured()
    await insertOrder(pool, orderId)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ messages: [{ id: 'wamid.check' }] }) }))

    expect(await whatsappService.hasSentNotification(orderId, 'order_confirmation')).toBe(false)
    await whatsappService.sendOrderConfirmationWhatsApp({
      orderId, orderNumber: orderId, customerName: 'عميل', customerMobile: '01012345678',
      customerAddress: 'عنوان', paymentMethod: 'COD', total: 50,
      deliveryDate: null, deliverySlotId: 'now', guestTrackingToken: null
    })
    expect(await whatsappService.hasSentNotification(orderId, 'order_confirmation')).toBe(true)
  })
})
