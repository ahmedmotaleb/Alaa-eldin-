import { Router } from 'express'
import crypto from 'node:crypto'
import { pool } from '../db.js'
import { requireAdmin, requireUsersManage } from '../auth.js'
import { ALL_PERMISSIONS, listRoles, countUsersWithRole, type Permission } from '../services/permissionService.js'
import { recordAuditLog } from '../services/auditLogService.js'
import { logEvent } from '../logger.js'

// إدارة الأدوار (RBAC) — نفس بوابة users.manage المستخدمة في إدارة المستخدمين (تعيين دور
// لمستخدم جزء من نفس الصلاحية الإدارية اللي بتسمح بإنشاء/تعديل/حذف الأدوار نفسها).
export const adminRolesRouter = Router()
adminRolesRouter.use(requireAdmin)
adminRolesRouter.use(requireUsersManage)

const PERMISSION_SET = new Set<string>(ALL_PERMISSIONS)

function validatePermissions(input: unknown): Permission[] | null {
  if (!Array.isArray(input)) return null
  const result: Permission[] = []
  for (const p of input) {
    if (typeof p !== 'string' || !PERMISSION_SET.has(p)) return null
    result.push(p as Permission)
  }
  return result
}

adminRolesRouter.get('/', async (_req, res) => {
  const roles = await listRoles()
  res.json({ roles })
})

// إنشاء دور مخصص جديد — بيتولّد له id فريد عشوائي دايماً (مش من اسم الدور) عشان نتجنب أي
// تعارض مع ids الأدوار الأساسية الثابتة (role-manager, role-picker, ...) أو تعقيدات تحويل
// اسم عربي لـ slug. is_system بيتحط 0 دايماً هنا — دور النظام بيتحدد بس وقت التثبيت (seed).
adminRolesRouter.post('/', async (req, res) => {
  const b = req.body ?? {}
  const name = typeof b.name === 'string' ? b.name.trim() : ''
  const description = typeof b.description === 'string' ? b.description.trim() : ''
  const permissions = validatePermissions(b.permissions)

  if (name.length < 2 || name.length > 60) {
    res.status(400).json({ error: 'invalid_name' })
    return
  }
  if (!permissions) {
    res.status(400).json({ error: 'invalid_permissions' })
    return
  }

  const { rows: existing } = await pool.query('SELECT id FROM roles WHERE name = $1', [name])
  if (existing[0]) {
    res.status(409).json({ error: 'role_name_taken' })
    return
  }

  const id = `role-${crypto.randomUUID()}`
  await pool.query('INSERT INTO roles (id, name, description, is_system) VALUES ($1, $2, $3, 0)', [id, name, description || null])
  if (permissions.length > 0) {
    await pool.query(
      `INSERT INTO role_permissions (role_id, permission) SELECT $1, p FROM unnest($2::text[]) AS p`,
      [id, permissions]
    )
  }

  await recordAuditLog({
    adminUserId: req.user!.id,
    action: 'role_created',
    entityType: 'role',
    entityId: id,
    newValues: { name, description: description || null, permissions }
  })
  logEvent('role_created', { roleId: id, createdBy: req.user!.id })

  const roles = await listRoles()
  const role = roles.find(r => r.id === id)
  res.status(201).json({ role })
})

// تعديل دور موجود (اسم/وصف/صلاحيات) — مسموح حتى للأدوار الأساسية (is_system=true) عشان
// الأدمن يقدر يضبط صلاحياتها لو احتاج، بس is_system نفسها مش قابلة للتغيير من هنا أصلاً
// (مفيش حقل لها في الـ body المقبول).
adminRolesRouter.patch('/:id', async (req, res) => {
  const { rows: existingRows } = await pool.query<{ id: string; name: string }>('SELECT id, name FROM roles WHERE id = $1', [req.params.id])
  const existing = existingRows[0]
  if (!existing) { res.status(404).json({ error: 'role_not_found' }); return }

  const b = req.body ?? {}
  const name = typeof b.name === 'string' ? b.name.trim() : ''
  const description = typeof b.description === 'string' ? b.description.trim() : ''
  const permissions = validatePermissions(b.permissions)

  if (name.length < 2 || name.length > 60) {
    res.status(400).json({ error: 'invalid_name' })
    return
  }
  if (!permissions) {
    res.status(400).json({ error: 'invalid_permissions' })
    return
  }

  if (name !== existing.name) {
    const { rows: nameClash } = await pool.query('SELECT id FROM roles WHERE name = $1 AND id != $2', [name, req.params.id])
    if (nameClash[0]) { res.status(409).json({ error: 'role_name_taken' }); return }
  }

  await pool.query('UPDATE roles SET name = $1, description = $2 WHERE id = $3', [name, description || null, req.params.id])
  await pool.query('DELETE FROM role_permissions WHERE role_id = $1', [req.params.id])
  if (permissions.length > 0) {
    await pool.query(
      `INSERT INTO role_permissions (role_id, permission) SELECT $1, p FROM unnest($2::text[]) AS p`,
      [req.params.id, permissions]
    )
  }

  await recordAuditLog({
    adminUserId: req.user!.id,
    action: 'role_updated',
    entityType: 'role',
    entityId: req.params.id,
    oldValues: { name: existing.name },
    newValues: { name, description: description || null, permissions }
  })
  logEvent('role_updated', { roleId: req.params.id, updatedBy: req.user!.id })

  const roles = await listRoles()
  const role = roles.find(r => r.id === req.params.id)
  res.json({ role })
})

// حذف دور — ممنوع للأدوار الأساسية (is_system)، وممنوع لأي دور لسه معيَّن فعلياً لمستخدم
// واحد على الأقل (عشان محدش يفقد صلاحياته فجأة بحذف الدور من تحته).
adminRolesRouter.delete('/:id', async (req, res) => {
  const { rows: existingRows } = await pool.query<{ id: string; isSystem: number }>(
    'SELECT id, is_system as "isSystem" FROM roles WHERE id = $1',
    [req.params.id]
  )
  const existing = existingRows[0]
  if (!existing) { res.status(404).json({ error: 'role_not_found' }); return }

  if (existing.isSystem) {
    res.status(400).json({ error: 'cannot_delete_system_role' })
    return
  }

  const usersWithRole = await countUsersWithRole(req.params.id)
  if (usersWithRole > 0) {
    res.status(400).json({ error: 'role_in_use' })
    return
  }

  await pool.query('DELETE FROM roles WHERE id = $1', [req.params.id])

  await recordAuditLog({
    adminUserId: req.user!.id,
    action: 'role_deleted',
    entityType: 'role',
    entityId: req.params.id
  })
  logEvent('role_deleted', { roleId: req.params.id, deletedBy: req.user!.id })
  res.status(204).end()
})
