import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { pool } from '../db.js'
import { getUserPermissions, userHasPermission, listRoles, countFullAdmins, isFullAdmin, ALL_PERMISSIONS } from './permissionService.js'

const USER_LEGACY_ADMIN = 'test-user-legacy-admin'
const USER_LEGACY_STAFF = 'test-user-legacy-staff'
const USER_PICKER = 'test-user-picker-role'
const USER_MANAGER_ROLE = 'test-user-manager-role'

async function insertUser(id: string, isAdmin: number, role: string, roleId: string | null) {
  await pool.query(
    `INSERT INTO users (id, email, password_hash, full_name, created_at, is_admin, role, role_id)
     VALUES ($1, $1 || '@test.local', 'x', 'مستخدم اختبار', now(), $2, $3, $4)`,
    [id, isAdmin, role, roleId]
  )
}

async function resetFixtures() {
  await pool.query('DELETE FROM users WHERE id = ANY($1::text[])', [
    [USER_LEGACY_ADMIN, USER_LEGACY_STAFF, USER_PICKER, USER_MANAGER_ROLE]
  ])
}

describe('permissionService', () => {
  beforeEach(resetFixtures)
  afterAll(resetFixtures)

  it('gives a legacy admin (no role_id, is_admin=1) every permission', async () => {
    await insertUser(USER_LEGACY_ADMIN, 1, 'admin', null)
    const permissions = await getUserPermissions({ isAdmin: true, role: 'admin', roleId: null })
    expect(permissions.size).toBe(ALL_PERMISSIONS.length)
    expect(await userHasPermission({ isAdmin: true, role: 'admin', roleId: null }, 'users.manage')).toBe(true)
  })

  it('gives a legacy staff user (no role_id) only the reasonable operational subset', async () => {
    await insertUser(USER_LEGACY_STAFF, 0, 'staff', null)
    const allowed = await userHasPermission({ isAdmin: false, role: 'staff', roleId: null }, 'orders.view')
    const denied = await userHasPermission({ isAdmin: false, role: 'staff', roleId: null }, 'users.manage')
    expect(allowed).toBe(true)
    expect(denied).toBe(false)
  })

  it('derives permissions from role_id when assigned, ignoring is_admin/role', async () => {
    await insertUser(USER_PICKER, 0, 'staff', 'role-picker')
    const permissions = await getUserPermissions({ isAdmin: false, role: 'staff', roleId: 'role-picker' })
    expect(permissions.has('orders.view')).toBe(true)
    expect(permissions.has('orders.update_status')).toBe(true)
    expect(permissions.has('orders.cancel')).toBe(false)
    expect(permissions.has('purchases.create')).toBe(false)
  })

  it('role-manager grants every permission just like a full admin', async () => {
    await insertUser(USER_MANAGER_ROLE, 0, 'staff', 'role-manager')
    const permissions = await getUserPermissions({ isAdmin: false, role: 'staff', roleId: 'role-manager' })
    expect(permissions.size).toBe(ALL_PERMISSIONS.length)
  })

  it('lists all seeded system roles with their permissions', async () => {
    const roles = await listRoles()
    const manager = roles.find(r => r.id === 'role-manager')!
    const picker = roles.find(r => r.id === 'role-picker')!
    expect(manager.isSystem).toBe(true)
    expect(manager.permissions.length).toBe(ALL_PERMISSIONS.length)
    expect(picker.permissions).toContain('orders.view')
    expect(picker.permissions).not.toContain('users.manage')
  })

  it('counts full admins (role-manager or legacy is_admin with no role_id)', async () => {
    await insertUser(USER_LEGACY_ADMIN, 1, 'admin', null)
    await insertUser(USER_MANAGER_ROLE, 0, 'staff', 'role-manager')
    await insertUser(USER_PICKER, 0, 'staff', 'role-picker')
    const count = await countFullAdmins()
    expect(count).toBeGreaterThanOrEqual(2)
  })

  it('excludes a given user id from the full-admin count', async () => {
    await insertUser(USER_LEGACY_ADMIN, 1, 'admin', null)
    const countAll = await countFullAdmins()
    const countExcluding = await countFullAdmins(USER_LEGACY_ADMIN)
    expect(countExcluding).toBe(countAll - 1)
  })

  it('isFullAdmin treats role-manager as full admin regardless of is_admin', () => {
    expect(isFullAdmin({ roleId: 'role-manager', isAdmin: false })).toBe(true)
    expect(isFullAdmin({ roleId: 'role-manager', isAdmin: true })).toBe(true)
  })

  it('isFullAdmin treats a legacy is_admin user with no role_id as full admin', () => {
    expect(isFullAdmin({ roleId: null, isAdmin: true })).toBe(true)
    expect(isFullAdmin({ roleId: null, isAdmin: false })).toBe(false)
  })

  it('isFullAdmin returns false for any other granular role', () => {
    expect(isFullAdmin({ roleId: 'role-picker', isAdmin: false })).toBe(false)
    expect(isFullAdmin({ roleId: 'role-picker', isAdmin: true })).toBe(false)
  })
})
