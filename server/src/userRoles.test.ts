// اختبار تكامل مباشر على قاعدة البيانات لعمود users.role اللي أضافته migration 0020 —
// بيتأكد من القيمة الافتراضية ('staff') وقيد CHECK اللي بيمنع أي قيمة غير 'staff'/'admin'.
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import crypto from 'node:crypto'
import { pool } from './db.js'

const TEST_EMAIL_PREFIX = 'role-test-'

async function cleanup() {
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${TEST_EMAIL_PREFIX}%`])
}

beforeEach(cleanup)

afterAll(async () => {
  await cleanup()
  await pool.end()
})

async function insertUser(overrides: { isAdmin?: number, role?: string } = {}) {
  const id = crypto.randomUUID()
  const email = `${TEST_EMAIL_PREFIX}${id}@test.local`
  const isAdmin = overrides.isAdmin ?? 0
  if (overrides.role !== undefined) {
    await pool.query(
      'INSERT INTO users (id, email, password_hash, full_name, created_at, is_admin, role) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [id, email, 'x', 'مستخدم اختبار', new Date().toISOString(), isAdmin, overrides.role]
    )
  } else {
    await pool.query(
      'INSERT INTO users (id, email, password_hash, full_name, created_at, is_admin) VALUES ($1, $2, $3, $4, $5, $6)',
      [id, email, 'x', 'مستخدم اختبار', new Date().toISOString(), isAdmin]
    )
  }
  return id
}

describe('users.role column (migration 0020_user_roles)', () => {
  it('defaults a newly created user to the staff role', async () => {
    const id = await insertUser()
    const { rows } = await pool.query<{ role: string }>('SELECT role FROM users WHERE id = $1', [id])
    expect(rows[0].role).toBe('staff')
  })

  it('accepts the admin role value explicitly', async () => {
    const id = await insertUser({ role: 'admin', isAdmin: 1 })
    const { rows } = await pool.query<{ role: string }>('SELECT role FROM users WHERE id = $1', [id])
    expect(rows[0].role).toBe('admin')
  })

  it('rejects an invalid role value at the database level', async () => {
    await expect(insertUser({ role: 'superadmin' })).rejects.toThrow()
  })
})
