import { pool } from '../db.js'

export const ALL_PERMISSIONS = [
  'orders.view', 'orders.update_status', 'orders.cancel', 'orders.print',
  'products.view', 'products.create', 'products.edit', 'products.cost_view',
  'inventory.view', 'inventory.adjust', 'inventory.receive',
  'purchases.view', 'purchases.create', 'purchases.receive',
  'customers.view', 'discounts.manage', 'analytics.view',
  'wallet.view', 'wallet.manage', 'delivery.manage', 'marketing.manage',
  'settings.manage', 'users.manage', 'audit.view', 'returns.manage'
] as const

export type Permission = typeof ALL_PERMISSIONS[number]

export interface RoleRow {
  id: string
  name: string
  isSystem: boolean
  permissions: Permission[]
}

// صلاحيات افتراضية لمستخدم من غير role_id (حسابات موجودة قبل نظام الأدوار الدقيقة) —
// admin كامل بياخد كل الصلاحيات، staff بياخد مجموعة تشغيلية معقولة تقارب سلوكه الحالي
// قبل الدرجة الدقيقة، عشان محدش يترقّى أو يترفّل صلاحياته بالغلط لمجرد الترقية للنظام الجديد.
const LEGACY_ADMIN_PERMISSIONS: Permission[] = [...ALL_PERMISSIONS]
const LEGACY_STAFF_PERMISSIONS: Permission[] = [
  'orders.view', 'orders.update_status', 'orders.print',
  'products.view', 'inventory.view',
  'customers.view', 'analytics.view', 'wallet.view'
]

export async function getUserPermissions(user: { isAdmin: boolean; role: string; roleId: string | null }): Promise<Set<Permission>> {
  if (user.roleId) {
    const { rows } = await pool.query<{ permission: Permission }>(
      'SELECT permission FROM role_permissions WHERE role_id = $1',
      [user.roleId]
    )
    return new Set(rows.map(r => r.permission))
  }
  return new Set(user.isAdmin ? LEGACY_ADMIN_PERMISSIONS : LEGACY_STAFF_PERMISSIONS)
}

export async function userHasPermission(
  user: { isAdmin: boolean; role: string; roleId: string | null },
  permission: Permission
): Promise<boolean> {
  const permissions = await getUserPermissions(user)
  return permissions.has(permission)
}

export async function listRoles(): Promise<RoleRow[]> {
  const { rows: roles } = await pool.query<{ id: string; name: string; isSystem: number }>(
    'SELECT id, name, is_system as "isSystem" FROM roles ORDER BY name'
  )
  const { rows: perms } = await pool.query<{ roleId: string; permission: Permission }>(
    'SELECT role_id as "roleId", permission FROM role_permissions'
  )
  const permsByRole = new Map<string, Permission[]>()
  for (const p of perms) {
    if (!permsByRole.has(p.roleId)) permsByRole.set(p.roleId, [])
    permsByRole.get(p.roleId)!.push(p.permission)
  }
  return roles.map(r => ({ id: r.id, name: r.name, isSystem: !!r.isSystem, permissions: permsByRole.get(r.id) ?? [] }))
}

// بيحدد لو المستخدم "مدير كامل" بنفس تعريف countFullAdmins بالظبط — بيتستخدم قبل حفظ أي
// تغيير (is_admin أو role_id) عشان نعرف لو التغيير ده هيشيل آخر مدير كامل في النظام.
export function isFullAdmin(user: { roleId: string | null; isAdmin: boolean }): boolean {
  return user.roleId === 'role-manager' || (user.roleId === null && user.isAdmin)
}

// آخر "مدير كامل" (role-manager أو is_admin بدون role_id) في النظام — ما ينفعش يتشال أو
// يترفّل صلاحيته، وإلا ممكن محدش يفضل يقدر يدير النظام خالص.
export async function countFullAdmins(excludingUserId?: string): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(
    `SELECT COUNT(*) as n FROM users
     WHERE (role_id = 'role-manager' OR (role_id IS NULL AND is_admin = 1))
       AND id != COALESCE($1, '')`,
    [excludingUserId ?? null]
  )
  return Number(rows[0].n)
}
