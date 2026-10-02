// اختبارات تكامل حقيقية لإنشاء/إدارة مستخدمي لوحة التحكم (POST /admin/users، تفعيل/إيقاف
// الحساب، إعادة تعيين كلمة المرور) — بتغطي التفويض الفعلي عند الـ API (مش مجرد إخفاء زرار)،
// سياسة كلمة المرور، حماية آخر مدير كامل، وتسجيل سجل التدقيق. راجع permissionService.ts
// للتعريف الدقيق لـ "مدير كامل" وLEGACY_ADMIN/STAFF_PERMISSIONS.
import { afterAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { app } from '../app.js'
import { pool } from '../db.js'

const PREFIX = 'ausers-'
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

async function fullAdminAgent(): Promise<{ agent: ReturnType<typeof request.agent>, userId: string }> {
  const { agent, userId } = await registerUser(uniqueEmail('fulladmin'))
  await pool.query('UPDATE users SET is_admin = 1, role = $2, role_id = NULL WHERE id = $1', [userId, 'admin'])
  return { agent, userId }
}

// موظف staff عنده role_id='role-picker' (دور نظام حقيقي بدون users.manage) — يمثّل مستخدم
// لوحة تحكم محدود الصلاحيات، للتأكد إن الحماية فعلية على مستوى الـ API مش بس واجهة.
async function limitedStaffAgent(): Promise<{ agent: ReturnType<typeof request.agent>, userId: string }> {
  const { agent, userId } = await registerUser(uniqueEmail('limitedstaff'))
  await pool.query("UPDATE users SET is_admin = 1, role = 'staff', role_id = 'role-picker' WHERE id = $1", [userId])
  return { agent, userId }
}

afterAll(async () => {
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${PREFIX}%`])
  await pool.query('DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE name LIKE $1)', [`${PREFIX}%`])
  await pool.query('DELETE FROM roles WHERE name LIKE $1', [`${PREFIX}%`])
  await pool.end()
})

describe('POST /api/admin/users (create admin/staff user)', () => {
  it('allows a full admin to create a new staff user with a role, and the password is hashed (never stored/returned as plaintext)', async () => {
    const { agent } = await fullAdminAgent()
    const email = uniqueEmail('created-staff')
    const res = await agent.post('/api/admin/users').send({
      fullName: 'موظف جديد', email, temporaryPassword: STRONG_PASSWORD, roleId: 'role-picker', active: true, mustChangePassword: true
    })
    expect(res.status).toBe(201)
    expect(res.body.user.email).toBe(email)
    expect(res.body.user.roleId).toBe('role-picker')
    expect(res.body.user.isAdmin).toBe(true)
    expect(res.body.user.active).toBe(true)
    expect(res.body.user.mustChangePassword).toBe(true)
    expect(res.body.user.passwordHash).toBeUndefined()
    expect(JSON.stringify(res.body)).not.toContain(STRONG_PASSWORD)

    const { rows } = await pool.query('SELECT password_hash as "passwordHash" FROM users WHERE id = $1', [res.body.user.id])
    expect(rows[0].passwordHash).not.toBe(STRONG_PASSWORD)
    expect(rows[0].passwordHash.startsWith('$2')).toBe(true) // bcrypt hash format
  })

  it('rejects creation from an unauthenticated/customer caller entirely (401/403, not a UI-only restriction)', async () => {
    const { agent } = await registerUser(uniqueEmail('plaincustomer'))
    const res = await agent.post('/api/admin/users').send({
      fullName: 'محاولة غير مصرّح', email: uniqueEmail('blocked'), temporaryPassword: STRONG_PASSWORD, roleId: 'role-picker', active: true, mustChangePassword: true
    })
    expect(res.status).toBe(403)
  })

  it('rejects creation from a staff user whose RBAC role lacks users.manage, even with correct body/fields', async () => {
    const { agent } = await limitedStaffAgent()
    const res = await agent.post('/api/admin/users').send({
      fullName: 'محاولة موظف محدود', email: uniqueEmail('blocked2'), temporaryPassword: STRONG_PASSWORD, roleId: 'role-picker', active: true, mustChangePassword: true
    })
    expect(res.status).toBe(403)
  })

  it('rejects a duplicate email with 409', async () => {
    const { agent } = await fullAdminAgent()
    const email = uniqueEmail('dup')
    const first = await agent.post('/api/admin/users').send({
      fullName: 'أول', email, temporaryPassword: STRONG_PASSWORD, roleId: 'role-picker', active: true, mustChangePassword: true
    })
    expect(first.status).toBe(201)
    const second = await agent.post('/api/admin/users').send({
      fullName: 'ثاني', email, temporaryPassword: STRONG_PASSWORD, roleId: 'role-picker', active: true, mustChangePassword: true
    })
    expect(second.status).toBe(409)
    expect(second.body.error).toBe('email_taken')
  })

  it('rejects a weak password', async () => {
    const { agent } = await fullAdminAgent()
    const res = await agent.post('/api/admin/users').send({
      fullName: 'كلمة مرور ضعيفة', email: uniqueEmail('weak'), temporaryPassword: '123', roleId: 'role-picker', active: true, mustChangePassword: true
    })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('weak_password')
  })

  it('rejects a nonexistent roleId', async () => {
    const { agent } = await fullAdminAgent()
    const res = await agent.post('/api/admin/users').send({
      fullName: 'دور غير موجود', email: uniqueEmail('badrole'), temporaryPassword: STRONG_PASSWORD, roleId: 'role-does-not-exist', active: true, mustChangePassword: true
    })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('role_not_found')
  })

  it('rejects creation with no roleId at all', async () => {
    const { agent } = await fullAdminAgent()
    const res = await agent.post('/api/admin/users').send({
      fullName: 'بدون دور', email: uniqueEmail('norole'), temporaryPassword: STRONG_PASSWORD, roleId: '', active: true, mustChangePassword: true
    })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('role_required')
  })

  it('newly created admin user appears in GET /api/admin/users with the correct assigned role', async () => {
    const { agent } = await fullAdminAgent()
    const email = uniqueEmail('appears')
    const created = await agent.post('/api/admin/users').send({
      fullName: 'يظهر في القايمة', email, temporaryPassword: STRONG_PASSWORD, roleId: 'role-picker', active: true, mustChangePassword: false
    })
    expect(created.status).toBe(201)

    const list = await agent.get('/api/admin/users').query({ search: email })
    expect(list.status).toBe(200)
    const found = list.body.users.find((u: { email: string }) => u.email === email)
    expect(found).toBeTruthy()
    expect(found.roleId).toBe('role-picker')
  })

  it('writes an admin_user_created audit log entry without any password value', async () => {
    const { agent, userId: adminId } = await fullAdminAgent()
    const email = uniqueEmail('audited')
    const created = await agent.post('/api/admin/users').send({
      fullName: 'مراقب بالتدقيق', email, temporaryPassword: STRONG_PASSWORD, roleId: 'role-picker', active: true, mustChangePassword: true
    })
    expect(created.status).toBe(201)

    const { rows } = await pool.query(
      `SELECT old_values as "oldValues", new_values as "newValues" FROM audit_logs
       WHERE admin_user_id = $1 AND action = 'admin_user_created' AND entity_id = $2`,
      [adminId, created.body.user.id]
    )
    expect(rows.length).toBe(1)
    const serialized = JSON.stringify(rows[0])
    expect(serialized).not.toContain(STRONG_PASSWORD)
    expect(serialized).toContain(email)
  })
})

describe('a disabled admin account cannot log in', () => {
  it('rejects login with account_disabled once active=0, even with the correct password', async () => {
    const email = uniqueEmail('disabled')
    const { agent, userId } = await registerUser(email)
    await pool.query("UPDATE users SET is_admin = 1, role = 'staff', active = 0 WHERE id = $1", [userId])

    const freshAgent = request.agent(app)
    const res = await freshAgent.post('/api/auth/login').send({ email, password: STRONG_PASSWORD })
    expect(res.status).toBe(403)
    expect(res.body.error).toBe('account_disabled')
    void agent
  })
})

describe('PATCH /api/admin/users/:id/active', () => {
  it('deactivating a user revokes their sessions and blocks future login', async () => {
    const { agent: adminAgent } = await fullAdminAgent()
    const email = uniqueEmail('tobedisabled')
    const created = await adminAgent.post('/api/admin/users').send({
      fullName: 'هيتوقف', email, temporaryPassword: STRONG_PASSWORD, roleId: 'role-picker', active: true, mustChangePassword: false
    })
    expect(created.status).toBe(201)
    const targetId = created.body.user.id as string

    const targetAgent = request.agent(app)
    const loginBefore = await targetAgent.post('/api/auth/login').send({ email, password: STRONG_PASSWORD })
    expect(loginBefore.status).toBe(200)

    const deactivate = await adminAgent.patch(`/api/admin/users/${targetId}/active`).send({ active: false })
    expect(deactivate.status).toBe(200)
    expect(deactivate.body.user.active).toBe(false)

    const { rows: sessions } = await pool.query('SELECT id FROM sessions WHERE user_id = $1', [targetId])
    expect(sessions.length).toBe(0)

    const loginAfter = await request(app).post('/api/auth/login').send({ email, password: STRONG_PASSWORD })
    expect(loginAfter.status).toBe(403)
    expect(loginAfter.body.error).toBe('account_disabled')
  })

  it('refuses to deactivate the last remaining full admin, even when the actor performing the request is not themself a full admin', async () => {
    // الفاعل هنا عنده صلاحية users.manage عن طريق دور مخصص (مش role-manager ولا legacy
    // admin)، فمش بيتحسب "مدير كامل" حسب isFullAdmin — ده بيفصل بوضوح بين "مين بينفّذ
    // الطلب" و"مين بيتحسب ضمن عدّاد آخر مدير كامل"، فالاختبار بيتأكد من منطق الحماية نفسه
    // مش بس من منع المستخدم من إيقاف حسابه الخاص.
    const { agent: creatorAgent } = await fullAdminAgent()
    const customRole = await creatorAgent.post('/api/admin/roles').send({
      name: `${PREFIX}دور اختبار آخر مدير ${Date.now()}`, description: '', permissions: ['users.manage']
    })
    expect(customRole.status).toBe(201)

    const actorEmail = uniqueEmail('lastadmin-actor')
    const { userId: actorId } = await registerUser(actorEmail)
    await pool.query("UPDATE users SET is_admin = 1, role = 'staff', role_id = $2 WHERE id = $1", [actorId, customRole.body.role.id])
    const actorAgent = request.agent(app)
    const actorLogin = await actorAgent.post('/api/auth/login').send({ email: actorEmail, password: STRONG_PASSWORD })
    expect(actorLogin.status).toBe(200)

    const targetEmail = uniqueEmail('lastadmin-target')
    const { userId: targetId } = await registerUser(targetEmail)
    await pool.query("UPDATE users SET is_admin = 1, role = 'admin', role_id = NULL WHERE id = $1", [targetId])

    // نحيّد كل باقي "المديرين الكاملين" الموجودين في قاعدة بيانات الاختبار المشتركة (بقايا
    // من ملفات اختبار تانية) مؤقتاً، عشان target يبقى فعلاً آخر واحد — نفس نمط الـ DELETE
    // الشامل الموثّق في vitest.config.ts لباقي ملفات الاختبار (fileParallelism: false بيمنع
    // أي تصادم مع ملف تاني شغال في نفس اللحظة).
    await pool.query("UPDATE users SET is_admin = 0 WHERE (role_id = 'role-manager' OR (role_id IS NULL AND is_admin = 1)) AND id != $1", [targetId])

    const res = await actorAgent.patch(`/api/admin/users/${targetId}/active`).send({ active: false })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('cannot_remove_last_admin')
  })

  it('refuses to let a user deactivate their own account', async () => {
    const { agent, userId } = await fullAdminAgent()
    const res = await agent.patch(`/api/admin/users/${userId}/active`).send({ active: false })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('cannot_deactivate_self')
  })
})

describe('POST /api/admin/users/:id/reset-password', () => {
  it('sets a new temporary password, forces must_change_password, and revokes existing sessions', async () => {
    const { agent: adminAgent } = await fullAdminAgent()
    const email = uniqueEmail('resetme')
    const created = await adminAgent.post('/api/admin/users').send({
      fullName: 'هيتغير له الباسورد', email, temporaryPassword: STRONG_PASSWORD, roleId: 'role-picker', active: true, mustChangePassword: false
    })
    const targetId = created.body.user.id as string

    const targetAgent = request.agent(app)
    const loginBefore = await targetAgent.post('/api/auth/login').send({ email, password: STRONG_PASSWORD })
    expect(loginBefore.status).toBe(200)

    const newTempPassword = 'BrandNewPass9'
    const reset = await adminAgent.post(`/api/admin/users/${targetId}/reset-password`).send({ temporaryPassword: newTempPassword })
    expect(reset.status).toBe(200)
    expect(reset.body.user.mustChangePassword).toBe(true)
    expect(JSON.stringify(reset.body)).not.toContain(newTempPassword)

    const { rows: sessions } = await pool.query('SELECT id FROM sessions WHERE user_id = $1', [targetId])
    expect(sessions.length).toBe(0)

    const loginOld = await request(app).post('/api/auth/login').send({ email, password: STRONG_PASSWORD })
    expect(loginOld.status).toBe(401)

    const loginNew = await request(app).post('/api/auth/login').send({ email, password: newTempPassword })
    expect(loginNew.status).toBe(200)
    expect(loginNew.body.user.mustChangePassword).toBe(true)
  })

  it('rejects a weak temporary password', async () => {
    const { agent: adminAgent } = await fullAdminAgent()
    const email = uniqueEmail('weakreset')
    const created = await adminAgent.post('/api/admin/users').send({
      fullName: 'ريسيت ضعيف', email, temporaryPassword: STRONG_PASSWORD, roleId: 'role-picker', active: true, mustChangePassword: false
    })
    const res = await adminAgent.post(`/api/admin/users/${created.body.user.id}/reset-password`).send({ temporaryPassword: '123' })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('weak_password')
  })
})

describe('mandatory password change gate (must_change_password=1 blocks the rest of the admin API)', () => {
  it('blocks other admin routes with password_change_required until the password is changed, then unblocks them', async () => {
    const { agent: adminAgent } = await fullAdminAgent()
    const email = uniqueEmail('mustchange')
    const created = await adminAgent.post('/api/admin/users').send({
      fullName: 'لازم يغيّر كلمة المرور', email, temporaryPassword: STRONG_PASSWORD, roleId: 'role-manager', active: true, mustChangePassword: true
    })
    expect(created.status).toBe(201)

    const targetAgent = request.agent(app)
    const login = await targetAgent.post('/api/auth/login').send({ email, password: STRONG_PASSWORD })
    expect(login.status).toBe(200)
    expect(login.body.user.mustChangePassword).toBe(true)

    const blocked = await targetAgent.get('/api/admin/users')
    expect(blocked.status).toBe(403)
    expect(blocked.body.error).toBe('password_change_required')

    const changeWrongCurrent = await targetAgent.post('/api/auth/change-required-password').send({ currentPassword: 'wrong-password', newPassword: 'BrandNewPass9' })
    expect(changeWrongCurrent.status).toBe(401)

    const change = await targetAgent.post('/api/auth/change-required-password').send({ currentPassword: STRONG_PASSWORD, newPassword: 'BrandNewPass9' })
    expect(change.status).toBe(200)
    expect(change.body.user.mustChangePassword).toBe(false)

    const unblocked = await targetAgent.get('/api/admin/users')
    expect(unblocked.status).toBe(200)
  })
})
