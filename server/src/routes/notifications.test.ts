// اختبارات HTTP حقيقية لمسارات /api/notifications/admin-* — بتغطي إن حساب عميل عادي (حتى
// لو مسجّل دخول) ميقدرش يقرأ أو يعدّل التفضيل الإداري أو يبعت إشعار تجريبي، وإن الأدمن يقدر.
import { afterAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { app } from '../app.js'
import { pool } from '../db.js'

const PREFIX = 'anotif-'
const STRONG_PASSWORD = 'CorrectHorse9'

function uniqueEmail(label: string): string {
  return `${PREFIX}${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`
}

async function registerUser(email: string): Promise<{ agent: ReturnType<typeof request.agent>, userId: string }> {
  const agent = request.agent(app)
  const res = await agent.post('/api/auth/register').send({ email, password: STRONG_PASSWORD, fullName: 'مستخدم اختبار' })
  expect(res.status).toBe(201)
  return { agent, userId: res.body.user.id as string }
}

async function adminAgent(): Promise<{ agent: ReturnType<typeof request.agent>, userId: string }> {
  const { agent, userId } = await registerUser(uniqueEmail('admin'))
  await pool.query('UPDATE users SET is_admin = 1, role = $2, role_id = NULL WHERE id = $1', [userId, 'admin'])
  return { agent, userId }
}

afterAll(async () => {
  await pool.query('DELETE FROM push_subscriptions WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)', [`${PREFIX}%`])
  await pool.query('DELETE FROM notification_preferences WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)', [`${PREFIX}%`])
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${PREFIX}%`])
  await pool.end()
})

describe('GET/PATCH /api/notifications/admin-preferences', () => {
  it('rejects an unauthenticated request', async () => {
    const res = await request(app).get('/api/notifications/admin-preferences')
    expect(res.status).toBe(401)
  })

  it('rejects a plain customer account (not isAdmin)', async () => {
    const { agent } = await registerUser(uniqueEmail('customer'))
    const getRes = await agent.get('/api/notifications/admin-preferences')
    expect(getRes.status).toBe(403)
    const patchRes = await agent.patch('/api/notifications/admin-preferences').send({ newOrders: true })
    expect(patchRes.status).toBe(403)
  })

  it('defaults to newOrders=false for an admin with no saved preference', async () => {
    const { agent } = await adminAgent()
    const res = await agent.get('/api/notifications/admin-preferences')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ newOrders: false })
  })

  it('allows an admin to enable and then read back the preference', async () => {
    const { agent } = await adminAgent()
    const patchRes = await agent.patch('/api/notifications/admin-preferences').send({ newOrders: true })
    expect(patchRes.status).toBe(200)
    expect(patchRes.body).toEqual({ newOrders: true })

    const getRes = await agent.get('/api/notifications/admin-preferences')
    expect(getRes.body).toEqual({ newOrders: true })
  })

  it('a plain customer preference change never affects the separate admin preference', async () => {
    const { agent } = await adminAgent()
    await agent.patch('/api/notifications/preferences').send({ orderUpdates: false, promotions: true })
    const res = await agent.get('/api/notifications/admin-preferences')
    expect(res.body).toEqual({ newOrders: false })
  })

  it('rejects a non-boolean newOrders value', async () => {
    const { agent } = await adminAgent()
    const res = await agent.patch('/api/notifications/admin-preferences').send({ newOrders: 'yes' })
    expect(res.status).toBe(400)
  })
})

describe('POST /api/notifications/admin-test', () => {
  it('rejects a plain customer account', async () => {
    const { agent } = await registerUser(uniqueEmail('customer2'))
    const res = await agent.post('/api/notifications/admin-test')
    expect(res.status).toBe(403)
  })

  it('succeeds (best effort, 204) for an admin account even with no push subscriptions saved', async () => {
    const { agent } = await adminAgent()
    const res = await agent.post('/api/notifications/admin-test')
    expect(res.status).toBe(204)
  })
})
