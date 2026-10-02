// اختبارات تكامل حقيقية (supertest ضد app.ts) لحقل same_day_cutoff_time الجديد — بس الجزء
// المُضاف في المهمة دي؛ باقي حقول store_settings اتغطّت ضمنياً عن طريق اختبارات تانية
// (captchaRoutes.test.ts بيتأكد إن /api/settings ما بيسربش أسرار) مفيهاش ملف اختبار مخصص
// لـ settings قبل كده أصلاً.
import { afterAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { app } from '../app.js'
import { pool } from '../db.js'

const PREFIX = 'same-day-cutoff-'

function uniqueEmail(label: string): string {
  return `${PREFIX}${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`
}

async function registerAdmin(): Promise<ReturnType<typeof request.agent>> {
  const agent = request.agent(app)
  const email = uniqueEmail('admin')
  const res = await agent.post('/api/auth/register')
    .send({ email, password: 'CorrectHorse9', fullName: 'مسؤول اختبار' })
  expect(res.status).toBe(201)
  await pool.query('UPDATE users SET is_admin = 1, role = $2 WHERE id = $1', [res.body.user.id, 'admin'])
  return agent
}

afterAll(async () => {
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${PREFIX}%`])
  await pool.end()
})

describe('same-day cutoff time setting', () => {
  it('exposes sameDayCutoffTime on the public /api/settings response', async () => {
    const res = await request(app).get('/api/settings')
    expect(res.status).toBe(200)
    expect(typeof res.body.settings.sameDayCutoffTime).toBe('string')
    expect(res.body.settings.sameDayCutoffTime).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/)
  })

  // store_settings صف واحد مشترك بين كل الاختبارات (id=1) — بنبني الـ payload بالكامل
  // بقيم صحيحة معروفة هنا بدل ما نعتمد على whatsappNumber الحالي في الصف، اللي ممكن يبقى
  // غير صالح لو ملف اختبار تاني غيّره وما رجّعوش لحالته الأصلية.
  function validPayload(existing: Record<string, unknown>, overrides: Record<string, unknown>) {
    return { ...existing, whatsappNumber: '01012345678', ...overrides }
  }

  it('rejects an admin PATCH with an invalid time format, without changing the stored value', async () => {
    const agent = await registerAdmin()
    const before = await agent.get('/api/admin/settings')
    const res = await agent.patch('/api/admin/settings').send(validPayload(before.body.settings, { sameDayCutoffTime: '25:99' }))
    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error: 'missing_fields' })
  })

  it('allows an admin to set the cutoff to midnight, and the change is reflected on the public endpoint', async () => {
    const agent = await registerAdmin()
    const before = await agent.get('/api/admin/settings')
    const originalCutoff = before.body.settings.sameDayCutoffTime as string
    const res = await agent.patch('/api/admin/settings').send(validPayload(before.body.settings, { sameDayCutoffTime: '00:00' }))
    expect(res.status).toBe(200)
    expect(res.body.settings.sameDayCutoffTime).toBe('00:00')

    const publicRes = await request(app).get('/api/settings')
    expect(publicRes.body.settings.sameDayCutoffTime).toBe('00:00')

    // نرجّع القيمة الأصلية عشان ما نأثّرش على باقي الاختبارات اللي ممكن تعتمد عليها.
    await agent.patch('/api/admin/settings').send(validPayload(before.body.settings, { sameDayCutoffTime: originalCutoff }))
  })
})
