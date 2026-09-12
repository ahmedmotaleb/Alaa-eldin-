import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { pool } from '../db.js'
import {
  listWhatsAppTemplates, createWhatsAppTemplate, updateWhatsAppTemplate,
  renderWhatsAppTemplate, sendWhatsAppMessage, listWhatsAppMessagesForOrder,
  whatsappConfigured
} from './whatsappService.js'

const TEMPLATE_NAME = 'test-template-whatsapp'

async function resetFixtures() {
  await pool.query('DELETE FROM whatsapp_templates WHERE name = $1', [TEMPLATE_NAME])
}

describe('whatsappService', () => {
  beforeEach(resetFixtures)
  afterAll(resetFixtures)

  it('renders {{variable}} placeholders with provided values', () => {
    const rendered = renderWhatsAppTemplate('مرحباً {{customerName}}، طلبك {{orderNumber}} جاهز.', {
      customerName: 'أحمد', orderNumber: 'ALA-100001'
    })
    expect(rendered).toBe('مرحباً أحمد، طلبك ALA-100001 جاهز.')
  })

  it('leaves a placeholder untouched when no value is provided for it', () => {
    const rendered = renderWhatsAppTemplate('مرحباً {{customerName}}، {{missingVar}}', { customerName: 'سارة' })
    expect(rendered).toBe('مرحباً سارة، {{missingVar}}')
  })

  it('creates and lists a whatsapp template', async () => {
    const created = await createWhatsAppTemplate({ name: TEMPLATE_NAME, category: 'custom', content: 'نص تجريبي', active: true })
    expect(created.name).toBe(TEMPLATE_NAME)
    expect(created.active).toBe(true)

    const templates = await listWhatsAppTemplates()
    expect(templates.find(t => t.id === created.id)?.content).toBe('نص تجريبي')
  })

  it('updates an existing template in place', async () => {
    const created = await createWhatsAppTemplate({ name: TEMPLATE_NAME, category: 'custom', content: 'قديم', active: true })
    const updated = await updateWhatsAppTemplate(created.id, { name: TEMPLATE_NAME, category: 'custom', content: 'جديد', active: false })
    expect(updated?.content).toBe('جديد')
    expect(updated?.active).toBe(false)
  })

  it('returns null when updating a non-existent template', async () => {
    const result = await updateWhatsAppTemplate('does-not-exist', { name: 'x', category: 'custom', content: 'x', active: true })
    expect(result).toBeNull()
  })

  it('rejects sending to an invalid (non-Egyptian) mobile number', async () => {
    const result = await sendWhatsAppMessage({ toNumber: '12345', body: 'test', createdByUserId: 'someone' })
    expect(result).toEqual({ ok: false, reason: 'invalid_number' })
  })

  // بيئة الاختبار دي مالهاش بيانات اعتماد WhatsApp Business API حقيقية (WHATSAPP_ACCESS_TOKEN/
  // WHATSAPP_PHONE_NUMBER_ID) — فده بيتأكد فعلياً إن whatsappConfigured=false هنا، وإن
  // sendWhatsAppMessage بترفض الإرسال الفعلي بأمان بدل ما تحاول تتصل بـ API من غير توكن.
  // الإرسال الفعلي الناجح مينفعش يتفحص بدون بيانات اعتماد حقيقية — نفس تحفظ Cloudinary
  // في imageStorageService.ts.
  it('reports whatsapp as not configured in this environment (no real API credentials)', () => {
    expect(whatsappConfigured).toBe(false)
  })

  it('short-circuits to whatsapp_not_configured without hitting the network when unconfigured', async () => {
    const result = await sendWhatsAppMessage({ toNumber: '01012345678', body: 'test', createdByUserId: 'someone' })
    expect(result).toEqual({ ok: false, reason: 'whatsapp_not_configured' })
  })

  it('returns an empty message log for an order with no whatsapp activity', async () => {
    const messages = await listWhatsAppMessagesForOrder('non-existent-order-id')
    expect(messages).toEqual([])
  })
})
