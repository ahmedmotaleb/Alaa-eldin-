import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { generate } from 'otplib'
import { pool } from '../db.js'
import {
  startTwoFactorSetup,
  confirmTwoFactorSetup,
  disableTwoFactor,
  isTwoFactorEnabled,
  createPendingTwoFactorLogin,
  verifyPendingTwoFactorLogin,
  countRemainingBackupCodes
} from './twoFactorService.js'

const USER_ID = 'test-user-2fa'
const USER_EMAIL = 'test-user-2fa@test.local'

async function insertUser() {
  await pool.query(
    `INSERT INTO users (id, email, password_hash, full_name, created_at, is_admin, role, role_id)
     VALUES ($1, $2, 'x', 'مستخدم اختبار', now(), 1, 'admin', null)`,
    [USER_ID, USER_EMAIL]
  )
}

async function resetFixtures() {
  await pool.query('DELETE FROM pending_two_factor_logins WHERE user_id = $1', [USER_ID])
  await pool.query('DELETE FROM user_backup_codes WHERE user_id = $1', [USER_ID])
  await pool.query('DELETE FROM users WHERE id = $1', [USER_ID])
}

describe('twoFactorService', () => {
  beforeEach(async () => {
    await resetFixtures()
    await insertUser()
  })
  afterAll(resetFixtures)

  it('starts setup with a secret and a QR code data URL, not yet enabled', async () => {
    const setup = await startTwoFactorSetup(USER_ID, USER_EMAIL)
    expect(setup.secret).toBeTruthy()
    expect(setup.qrCodeDataUrl.startsWith('data:image/png;base64,')).toBe(true)
    expect(await isTwoFactorEnabled(USER_ID)).toBe(false)
  })

  it('rejects confirm with an invalid code', async () => {
    await startTwoFactorSetup(USER_ID, USER_EMAIL)
    const result = await confirmTwoFactorSetup(USER_ID, '000000')
    expect(result).toEqual({ error: 'invalid_code' })
    expect(await isTwoFactorEnabled(USER_ID)).toBe(false)
  })

  it('rejects confirm when setup was never started', async () => {
    const result = await confirmTwoFactorSetup(USER_ID, '123456')
    expect(result).toEqual({ error: 'setup_not_started' })
  })

  it('confirms with a valid code, enabling 2FA and returning 8 one-time backup codes', async () => {
    const setup = await startTwoFactorSetup(USER_ID, USER_EMAIL)
    const validToken = await generate({ secret: setup.secret })

    const result = await confirmTwoFactorSetup(USER_ID, validToken)
    if (!('backupCodes' in result)) throw new Error('expected backupCodes')
    expect(result.backupCodes).toHaveLength(8)
    expect(new Set(result.backupCodes).size).toBe(8)
    expect(await isTwoFactorEnabled(USER_ID)).toBe(true)
    expect(await countRemainingBackupCodes(USER_ID)).toBe(8)
  })

  it('creates a pending login and verifies it with a valid TOTP code, consuming the pending token', async () => {
    const setup = await startTwoFactorSetup(USER_ID, USER_EMAIL)
    const validToken = await generate({ secret: setup.secret })
    await confirmTwoFactorSetup(USER_ID, validToken)

    const pendingToken = await createPendingTwoFactorLogin(USER_ID)
    const loginToken = await generate({ secret: setup.secret })
    const result = await verifyPendingTwoFactorLogin(pendingToken, loginToken)
    expect(result).toEqual({ userId: USER_ID })

    // نفس التوكن المعلّق ميستخدمش تاني (استُهلك من أول محاولة)
    const secondAttempt = await verifyPendingTwoFactorLogin(pendingToken, loginToken)
    expect(secondAttempt).toEqual({ error: 'invalid_or_expired_login' })
  })

  it('rejects verifyPendingTwoFactorLogin with a wrong code but still consumes the pending token', async () => {
    const setup = await startTwoFactorSetup(USER_ID, USER_EMAIL)
    const validToken = await generate({ secret: setup.secret })
    await confirmTwoFactorSetup(USER_ID, validToken)

    const pendingToken = await createPendingTwoFactorLogin(USER_ID)
    const result = await verifyPendingTwoFactorLogin(pendingToken, '000000')
    expect(result).toEqual({ error: 'invalid_code' })

    const secondAttempt = await verifyPendingTwoFactorLogin(pendingToken, '000000')
    expect(secondAttempt).toEqual({ error: 'invalid_or_expired_login' })
  })

  it('rejects verifyPendingTwoFactorLogin for an unknown/expired pending token', async () => {
    const result = await verifyPendingTwoFactorLogin('does-not-exist', '000000')
    expect(result).toEqual({ error: 'invalid_or_expired_login' })
  })

  it('accepts a single-use backup code in place of a TOTP code, then rejects reuse of the same code', async () => {
    const setup = await startTwoFactorSetup(USER_ID, USER_EMAIL)
    const validToken = await generate({ secret: setup.secret })
    const confirmResult = await confirmTwoFactorSetup(USER_ID, validToken)
    if (!('backupCodes' in confirmResult)) throw new Error('expected backupCodes')
    const backupCode = confirmResult.backupCodes[0]

    const pendingToken = await createPendingTwoFactorLogin(USER_ID)
    const result = await verifyPendingTwoFactorLogin(pendingToken, backupCode)
    expect(result).toEqual({ userId: USER_ID })
    expect(await countRemainingBackupCodes(USER_ID)).toBe(7)

    const pendingToken2 = await createPendingTwoFactorLogin(USER_ID)
    const reuseResult = await verifyPendingTwoFactorLogin(pendingToken2, backupCode)
    expect(reuseResult).toEqual({ error: 'invalid_code' })
  })

  it('disables 2FA, clearing the secret, backup codes, and any pending logins', async () => {
    const setup = await startTwoFactorSetup(USER_ID, USER_EMAIL)
    const validToken = await generate({ secret: setup.secret })
    await confirmTwoFactorSetup(USER_ID, validToken)
    await createPendingTwoFactorLogin(USER_ID)

    await disableTwoFactor(USER_ID)

    expect(await isTwoFactorEnabled(USER_ID)).toBe(false)
    expect(await countRemainingBackupCodes(USER_ID)).toBe(0)
    const { rows } = await pool.query('SELECT * FROM pending_two_factor_logins WHERE user_id = $1', [USER_ID])
    expect(rows).toHaveLength(0)
  })
})
