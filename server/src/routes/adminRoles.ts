import { Router } from 'express'
import { requireAdmin, requireRole } from '../auth.js'
import { listRoles } from '../services/permissionService.js'

// عرض الأدوار وصلاحياتها بس — مقصور على 'admin' الكامل زي باقي إدارة المستخدمين
// (راجع adminUsers.ts لتعيين role_id لمستخدم).
export const adminRolesRouter = Router()
adminRolesRouter.use(requireAdmin)
adminRolesRouter.use(requireRole('admin'))

adminRolesRouter.get('/', async (_req, res) => {
  const roles = await listRoles()
  res.json({ roles })
})
