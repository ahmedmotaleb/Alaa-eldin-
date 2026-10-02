import { Router } from 'express'
import crypto from 'node:crypto'
import { pool } from '../db.js'
import { requireAdmin, requireUsersManage, hashPassword } from '../auth.js'
import { isStrongPassword } from '../passwordPolicy.js'
import { recordAuditLog } from '../services/auditLogService.js'
import { logEvent } from '../logger.js'
import { countFullAdmins, isFullAdmin } from '../services/permissionService.js'

// إدارة المستخدمين والصلاحيات — عن طريق requireUsersManage (راجع auth.ts): حساب legacy
// (role_id=null) لازم يكون role='admin' الكامل بالظبط زي ما كان دايماً (مش 'staff')، أو أي
// حساب عنده دور RBAC دقيق (role_id) مُدّالة له صلاحية users.manage صراحة. مش requirePermission
// العادية — دي كانت بتفتح الصلاحية دي غلط لأي حساب legacy isAdmin=1 بغض النظر عن role
// النصي، بسبب طريقة LEGACY_ADMIN_PERMISSIONS fallback في permissionService.ts.
export const adminUsersRouter = Router()
adminUsersRouter.use(requireAdmin)
adminUsersRouter.use(requireUsersManage)

const MAX_LIMIT = 100
const DEFAULT_LIMIT = 20
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

interface UserRow {
  id: string
  email: string
  fullName: string
  createdAt: string
  isAdmin: number
  role: 'staff' | 'admin'
  roleId: string | null
  active: number
  mustChangePassword: number
}

const SELECT_USER = `
  SELECT id, email, full_name as "fullName", created_at as "createdAt", is_admin as "isAdmin", role as "role", role_id as "roleId", active, must_change_password as "mustChangePassword"
  FROM users
`

function serialize(row: UserRow) {
  return { ...row, isAdmin: !!row.isAdmin, active: !!row.active, mustChangePassword: !!row.mustChangePassword }
}

adminUsersRouter.get('/', async (req, res) => {
  // الترقيم والبحث اختياريان (opt-in) — لو مفيش page/limit في الطلب، بيرجع كل المستخدمين
  // زي ما كان الحال دايماً، عشان أي استدعاء قديم ما ينكسرش بصمت.
  const paginationRequested = req.query.page !== undefined || req.query.limit !== undefined
  const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1)
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(String(req.query.limit ?? String(DEFAULT_LIMIT)), 10) || DEFAULT_LIMIT))
  const offset = (page - 1) * limit

  const params: unknown[] = []
  let whereClause = ''
  if (typeof req.query.search === 'string' && req.query.search.trim()) {
    params.push(`%${req.query.search.trim()}%`)
    whereClause = `WHERE (full_name ILIKE $${params.length} OR email ILIKE $${params.length})`
  }

  if (!paginationRequested) {
    const { rows } = await pool.query<UserRow>(`${SELECT_USER} ${whereClause} ORDER BY created_at DESC`, params)
    res.json({ users: rows.map(serialize) })
    return
  }

  const { rows: countRows } = await pool.query<{ n: string }>(`SELECT COUNT(*) as n FROM users ${whereClause}`, params)
  const total = Number(countRows[0].n)

  const { rows } = await pool.query<UserRow>(
    `${SELECT_USER} ${whereClause} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset]
  )
  res.json({
    users: rows.map(serialize),
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit))
  })
})

// إنشاء مستخدم لوحة تحكم جديد (مسؤول/موظف) — أبداً عميل عادي؛ is_admin بيتفرض true دايماً
// بغض النظر عما يُرسل، وrole القديم بيبدأ 'staff' زي باقي حسابات لوحة التحكم الجديدة (نفس
// سلوك PATCH /:id/admin)، والصلاحية الفعلية بتتحدد من roleId (RBAC) المُرسَل.
adminUsersRouter.post('/', async (req, res) => {
  const b = req.body ?? {}
  const fullName = typeof b.fullName === 'string' ? b.fullName.trim() : ''
  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : ''
  const temporaryPassword = typeof b.temporaryPassword === 'string' ? b.temporaryPassword : ''
  const roleId = typeof b.roleId === 'string' ? b.roleId : ''
  const active = typeof b.active === 'boolean' ? b.active : true
  const mustChangePassword = typeof b.mustChangePassword === 'boolean' ? b.mustChangePassword : true

  if (fullName.length < 2 || fullName.length > 100) {
    res.status(400).json({ error: 'invalid_full_name' })
    return
  }
  if (!EMAIL_RE.test(email)) {
    res.status(400).json({ error: 'invalid_email' })
    return
  }
  if (!isStrongPassword(temporaryPassword)) {
    res.status(400).json({ error: 'weak_password' })
    return
  }
  if (!roleId) {
    res.status(400).json({ error: 'role_required' })
    return
  }

  const { rows: roleRows } = await pool.query('SELECT id FROM roles WHERE id = $1', [roleId])
  if (!roleRows[0]) {
    res.status(400).json({ error: 'role_not_found' })
    return
  }

  const { rows: existingRows } = await pool.query('SELECT id FROM users WHERE email = $1', [email])
  if (existingRows[0]) {
    res.status(409).json({ error: 'email_taken' })
    return
  }

  const id = crypto.randomUUID()
  const createdAt = new Date().toISOString()
  await pool.query(
    `INSERT INTO users (id, email, password_hash, full_name, created_at, is_admin, role, role_id, active, must_change_password)
     VALUES ($1, $2, $3, $4, $5, 1, 'staff', $6, $7, $8)`,
    [id, email, hashPassword(temporaryPassword), fullName, createdAt, roleId, active ? 1 : 0, mustChangePassword ? 1 : 0]
  )

  const { rows } = await pool.query<UserRow>(`${SELECT_USER} WHERE id = $1`, [id])
  const user = serialize(rows[0])

  // تسجيل صريح: مفيش أي قيمة لكلمة المرور (مؤقتة أو غيرها) في سجل التدقيق أبداً.
  await recordAuditLog({
    adminUserId: req.user!.id,
    action: 'admin_user_created',
    entityType: 'user',
    entityId: id,
    newValues: { email, fullName, roleId, active: user.active, mustChangePassword: user.mustChangePassword }
  })
  logEvent('admin_user_created', { userId: id, createdBy: req.user!.id, roleId })
  res.status(201).json({ user })
})

adminUsersRouter.patch('/:id/admin', async (req, res) => {
  const { isAdmin } = req.body ?? {}
  if (typeof isAdmin !== 'boolean') {
    res.status(400).json({ error: 'missing_fields' })
    return
  }

  if (req.params.id === req.user!.id && !isAdmin) {
    res.status(400).json({ error: 'cannot_demote_self' })
    return
  }

  const { rows: existingRows } = await pool.query<UserRow>(`${SELECT_USER} WHERE id = $1`, [req.params.id])
  const existing = existingRows[0]
  if (!existing) { res.status(404).json({ error: 'user_not_found' }); return }

  if (!isAdmin && isFullAdmin({ roleId: existing.roleId, isAdmin: !!existing.isAdmin })) {
    const remaining = await countFullAdmins(req.params.id)
    if (remaining === 0) { res.status(400).json({ error: 'cannot_remove_last_admin' }); return }
  }

  // ترقية جديدة لصلاحية الدخول للوحة التحكم بتبدأ بدور 'staff' التشغيلي (أقل صلاحية) —
  // الترقية لدور 'admin' الكامل قرار منفصل عن طريق /:id/role. سحب صلاحية الدخول بيرجّع
  // الدور لـ 'staff' كمان، عشان الدور يفضل معناه واضح طول ما is_admin شغال.
  const result = await pool.query(
    `UPDATE users SET is_admin = $1, role = CASE WHEN $1 = 0 THEN 'staff' ELSE role END WHERE id = $2`,
    [isAdmin ? 1 : 0, req.params.id]
  )
  if (result.rowCount === 0) {
    res.status(404).json({ error: 'user_not_found' })
    return
  }

  const { rows } = await pool.query<UserRow>(`${SELECT_USER} WHERE id = $1`, [req.params.id])
  const user = serialize(rows[0])
  await recordAuditLog({
    adminUserId: req.user!.id,
    action: isAdmin ? 'user_admin_granted' : 'user_admin_revoked',
    entityType: 'user',
    entityId: req.params.id,
    newValues: { isAdmin: user.isAdmin, role: user.role }
  })
  res.json({ user })
})

// ترقية/تخفيض دور مستخدم دخل بالفعل للوحة التحكم بين 'staff' (تشغيلي) و'admin' (كامل).
adminUsersRouter.patch('/:id/role', async (req, res) => {
  const { role } = req.body ?? {}
  if (role !== 'staff' && role !== 'admin') {
    res.status(400).json({ error: 'invalid_role' })
    return
  }

  if (req.params.id === req.user!.id && role !== 'admin') {
    res.status(400).json({ error: 'cannot_demote_self' })
    return
  }

  const { rows: beforeRows } = await pool.query<UserRow>(`${SELECT_USER} WHERE id = $1`, [req.params.id])
  const before = beforeRows[0]

  const result = await pool.query('UPDATE users SET role = $1 WHERE id = $2 AND is_admin = 1', [role, req.params.id])
  if (result.rowCount === 0) {
    res.status(404).json({ error: 'user_not_found' })
    return
  }

  const { rows } = await pool.query<UserRow>(`${SELECT_USER} WHERE id = $1`, [req.params.id])
  const user = serialize(rows[0])
  await recordAuditLog({
    adminUserId: req.user!.id,
    action: 'user_role_changed',
    entityType: 'user',
    entityId: req.params.id,
    oldValues: { role: before?.role },
    newValues: { role: user.role }
  })
  logEvent('role_changed', { userId: req.params.id, fromRole: before?.role, toRole: user.role })
  res.json({ user })
})

// تعيين دور دقيق (RBAC) للمستخدم — منفصل تماماً عن role القديم ('staff'/'admin' العام).
// roleId=null بيرجّع المستخدم لصلاحيات fallback القديمة (LEGACY_ADMIN/STAFF_PERMISSIONS
// حسب is_admin) — أي حساب موجود بيفضل شغال زي ما كان لحد ما حد يعيّن له دور دقيق صراحةً.
adminUsersRouter.patch('/:id/role-id', async (req, res) => {
  const roleId = req.body?.roleId
  if (roleId !== null && typeof roleId !== 'string') {
    res.status(400).json({ error: 'invalid_role_id' })
    return
  }

  const { rows: existingRows } = await pool.query<UserRow>(`${SELECT_USER} WHERE id = $1`, [req.params.id])
  const existing = existingRows[0]
  if (!existing) { res.status(404).json({ error: 'user_not_found' }); return }

  if (roleId !== null) {
    const { rows: roleRows } = await pool.query('SELECT id FROM roles WHERE id = $1', [roleId])
    if (!roleRows[0]) { res.status(400).json({ error: 'role_not_found' }); return }
  }

  const before = { roleId: existing.roleId, isAdmin: !!existing.isAdmin }
  const after = { roleId, isAdmin: !!existing.isAdmin }
  if (isFullAdmin(before) && !isFullAdmin(after)) {
    const remaining = await countFullAdmins(req.params.id)
    if (remaining === 0) { res.status(400).json({ error: 'cannot_remove_last_admin' }); return }
  }

  await pool.query('UPDATE users SET role_id = $1 WHERE id = $2', [roleId, req.params.id])
  const { rows } = await pool.query<UserRow>(`${SELECT_USER} WHERE id = $1`, [req.params.id])
  const user = serialize(rows[0])

  await recordAuditLog({
    adminUserId: req.user!.id,
    action: 'user_permission_role_changed',
    entityType: 'user',
    entityId: req.params.id,
    oldValues: { roleId: existing.roleId },
    newValues: { roleId: user.roleId }
  })
  logEvent('permission_role_changed', { userId: req.params.id, fromRoleId: existing.roleId, toRoleId: user.roleId })
  res.json({ user })
})

// تفعيل/إيقاف حساب لوحة تحكم — حساب موقوف بيفشل تسجيل الدخول فوراً (راجع /login) وبتتمسح
// كل جلساته الحالية هنا عشان ما يفضلش شغال بجلسة قديمة لسه صالحة.
adminUsersRouter.patch('/:id/active', async (req, res) => {
  const { active } = req.body ?? {}
  if (typeof active !== 'boolean') {
    res.status(400).json({ error: 'missing_fields' })
    return
  }

  if (req.params.id === req.user!.id && !active) {
    res.status(400).json({ error: 'cannot_deactivate_self' })
    return
  }

  const { rows: existingRows } = await pool.query<UserRow>(`${SELECT_USER} WHERE id = $1`, [req.params.id])
  const existing = existingRows[0]
  if (!existing) { res.status(404).json({ error: 'user_not_found' }); return }

  if (!active && isFullAdmin({ roleId: existing.roleId, isAdmin: !!existing.isAdmin })) {
    const remaining = await countFullAdmins(req.params.id)
    if (remaining === 0) { res.status(400).json({ error: 'cannot_remove_last_admin' }); return }
  }

  await pool.query('UPDATE users SET active = $1 WHERE id = $2', [active ? 1 : 0, req.params.id])
  if (!active) await pool.query('DELETE FROM sessions WHERE user_id = $1', [req.params.id])

  const { rows } = await pool.query<UserRow>(`${SELECT_USER} WHERE id = $1`, [req.params.id])
  const user = serialize(rows[0])

  await recordAuditLog({
    adminUserId: req.user!.id,
    action: active ? 'user_account_activated' : 'user_account_deactivated',
    entityType: 'user',
    entityId: req.params.id,
    newValues: { active: user.active }
  })
  logEvent('user_active_changed', { userId: req.params.id, active })
  res.json({ user })
})

// إعادة تعيين كلمة مرور مستخدم تاني (كلمة مرور مؤقتة جديدة) — بتجبره يغيّرها أول دخول
// وبتبطّل كل جلساته الحالية فوراً (نفس منطق /auth/reset-password الذاتي، هنا بإجراء إداري).
adminUsersRouter.post('/:id/reset-password', async (req, res) => {
  const { temporaryPassword } = req.body ?? {}
  if (typeof temporaryPassword !== 'string' || !isStrongPassword(temporaryPassword)) {
    res.status(400).json({ error: 'weak_password' })
    return
  }

  const { rows: existingRows } = await pool.query<UserRow>(`${SELECT_USER} WHERE id = $1`, [req.params.id])
  if (!existingRows[0]) { res.status(404).json({ error: 'user_not_found' }); return }

  await pool.query('UPDATE users SET password_hash = $1, must_change_password = 1 WHERE id = $2', [hashPassword(temporaryPassword), req.params.id])
  await pool.query('DELETE FROM sessions WHERE user_id = $1', [req.params.id])

  // تسجيل الإجراء نفسه بس من غير أي قيمة لكلمة المرور — نفس انضباط admin_user_created.
  await recordAuditLog({
    adminUserId: req.user!.id,
    action: 'admin_password_reset',
    entityType: 'user',
    entityId: req.params.id
  })
  logEvent('admin_password_reset', { userId: req.params.id, resetBy: req.user!.id })

  const { rows } = await pool.query<UserRow>(`${SELECT_USER} WHERE id = $1`, [req.params.id])
  res.json({ user: serialize(rows[0]) })
})
