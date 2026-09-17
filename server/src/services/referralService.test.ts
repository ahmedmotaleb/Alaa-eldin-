import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { pool } from '../db.js'
import { getOrCreateReferralCode, getReferralCodeOwner, recordReferralSignup, getReferralStats } from './referralService.js'

const USER_A = 'test-user-referral-a'
const USER_B = 'test-user-referral-b'
const USER_C = 'test-user-referral-c'

async function insertUser(id: string) {
  await pool.query(
    `INSERT INTO users (id, email, password_hash, full_name, created_at) VALUES ($1, $1 || '@test.local', 'x', 'عميل اختبار', now())`,
    [id]
  )
}

async function resetFixtures() {
  await pool.query('DELETE FROM referrals')
  await pool.query('DELETE FROM referral_codes')
  await pool.query('DELETE FROM users WHERE id IN ($1, $2, $3)', [USER_A, USER_B, USER_C])
  await insertUser(USER_A)
  await insertUser(USER_B)
  await insertUser(USER_C)
}

beforeEach(async () => {
  await resetFixtures()
})

afterAll(async () => {
  await pool.end()
})

describe('getOrCreateReferralCode', () => {
  it('generates a code on first call and returns the exact same code on later calls', async () => {
    const first = await getOrCreateReferralCode(USER_A)
    const second = await getOrCreateReferralCode(USER_A)
    expect(first).toBe(second)
    expect(first).toMatch(/^[0-9A-F]{8}$/)
  })

  it('generates distinct codes for different users', async () => {
    const a = await getOrCreateReferralCode(USER_A)
    const b = await getOrCreateReferralCode(USER_B)
    expect(a).not.toBe(b)
  })
})

describe('getReferralCodeOwner', () => {
  it('resolves a code to its owning user, case-insensitively', async () => {
    const code = await getOrCreateReferralCode(USER_A)
    expect(await getReferralCodeOwner(code.toLowerCase())).toBe(USER_A)
  })

  it('returns null for an unknown code', async () => {
    expect(await getReferralCodeOwner('NOPE0000')).toBeNull()
  })
})

describe('recordReferralSignup / getReferralStats', () => {
  it('records a pending referral', async () => {
    const code = await getOrCreateReferralCode(USER_A)
    await recordReferralSignup(USER_A, USER_B, code)
    expect(await getReferralStats(USER_A)).toEqual({ pending: 1, rewarded: 0 })
  })

  it('ignores a self-referral attempt (referrer === referred)', async () => {
    const code = await getOrCreateReferralCode(USER_A)
    await recordReferralSignup(USER_A, USER_A, code)
    const { rows } = await pool.query('SELECT count(*) as n FROM referrals')
    expect(Number(rows[0].n)).toBe(0)
  })

  it('a user can only ever be referred once — a later attempt by a different referrer is ignored', async () => {
    const codeA = await getOrCreateReferralCode(USER_A)
    const codeC = await getOrCreateReferralCode(USER_C)
    await recordReferralSignup(USER_A, USER_B, codeA)
    await recordReferralSignup(USER_C, USER_B, codeC)

    expect(await getReferralStats(USER_A)).toEqual({ pending: 1, rewarded: 0 })
    expect(await getReferralStats(USER_C)).toEqual({ pending: 0, rewarded: 0 })
  })
})
