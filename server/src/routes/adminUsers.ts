import { Router } from 'express'
import { pool } from '../db.js'
import { requireAdmin, requireRole } from '../auth.js'
import { recordAuditLog } from '../services/auditLogService.js'
import { logEvent } from '../logger.js'

// إدارة المستخدمين والصلاحيات مقصورة على دور 'admin' الكامل بس — مش أي مستخدم isAdmin.
// راجع auth.ts للفرق بين is_admin (الدخول للوحة التحكم أصلاً) وrole ('staff' التشغيلي
// مقابل 'admin' الكامل، وهو اللي بيحدد الوصول للأقسام الحساسة زي الصفحة دي).
export const adminUsersRouter = Router()
adminUsersRouter.use(requireAdmin)
adminUsersRouter.use(requireRole('admin'))

const MAX_LIMIT = 100
const DEFAULT_LIMIT = 20

interface UserRow {
  id: string
  email: string
  fullName: string
  createdAt: string
  isAdmin: number
  role: 'staff' | 'admin'
}

const SELECT_USER = `
  SELECT id, email, full_name as "fullName", created_at as "createdAt", is_admin as "isAdmin", role as "role"
  FROM users
`

function serialize(row: UserRow) {
  return { ...row, isAdmin: !!row.isAdmin }
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
