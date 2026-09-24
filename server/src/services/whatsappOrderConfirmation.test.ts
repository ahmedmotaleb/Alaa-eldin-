// اختبارات sendOrderConfirmationWhatsApp في حالة "مُفعّل فعلياً" (WHATSAPP_ACCESS_TOKEN/
// WHATSAPP_PHONE_NUMBER_ID/WHATSAPP_ORDER_CONFIRMATION_TEMPLATE متضبطين) — whatsappConfigured
// وWHATSAPP_ORDER_CONFIRMATION_TEMPLATE بيتحسبوا مرة واحدة وقت تحميل الموديول، فأي اختبار
// محتاج قيمة بيئة مختلفة لازم يضبط process.env الأول، بعدين vi.resetModules()، بعدين import
// ديناميكي جديد — نفس الأسلوب المتّبع في turnstileService.test.ts. fetch نفسها بتتقلّد
// بالكامل — مفيش أي اتصال حقيقي بـ Meta هنا أبداً.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import crypto from 'node:crypto'

const ORIGINAL_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN
const ORIGINAL_PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID
const ORIGINAL_TEMPLATE = process.env.WHATSAPP_ORDER_CONFIRMATION_TEMPLATE

async function loadConfigured() {
  process.env.WHATSAPP_ACCESS_TOKEN = 'test-token'
  process.env.WHATSAPP_PHONE_NUMBER_ID = 'test-phone-id'
  process.env.WHATSAPP_ORDER_CONFIRMATION_TEMPLATE = 'order_confirmation_ar'
  vi.resetModules()
  const whatsappService = await import('./whatsappService.js')
  const deliveryService = await import('./whatsappNotificationDeliveryService.js')
  const { pool } = await import('../db.js')
  return { whatsappService, deliveryService, pool }
}

const MANUAL_ACTOR_USER_ID = 'test-wa-confirm-admin-user'

// created_by_user_id في whatsapp_messages مربوط بـ FK حقيقي على users(id) — أي إرسال
// يدوي في الاختبارات محتاج مستخدم فعلي موجود، مش أي نص عشوائي.
async function ensureManualActorUser(pool: import('pg').Pool) {
  await pool.query(
    `INSERT INTO users (id, email, password_hash, full_name, created_at, is_admin)
     VALUES ($1, $2, 'x', 'أدمن اختبار', now(), 1)
     ON CONFLICT (id) DO NOTHING`,
    [MANUAL_ACTOR_USER_ID, `${MANUAL_ACTOR_USER_ID}@test.local`]
  )
}

async function insertOrder(pool: import('pg').Pool, orderId: string, opts: { deliveryDate?: string | null; guestTrackingToken?: string | null } = {}) {
  await pool.query(
    `INSERT INTO orders (id, order_number, created_at, delivery_slot, delivery_date, payment_method, customer_full_name, customer_mobile,
                          customer_governorate, customer_address, subtotal, delivery_fee, total, status, discount_amount, guest_tracking_token)
     VALUES ($1, $1, now(), 'now', $2, 'COD', 'أحمد محمود', '01012345678', 'القاهرة', 'شارع التحرير 10', 150, 0, 150, 'placed', 0, $3)`,
    [orderId, opts.deliveryDate ?? null, opts.guestTrackingToken ?? null]
  )
}

function confirmationInput(orderId: string, overrides: Record<string, unknown> = {}) {
  return {
    orderId, orderNumber: orderId, customerName: 'عميل', customerMobile: '01012345678',
    customerAddress: 'عنوان', paymentMethod: 'COD', total: 50,
    deliveryDate: null, deliverySlotId: 'now', guestTrackingToken: null,
    ...overrides
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
  if (ORIGINAL_TOKEN === undefined) delete process.env.WHATSAPP_ACCESS_TOKEN
  else process.env.WHATSAPP_ACCESS_TOKEN = ORIGINAL_TOKEN
  if (ORIGINAL_PHONE_ID === undefined) delete process.env.WHATSAPP_PHONE_NUMBER_ID
  else process.env.WHATSAPP_PHONE_NUMBER_ID = ORIGINAL_PHONE_ID
  if (ORIGINAL_TEMPLATE === undefined) delete process.env.WHATSAPP_ORDER_CONFIRMATION_TEMPLATE
  else process.env.WHATSAPP_ORDER_CONFIRMATION_TEMPLATE = ORIGINAL_TEMPLATE
})

describe('sendOrderConfirmationWhatsApp — configured', () => {
  let orderId: string

  beforeEach(() => {
    orderId = `test-order-wa-confirm-${crypto.randomUUID()}`
  })

  afterAll(async () => {
    const { pool } = await import('../db.js')
    await pool.query('DELETE FROM whatsapp_messages WHERE order_id LIKE $1', ['test-order-wa-confirm-%'])
    await pool.query('DELETE FROM whatsapp_notification_deliveries WHERE order_id LIKE $1', ['test-order-wa-confirm-%'])
    await pool.query('DELETE FROM orders WHERE id LIKE $1', ['test-order-wa-confirm-%'])
    await pool.query('DELETE FROM users WHERE id = $1', [MANUAL_ACTOR_USER_ID])
    await pool.end()
  })

  it('sends a real Meta template message with correctly substituted parameters, Western digits, and a guest tracking URL suffix', async () => {
    const { whatsappService, pool } = await loadConfigured()
    await insertOrder(pool, orderId, { deliveryDate: '2026-01-15', guestTrackingToken: 'guest-token-abc' })

    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ messages: [{ id: 'wamid.test123' }] }) })
    vi.stubGlobal('fetch', fetchMock)

    await whatsappService.sendOrderConfirmationWhatsApp(confirmationInput(orderId, {
      customerName: 'أحمد محمود', customerAddress: 'القاهرة - شارع التحرير 10', total: 150.5,
      deliveryDate: '2026-01-15', guestTrackingToken: 'guest-token-abc'
    }))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/test-phone-id/messages')
    const sentBody = JSON.parse(options.body as string)
    expect(sentBody.to).toBe('201012345678') // 01012345678 -> 201012345678، مش الرقم الأصلي
    expect(sentBody.type).toBe('template')
    expect(sentBody.template.name).toBe('order_confirmation_ar')
    expect(sentBody.template.language.code).toBe('ar')

    const bodyComponent = sentBody.template.components.find((c: { type: string }) => c.type === 'body')
    const bodyTexts = bodyComponent.parameters.map((p: { text: string }) => p.text)
    expect(bodyTexts).toContain('أحمد محمود')
    expect(bodyTexts).toContain(orderId)
    expect(bodyTexts).toContain('150.50')
    expect(bodyTexts).toContain('الدفع عند الاستلام')
    expect(bodyTexts.some((t: string) => t.includes('15 يناير 2026'))).toBe(true) // أرقام غربية بالكامل
    expect(bodyTexts.some((t: string) => t.includes('أقرب وقت (خلال ساعتين)'))).toBe(true) // تسمية الميعاد
    expect(bodyTexts.join(' ')).not.toMatch(/[٠-٩]/) // ولا رقم هندي-عربي واحد

    const buttonComponent = sentBody.template.components.find((c: { type: string }) => c.type === 'button')
    expect(buttonComponent.sub_type).toBe('url')
    expect(buttonComponent.parameters[0].text).toBe(`${encodeURIComponent(orderId)}?t=guest-token-abc`)

    const { rows } = await pool.query(
      `SELECT status, notification_type as "notificationType", template_id as "templateId", created_by_user_id as "createdByUserId"
       FROM whatsapp_messages WHERE order_id = $1`, [orderId]
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('sent')
    expect(rows[0].notificationType).toBe('order_confirmation')
    expect(rows[0].templateId).toBeNull() // مُرسل عبر قالب Meta المعتمد، مش القالب الداخلي
    expect(rows[0].createdByUserId).toBeNull() // إرسال تلقائي بحت، بلا فاعل بشري
  })

  it('uses the account tracking URL suffix (no token) when the order belongs to a registered customer', async () => {
    const { whatsappService, pool } = await loadConfigured()
    await insertOrder(pool, orderId, { guestTrackingToken: null })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ messages: [{ id: 'wamid.x' }] }) }))

    await whatsappService.sendOrderConfirmationWhatsApp(confirmationInput(orderId, {
      customerName: 'سارة', customerAddress: 'الجيزة - عنوان', total: 80, deliverySlotId: 'evening'
    }))

    const { rows } = await pool.query<{ body: string }>(`SELECT body FROM whatsapp_messages WHERE order_id = $1`, [orderId])
    expect(rows[0].body).toContain(`/track/${encodeURIComponent(orderId)}`)
    expect(rows[0].body).not.toContain('?t=')
    expect(rows[0].body).toContain('أقرب موعد متاح') // من غير تاريخ توصيل محدد (previewBody الداخلي)
  })

  it('records a failed attempt on a provider network error, without throwing', async () => {
    const { whatsappService, pool } = await loadConfigured()
    await insertOrder(pool, orderId)
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))

    await expect(whatsappService.sendOrderConfirmationWhatsApp(confirmationInput(orderId)))
      .resolves.toBeUndefined()

    const { rows } = await pool.query(`SELECT status, error FROM whatsapp_messages WHERE order_id = $1`, [orderId])
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('failed')
  })

  it('does not send a second automatic confirmation for the same order (idempotent)', async () => {
    const { whatsappService, pool } = await loadConfigured()
    await insertOrder(pool, orderId)
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ messages: [{ id: 'wamid.dup' }] }) })
    vi.stubGlobal('fetch', fetchMock)

    const input = confirmationInput(orderId)
    await whatsappService.sendOrderConfirmationWhatsApp(input)
    await whatsappService.sendOrderConfirmationWhatsApp(input) // محاكاة إعادة محاولة checkout/استرجاع idempotency key

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const { rows } = await pool.query(`SELECT count(*) as n FROM whatsapp_messages WHERE order_id = $1`, [orderId])
    expect(Number(rows[0].n)).toBe(1)
  })

  // اختبار تزامن حقيقي (متطلب "F/G" — راجع مواصفة 13A-13Q): تشغيلتين متزامنتين فعلياً (Promise.all،
  // مش استدعاء تتابعي) على نفس الطلب بالظبط — محاكاة نسختين من السيرفر (Railway) استلموا نفس
  // نقطة النهاية في نفس اللحظة. الضمان كله من PostgreSQL (UNIQUE + WHERE الذرّي في
  // whatsappNotificationDeliveryService.ts)، مفيش أي قفل/mutex في كود JavaScript هنا أبداً.
  it('under true concurrency (Promise.all, same order), exactly one automatic Meta send happens', async () => {
    const { whatsappService, pool } = await loadConfigured()
    await insertOrder(pool, orderId)
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ messages: [{ id: 'wamid.race' }] }) })
    vi.stubGlobal('fetch', fetchMock)

    const input = confirmationInput(orderId)
    await Promise.all([
      whatsappService.sendOrderConfirmationWhatsApp(input),
      whatsappService.sendOrderConfirmationWhatsApp(input)
    ])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const { rows } = await pool.query(`SELECT count(*) as n FROM whatsapp_messages WHERE order_id = $1`, [orderId])
    expect(Number(rows[0].n)).toBe(1)
  })

  it('manualActorUserId (admin resend) bypasses the ownership check, sends again, and records the acting admin', async () => {
    const { whatsappService, pool } = await loadConfigured()
    await insertOrder(pool, orderId)
    await ensureManualActorUser(pool)
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ messages: [{ id: 'wamid.resend' }] }) })
    vi.stubGlobal('fetch', fetchMock)

    const input = confirmationInput(orderId)
    await whatsappService.sendOrderConfirmationWhatsApp(input) // تلقائي
    await whatsappService.sendOrderConfirmationWhatsApp(input, { manualActorUserId: MANUAL_ACTOR_USER_ID }) // يدوي

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const { rows } = await pool.query<{ createdByUserId: string | null }>(
      `SELECT created_by_user_id as "createdByUserId" FROM whatsapp_messages WHERE order_id = $1 ORDER BY created_at ASC`,
      [orderId]
    )
    expect(rows).toHaveLength(2)
    expect(rows[0].createdByUserId).toBeNull() // التلقائي
    expect(rows[1].createdByUserId).toBe(MANUAL_ACTOR_USER_ID) // اليدوي — هوية الأدمن الفاعل الحقيقية
  })

  it('a manual resend never mutates the automatic logical notification row back to pending', async () => {
    const { whatsappService, deliveryService, pool } = await loadConfigured()
    await insertOrder(pool, orderId)
    await ensureManualActorUser(pool)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ messages: [{ id: 'wamid.x' }] }) }))

    const input = confirmationInput(orderId)
    await whatsappService.sendOrderConfirmationWhatsApp(input)
    const beforeStatus = await deliveryService.getAutomaticNotificationStatus(orderId, 'order_confirmation')
    expect(beforeStatus?.status).toBe('sent')

    await whatsappService.sendOrderConfirmationWhatsApp(input, { manualActorUserId: MANUAL_ACTOR_USER_ID })
    const afterStatus = await deliveryService.getAutomaticNotificationStatus(orderId, 'order_confirmation')
    expect(afterStatus?.status).toBe('sent') // لسه 'sent'، مش 'pending' تاني
    expect(afterStatus?.updatedAt).toBe(beforeStatus?.updatedAt) // نفس الصف بالظبط، ما اتلمسش
  })

  it('getAutomaticNotificationStatus reflects the real ownership row lifecycle', async () => {
    const { whatsappService, deliveryService, pool } = await loadConfigured()
    await insertOrder(pool, orderId)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ messages: [{ id: 'wamid.check' }] }) }))

    expect(await deliveryService.getAutomaticNotificationStatus(orderId, 'order_confirmation')).toBeNull()
    await whatsappService.sendOrderConfirmationWhatsApp(confirmationInput(orderId))
    const status = await deliveryService.getAutomaticNotificationStatus(orderId, 'order_confirmation')
    expect(status?.status).toBe('sent')
    expect(status?.providerMessageId).toBe('wamid.check')
  })
})

describe('retryFailedOrderConfirmations (whatsapp:retry-confirmations cron script)', () => {
  let orderId: string

  beforeEach(() => {
    orderId = `test-order-wa-confirm-${crypto.randomUUID()}`
  })

  afterAll(async () => {
    const { pool } = await import('../db.js')
    await pool.query('DELETE FROM whatsapp_messages WHERE order_id LIKE $1', ['test-order-wa-confirm-%'])
    await pool.query('DELETE FROM whatsapp_notification_deliveries WHERE order_id LIKE $1', ['test-order-wa-confirm-%'])
    await pool.query('DELETE FROM orders WHERE id LIKE $1', ['test-order-wa-confirm-%'])
    await pool.end()
  })

  // بند 16 من المواصفة: فشل مزوّد مؤقت مؤكد (Meta بترجع 500 صراحة) — failure_class='retryable'،
  // وسكربت إعادة المحاولة الدوري لازم يقدر يعيد المحاولة وينجح لما المزوّد يرجع يشتغل.
  it('retries a retryable (Meta 5xx) failed confirmation and succeeds once the provider recovers', async () => {
    const { whatsappService, deliveryService, pool } = await loadConfigured()
    await insertOrder(pool, orderId)

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: { message: 'internal_error' } }) }))
    await whatsappService.sendOrderConfirmationWhatsApp(confirmationInput(orderId))
    const afterFirstAttempt = await deliveryService.getAutomaticNotificationStatus(orderId, 'order_confirmation')
    expect(afterFirstAttempt?.status).toBe('failed')
    expect(afterFirstAttempt?.failureClass).toBe('retryable')
    expect(afterFirstAttempt?.attemptCount).toBe(1)

    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ messages: [{ id: 'wamid.retry-ok' }] }) })
    vi.stubGlobal('fetch', fetchMock)

    const result = await whatsappService.retryFailedOrderConfirmations(20)
    expect(result.attempted).toBeGreaterThanOrEqual(1)
    expect(result.sent).toBeGreaterThanOrEqual(1)
    expect(fetchMock).toHaveBeenCalledTimes(1) // محاولة واحدة بس اتبعتت فعلياً للمزوّد

    const after = await deliveryService.getAutomaticNotificationStatus(orderId, 'order_confirmation')
    expect(after?.status).toBe('sent')
    expect(after?.attemptCount).toBe(2) // محاولة أولى فاشلة + محاولة إعادة واحدة ناجحة

    const { rows } = await pool.query(`SELECT count(*) as n FROM whatsapp_messages WHERE order_id = $1 AND status = 'sent'`, [orderId])
    expect(Number(rows[0].n)).toBe(1)
  })

  it('does not retry a permanently-failed confirmation (invalid mobile number)', async () => {
    const { whatsappService, deliveryService, pool } = await loadConfigured()
    await pool.query(
      `INSERT INTO orders (id, order_number, created_at, delivery_slot, delivery_date, payment_method, customer_full_name, customer_mobile,
                            customer_governorate, customer_address, subtotal, delivery_fee, total, status, discount_amount, guest_tracking_token)
       VALUES ($1, $1, now(), 'now', NULL, 'COD', 'عميل', '0000', 'القاهرة', 'عنوان', 50, 0, 50, 'placed', 0, NULL)`,
      [orderId]
    )
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await whatsappService.sendOrderConfirmationWhatsApp(confirmationInput(orderId, { customerMobile: '0000' }))
    expect(fetchMock).not.toHaveBeenCalled() // رقم غير صالح — اترفض قبل أي اتصال بالمزوّد أصلاً

    const status = await deliveryService.getAutomaticNotificationStatus(orderId, 'order_confirmation')
    expect(status?.failureClass).toBe('permanent')

    const result = await whatsappService.retryFailedOrderConfirmations(20)
    const retriedThisOrder = result.attempted > 0 && fetchMock.mock.calls.length > 0
    expect(retriedThisOrder).toBe(false) // خطأ دائم (permanent) — مش في نطاق إعادة المحاولة

    // بند 17: نفس القاعدة لازم تتفرض من طبقة الملكية نفسها مباشرة، مش بس من فلترة السكربت.
    const directClaim = await deliveryService.claimAutomaticNotification(orderId, 'order_confirmation')
    expect(directClaim).toEqual({ claimed: false, reason: 'not_retryable' })
  })

  // بند 14 من المواصفة: نتيجة "unknown" (خطأ شبكة/تايم آوت قبل استلام أي رد من Meta) —
  // Meta ممكن تكون استلمت الرسالة الأصلية فعلاً، فسكربت إعادة المحاولة الدوري ممنوع يمسها
  // خالص — عشان مايتسببش في تأكيد مكرر فعلي للعميل.
  it('never retries a network-timeout ("unknown") confirmation, even repeatedly', async () => {
    const { whatsappService, deliveryService, pool } = await loadConfigured()
    await insertOrder(pool, orderId)

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    await whatsappService.sendOrderConfirmationWhatsApp(confirmationInput(orderId))
    const afterFirstAttempt = await deliveryService.getAutomaticNotificationStatus(orderId, 'order_confirmation')
    expect(afterFirstAttempt?.status).toBe('failed')
    expect(afterFirstAttempt?.failureClass).toBe('unknown')
    expect(afterFirstAttempt?.attemptCount).toBe(1)

    // المزوّد بقى شغّال دلوقتي فرضاً — بس ده مش بيفرق، النتيجة السابقة لسه "غير مؤكدة".
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ messages: [{ id: 'wamid.should-not-happen' }] }) })
    vi.stubGlobal('fetch', fetchMock)

    await whatsappService.retryFailedOrderConfirmations(20)
    expect(fetchMock).not.toHaveBeenCalled() // الكرون ممنوع يتصل بـ Meta تاني لنتيجة غير مؤكدة

    const after = await deliveryService.getAutomaticNotificationStatus(orderId, 'order_confirmation')
    expect(after?.status).toBe('failed') // فضل زي ما هو، مش 'sent' ولا 'pending'
    expect(after?.failureClass).toBe('unknown')
    expect(after?.attemptCount).toBe(1) // مفيش زيادة في عدد المحاولات خالص

    const { rows } = await pool.query(`SELECT count(*) as n FROM whatsapp_messages WHERE order_id = $1`, [orderId])
    expect(Number(rows[0].n)).toBe(1) // مفيش محاولة إرسال تانية اتسجّلت خالص

    // بند 17: طلب ادّعاء ملكية مباشر لازم يترفض بنفس السبب، مش بس فلترة السكربت.
    const directClaim = await deliveryService.claimAutomaticNotification(orderId, 'order_confirmation')
    expect(directClaim).toEqual({ claimed: false, reason: 'not_retryable' })
  })
})
