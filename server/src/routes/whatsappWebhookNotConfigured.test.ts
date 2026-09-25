// اختبار منفصل عمداً (بدون ضبط WHATSAPP_APP_SECRET/WHATSAPP_WEBHOOK_VERIFY_TOKEN) — الحالة
// الافتراضية الحالية في الإنتاج (المتغيرات لسه مش متضبطة). المسار لازم يرجع 404 عادي في
// الحالتين (GET وPOST)، من غير أي تلميح لوجود مسار حساس أو محاولة تحقق توقيع فعلية.
import { describe, expect, it, afterAll } from 'vitest'
import request from 'supertest'
import { app } from '../app.js'
import { pool } from '../db.js'

afterAll(async () => { await pool.end() })

describe('WhatsApp webhook — not configured (default state)', () => {
  it('GET returns 404 without configuration', async () => {
    const res = await request(app).get('/api/webhooks/whatsapp').query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'anything', 'hub.challenge': '1' })
    expect(res.status).toBe(404)
  })

  it('POST returns 404 without configuration, even with no signature at all', async () => {
    const res = await request(app).post('/api/webhooks/whatsapp').send({ entry: [] })
    expect(res.status).toBe(404)
  })
})
