// اختبارات تكامل حقيقية للحقل الجديد "permissions" في استجابات /api/auth/me و/login — ده
// الأساس اللي AdminPushActivationCta (الزرار العائم لتفعيل إشعارات الطلبات) بيعتمد عليه
// عشان يظهر بس لأدمن عنده orders.view فعلياً، مش لأي حساب isAdmin عام. راجع
// permissionService.ts لتعريف role-manager (كل الصلاحيات) وrole-inventory-manager (من غير
// orders.view، راجع migration 0029_rbac.sql) المستخدمين هنا كأدوار نظام حقيقية جاهزة.
import { afterAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { app } from '../app.js'
import { pool } from '../db.js'

const PREFIX = 'authme-perms-'
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

afterAll(async () => {
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${PREFIX}%`])
  await pool.end()
})

describe('GET /api/auth/me — permissions field', () => {
  it('includes orders.view for a full legacy admin (is_admin=1, role_id=NULL)', async () => {
    const { agent, userId } = await registerUser(uniqueEmail('fulladmin'))
    await pool.query("UPDATE users SET is_admin = 1, role = 'admin', role_id = NULL WHERE id = $1", [userId])
    const res = await agent.get('/api/auth/me')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.user.permissions)).toBe(true)
    expect(res.body.user.permissions).toContain('orders.view')
  })

  it('omits orders.view for an admin whose role lacks it (role-inventory-manager)', async () => {
    const { agent, userId } = await registerUser(uniqueEmail('noordersview'))
    await pool.query("UPDATE users SET is_admin = 1, role = 'staff', role_id = 'role-inventory-manager' WHERE id = $1", [userId])
    const res = await agent.get('/api/auth/me')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.user.permissions)).toBe(true)
    expect(res.body.user.permissions).not.toContain('orders.view')
    expect(res.body.user.permissions).toContain('products.view')
  })

  it('does not include a permissions field at all for a plain (non-admin) customer', async () => {
    const { agent } = await registerUser(uniqueEmail('plaincustomer'))
    const res = await agent.get('/api/auth/me')
    expect(res.status).toBe(200)
    expect(res.body.user.isAdmin).toBe(false)
    expect(res.body.user.permissions).toBeUndefined()
  })

  it('reflects a role change immediately on the next /me call (no stale caching)', async () => {
    const { agent, userId } = await registerUser(uniqueEmail('rolechange'))
    await pool.query("UPDATE users SET is_admin = 1, role = 'staff', role_id = 'role-inventory-manager' WHERE id = $1", [userId])
    const before = await agent.get('/api/auth/me')
    expect(before.body.user.permissions).not.toContain('orders.view')

    await pool.query("UPDATE users SET role_id = 'role-manager' WHERE id = $1", [userId])
    const after = await agent.get('/api/auth/me')
    expect(after.body.user.permissions).toContain('orders.view')
  })
})

describe('POST /api/auth/login — permissions field', () => {
  it('includes permissions for an admin on successful login, matching their role', async () => {
    const email = uniqueEmail('loginadmin')
    const agent = request.agent(app)
    const register = await agent.post('/api/auth/register').send({ email, password: STRONG_PASSWORD, fullName: 'أدمن دخول' })
    await pool.query("UPDATE users SET is_admin = 1, role = 'admin', role_id = NULL WHERE id = $1", [register.body.user.id])
    await agent.post('/api/auth/logout')

    const res = await agent.post('/api/auth/login').send({ email, password: STRONG_PASSWORD })
    expect(res.status).toBe(200)
    expect(res.body.user.permissions).toContain('orders.view')
  })

  it('does not include a permissions field for a plain customer on login', async () => {
    const email = uniqueEmail('logincustomer')
    const agent = request.agent(app)
    await agent.post('/api/auth/register').send({ email, password: STRONG_PASSWORD, fullName: 'عميل دخول' })
    await agent.post('/api/auth/logout')

    const res = await agent.post('/api/auth/login').send({ email, password: STRONG_PASSWORD })
    expect(res.status).toBe(200)
    expect(res.body.user.permissions).toBeUndefined()
  })
})
