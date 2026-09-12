import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import QRCode from 'qrcode'
import { generateSecret, generateURI, verify } from 'otplib'
import { pool } from '../db.js'

const ISSUER = 'علاء الدين'
const PENDING_LOGIN_TTL_MS = 5 * 60 * 1000
const BACKUP_CODES_COUNT = 8

export interface TwoFactorSetup {
  secret: string
  qrCodeDataUrl: string
}

// بيولّد سر جديد ويخزّنه مؤقتاً (totp_enabled لسه 0) — لسه مش مفعّل لحد ما المستخدم يأكّد
// بكود صحيح عبر confirmTwoFactorSetup، عشان محدش يقفل نفسه بره حسابه بسر غلط اتخزّن بالغلط.
export async function startTwoFactorSetup(userId: string, email: string): Promise<TwoFactorSetup> {
  const secret = generateSecret()
  await pool.query('UPDATE users SET totp_secret = $1, totp_enabled = 0 WHERE id = $2', [secret, userId])
  const uri = generateURI({ issuer: ISSUER, label: email, secret })
  const qrCodeDataUrl = await QRCode.toDataURL(uri)
  return { secret, qrCodeDataUrl }
}

function generateBackupCode(): string {
  return crypto.randomBytes(5).toString('hex')
}

// بيتأكد من أول كود صحيح من تطبيق المصادقة قبل ما يفعّل المصادقة الثنائية فعلياً، وبيولّد
// أكواد احتياطية جديدة (بيمسح القديمة لو موجودة) بيترجعهم نص صريح مرة واحدة بس — مش
// هيتقدروا يتشافوا تاني بعد كده، زي أي نظام أكواد احتياطية معروف.
export async function confirmTwoFactorSetup(userId: string, token: string): Promise<{ error: 'invalid_code' | 'setup_not_started' } | { backupCodes: string[] }> {
  const { rows } = await pool.query<{ totpSecret: string | null }>('SELECT totp_secret as "totpSecret" FROM users WHERE id = $1', [userId])
  const secret = rows[0]?.totpSecret
  if (!secret) return { error: 'setup_not_started' }

  const result = await verify({ secret, token })
  if (!result.valid) return { error: 'invalid_code' }

  await pool.query('UPDATE users SET totp_enabled = 1 WHERE id = $1', [userId])
  await pool.query('DELETE FROM user_backup_codes WHERE user_id = $1', [userId])

  const backupCodes = Array.from({ length: BACKUP_CODES_COUNT }, generateBackupCode)
  for (const code of backupCodes) {
    await pool.query(
      'INSERT INTO user_backup_codes (id, user_id, code_hash) VALUES ($1, $2, $3)',
      [crypto.randomUUID(), userId, bcrypt.hashSync(code, 10)]
    )
  }
  return { backupCodes }
}

// تعطيل المصادقة الثنائية — بيتطلب تأكيد الهوية (كلمة مرور حالية) من المسار المنادي، مش
// بيتحقق منها هنا؛ الدالة دي بس بتنظّف السر والأكواد الاحتياطية وأي جلسة 2FA معلّقة.
export async function disableTwoFactor(userId: string): Promise<void> {
  await pool.query('UPDATE users SET totp_secret = NULL, totp_enabled = 0 WHERE id = $1', [userId])
  await pool.query('DELETE FROM user_backup_codes WHERE user_id = $1', [userId])
  await pool.query('DELETE FROM pending_two_factor_logins WHERE user_id = $1', [userId])
}

export async function isTwoFactorEnabled(userId: string): Promise<boolean> {
  const { rows } = await pool.query<{ totpEnabled: number }>('SELECT totp_enabled as "totpEnabled" FROM users WHERE id = $1', [userId])
  return !!rows[0]?.totpEnabled
}

// بعد التحقق من كلمة المرور بنجاح لحساب مفعّل عليه 2FA — بدل ما ننشئ جلسة فعلية على طول،
// بننشئ توكن وسيط قصير العمر ولمرة واحدة، والعميل لازم يأكّده بكود TOTP صحيح عشان الجلسة
// الحقيقية تتعمل (createSession) في مسار تاني.
export async function createPendingTwoFactorLogin(userId: string): Promise<string> {
  const token = crypto.randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + PENDING_LOGIN_TTL_MS)
  await pool.query(
    'INSERT INTO pending_two_factor_logins (token, user_id, expires_at) VALUES ($1, $2, $3)',
    [token, userId, expiresAt.toISOString()]
  )
  return token
}

async function consumePendingLogin(pendingToken: string): Promise<string | null> {
  const { rows } = await pool.query<{ userId: string }>(
    'SELECT user_id as "userId" FROM pending_two_factor_logins WHERE token = $1 AND expires_at > now()',
    [pendingToken]
  )
  const row = rows[0]
  if (!row) return null
  await pool.query('DELETE FROM pending_two_factor_logins WHERE token = $1', [pendingToken])
  return row.userId
}

// بيتحقق من كود TOTP أو كود احتياطي (لو TOTP مش متاح) — وبيرجّع الـ userId لو صح عشان
// المسار المنادي ينشئ الجلسة الفعلية بيه. توكن الجلسة المعلّقة بيتستهلك لمرة واحدة بس هنا،
// حتى لو الكود غلط (يمنع محاولات تخمين متكررة على نفس التوكن).
export async function verifyPendingTwoFactorLogin(pendingToken: string, code: string): Promise<{ error: 'invalid_or_expired_login' | 'invalid_code' } | { userId: string }> {
  const userId = await consumePendingLogin(pendingToken)
  if (!userId) return { error: 'invalid_or_expired_login' }

  const { rows } = await pool.query<{ totpSecret: string | null }>('SELECT totp_secret as "totpSecret" FROM users WHERE id = $1', [userId])
  const secret = rows[0]?.totpSecret
  // otplib.verify بيرمي استثناء لو الكود مش 6 أرقام (زي الأكواد الاحتياطية اللي طولها مختلف)
  // بدل ما يرجّع valid:false، فلازم نتحقق من الشكل الأول قبل ما نناديه.
  if (secret && /^\d{6}$/.test(code)) {
    const result = await verify({ secret, token: code })
    if (result.valid) return { userId }
  }

  const usedBackupCode = await tryConsumeBackupCode(userId, code)
  if (usedBackupCode) return { userId }

  return { error: 'invalid_code' }
}

async function tryConsumeBackupCode(userId: string, code: string): Promise<boolean> {
  const { rows } = await pool.query<{ id: string; codeHash: string }>(
    'SELECT id, code_hash as "codeHash" FROM user_backup_codes WHERE user_id = $1 AND used = 0',
    [userId]
  )
  for (const row of rows) {
    if (bcrypt.compareSync(code, row.codeHash)) {
      await pool.query('UPDATE user_backup_codes SET used = 1 WHERE id = $1', [row.id])
      return true
    }
  }
  return false
}

export async function countRemainingBackupCodes(userId: string): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(
    'SELECT COUNT(*) as n FROM user_backup_codes WHERE user_id = $1 AND used = 0',
    [userId]
  )
  return Number(rows[0].n)
}
