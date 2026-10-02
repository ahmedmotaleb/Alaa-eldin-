// اختبارات تكامل حقيقية لإدارة الأدوار المخصصة (POST/PATCH/DELETE /api/admin/roles) —
// بتغطي إنشاء/تعديل دور، حماية الأدوار الأساسية (isSystem) من الحذف، وحماية دور لسه
// معيَّن فعلياً لمستخدم من الحذف غير الآمن.
import { afterAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { app } from '../app.js'
import { pool } from '../db.js'

const PREFIX = 'aroles-'
const STRONG_PASSWORD = 'CorrectHorse9'

function uniqueEmail(label: string): string {
  return `${PREFIX}${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`
}

async function fullAdminAgent(): Promise<ReturnType<typeof request.agent>> {
  const agent = request.agent(app)
  const email = uniqueEmail('fulladmin')
  const res = await agent.post('/api/auth/register').send({ email, password: STRONG_PASSWORD, fullName: 'مسؤول اختبار الأدوار' })
  expect(res.status).toBe(201)
  await pool.query('UPDATE users SET is_admin = 1, role = $2, role_id = NULL WHERE id = $1', [res.body.user.id, 'admin'])
  return agent
}

afterAll(async () => {
  // ترتيب الحذف مهم: المستخدمين اللي معاهم role_id بيشاور على الأدوار دي لازم يتشالوا (أو
  // تتفك علاقتهم) قبل محاولة حذف الأدوار نفسها، وإلا هتفشل بـ foreign key violation.
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${PREFIX}%`])
  await pool.query('DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE name LIKE $1)', [`${PREFIX}%`])
  await pool.query('DELETE FROM roles WHERE name LIKE $1', [`${PREFIX}%`])
  await pool.end()
})

describe('role CRUD (/api/admin/roles)', () => {
  it('creates a custom role with a description and a validated permission set', async () => {
    const agent = await fullAdminAgent()
    const res = await agent.post('/api/admin/roles').send({
      name: `${PREFIX}مشرف فرع`, description: 'صلاحيات محدودة لفرع واحد', permissions: ['orders.view', 'orders.print']
    })
    expect(res.status).toBe(201)
    expect(res.body.role.name).toBe(`${PREFIX}مشرف فرع`)
    expect(res.body.role.description).toBe('صلاحيات محدودة لفرع واحد')
    expect(res.body.role.isSystem).toBe(false)
    expect(res.body.role.permissions.sort()).toEqual(['orders.print', 'orders.view'])
  })

  it('rejects a role with an unknown permission string', async () => {
    const agent = await fullAdminAgent()
    const res = await agent.post('/api/admin/roles').send({
      name: `${PREFIX}دور غير صالح`, description: '', permissions: ['not.a.real.permission']
    })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('invalid_permissions')
  })

  it('rejects a duplicate role name', async () => {
    const agent = await fullAdminAgent()
    const name = `${PREFIX}دور مكرر`
    const first = await agent.post('/api/admin/roles').send({ name, description: '', permissions: [] })
    expect(first.status).toBe(201)
    const second = await agent.post('/api/admin/roles').send({ name, description: '', permissions: [] })
    expect(second.status).toBe(409)
    expect(second.body.error).toBe('role_name_taken')
  })

  it('updates an existing custom role (name, description, permissions)', async () => {
    const agent = await fullAdminAgent()
    const created = await agent.post('/api/admin/roles').send({
      name: `${PREFIX}قبل التعديل`, description: 'قديم', permissions: ['orders.view']
    })
    const updated = await agent.patch(`/api/admin/roles/${created.body.role.id}`).send({
      name: `${PREFIX}بعد التعديل`, description: 'جديد', permissions: ['orders.view', 'orders.cancel']
    })
    expect(updated.status).toBe(200)
    expect(updated.body.role.name).toBe(`${PREFIX}بعد التعديل`)
    expect(updated.body.role.description).toBe('جديد')
    expect(updated.body.role.permissions.sort()).toEqual(['orders.cancel', 'orders.view'])
  })

  it('refuses to delete a system role', async () => {
    const agent = await fullAdminAgent()
    const res = await agent.delete('/api/admin/roles/role-picker')
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('cannot_delete_system_role')
  })

  it('refuses to delete a custom role that is still assigned to a user', async () => {
    const agent = await fullAdminAgent()
    const role = await agent.post('/api/admin/roles').send({ name: `${PREFIX}دور مستخدم`, description: '', permissions: [] })
    const created = await agent.post('/api/admin/users').send({
      fullName: 'مستخدم بدور مخصص', email: uniqueEmail('withrole'), temporaryPassword: STRONG_PASSWORD, roleId: role.body.role.id, active: true, mustChangePassword: false
    })
    expect(created.status).toBe(201)

    const deleted = await agent.delete(`/api/admin/roles/${role.body.role.id}`)
    expect(deleted.status).toBe(400)
    expect(deleted.body.error).toBe('role_in_use')
  })

  it('allows deleting a custom role that is not assigned to anyone', async () => {
    const agent = await fullAdminAgent()
    const role = await agent.post('/api/admin/roles').send({ name: `${PREFIX}دور غير مستخدم`, description: '', permissions: [] })
    const deleted = await agent.delete(`/api/admin/roles/${role.body.role.id}`)
    expect(deleted.status).toBe(204)

    const list = await agent.get('/api/admin/roles')
    expect(list.body.roles.some((r: { id: string }) => r.id === role.body.role.id)).toBe(false)
  })

  it('rejects role creation/deletion from a non-privileged caller', async () => {
    const agent = request.agent(app)
    const email = uniqueEmail('plain')
    const reg = await agent.post('/api/auth/register').send({ email, password: STRONG_PASSWORD, fullName: 'عميل عادي' })
    expect(reg.status).toBe(201)

    const create = await agent.post('/api/admin/roles').send({ name: `${PREFIX}محاولة غير مصرّح`, description: '', permissions: [] })
    expect(create.status).toBe(403)
    const del = await agent.delete('/api/admin/roles/role-picker')
    expect(del.status).toBe(403)
  })
})
