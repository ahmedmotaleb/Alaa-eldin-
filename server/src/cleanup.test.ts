// اختبار تكامل حقيقي — بيتأكد إن التنظيف بيمسح الصفوف المنتهية فعلاً بس، وإن أي جلسة/توكن
// لسه صالح (حتى لو مش مُستخدم دلوقتي) يفضل موجود من غير ما يتأثر.
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import crypto from 'node:crypto'
import { pool } from './db.js'
import { cleanupExpiredRows } from './cleanup.js'

const USER_ID = 'cleanup-test-user'

async function resetFixtures() {
  await pool.query('DELETE FROM sessions WHERE user_id = $1', [USER_ID])
  await pool.query('DELETE FROM password_resets WHERE user_id = $1', [USER_ID])
  await pool.query('DELETE FROM users WHERE id = $1', [USER_ID])
  await pool.query(
    `INSERT INTO users (id, email, password_hash, full_name, created_at) VALUES ($1, 'cleanup-test@test.local', 'x', 'مستخدم اختبار', now())`,
    [USER_ID]
  )
}

beforeEach(resetFixtures)

afterAll(async () => {
  await resetFixtures()
  await pool.end()
})

describe('cleanupExpiredRows', () => {
  it('deletes an expired session but keeps an active one', async () => {
    const expiredToken = crypto.randomBytes(8).toString('hex')
    const activeToken = crypto.randomBytes(8).toString('hex')
    await pool.query(
      `INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES ($1, $2, now() - interval '40 days', now() - interval '10 days')`,
      [expiredToken, USER_ID]
    )
    await pool.query(
      `INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES ($1, $2, now(), now() + interval '30 days')`,
      [activeToken, USER_ID]
    )

    const { sessionsDeleted } = await cleanupExpiredRows()
    expect(sessionsDeleted).toBeGreaterThanOrEqual(1)

    const { rows } = await pool.query('SELECT token FROM sessions WHERE user_id = $1', [USER_ID])
    expect(rows.map(r => r.token)).toEqual([activeToken])
  })

  it('deletes an expired password reset token but keeps an active one', async () => {
    const expiredToken = crypto.randomBytes(8).toString('hex')
    const activeToken = crypto.randomBytes(8).toString('hex')
    await pool.query(
      `INSERT INTO password_resets (token, user_id, created_at, expires_at) VALUES ($1, $2, now() - interval '2 hours', now() - interval '1 hour')`,
      [expiredToken, USER_ID]
    )
    await pool.query(
      `INSERT INTO password_resets (token, user_id, created_at, expires_at) VALUES ($1, $2, now(), now() + interval '1 hour')`,
      [activeToken, USER_ID]
    )

    const { passwordResetsDeleted } = await cleanupExpiredRows()
    expect(passwordResetsDeleted).toBeGreaterThanOrEqual(1)

    const { rows } = await pool.query('SELECT token FROM password_resets WHERE user_id = $1', [USER_ID])
    expect(rows.map(r => r.token)).toEqual([activeToken])
  })
})
