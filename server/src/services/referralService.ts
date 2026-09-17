import crypto from 'node:crypto'
import { pool } from '../db.js'

// كود قصير قابل للمشاركة (8 حروف hex كبيرة) — مش حساس أمنياً (بيتشارك علناً)، على عكس
// guest_tracking_token اللي لازم entropy عالي وعشوائي تماماً لأنه بيثبت ملكية طلب.
function generateCandidateCode(): string {
  return crypto.randomBytes(4).toString('hex').toUpperCase()
}

export async function getOrCreateReferralCode(userId: string): Promise<string> {
  const { rows } = await pool.query<{ code: string }>('SELECT code FROM referral_codes WHERE user_id = $1', [userId])
  if (rows[0]) return rows[0].code

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateCandidateCode()
    try {
      await pool.query('INSERT INTO referral_codes (user_id, code) VALUES ($1, $2)', [userId, code])
      return code
    } catch (err) {
      if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === '23505') continue
      throw err
    }
  }
  throw new Error('referral_code_generation_failed')
}

export async function getReferralCodeOwner(code: string): Promise<string | null> {
  const trimmed = code.trim().toUpperCase()
  if (!trimmed) return null
  const { rows } = await pool.query<{ userId: string }>('SELECT user_id as "userId" FROM referral_codes WHERE code = $1', [trimmed])
  return rows[0]?.userId ?? null
}

// بيتنفّذ وقت التسجيل — best-effort تماماً، كود مش موجود أو محاولة إحالة نفسه بيتم تجاهلهم
// بصمت من غير ما يمنعوا إنشاء الحساب نفسه (نفس مبدأ التسامح المستخدم مع فشل إشعارات Push).
export async function recordReferralSignup(referrerUserId: string, referredUserId: string, code: string): Promise<void> {
  if (referrerUserId === referredUserId) return
  await pool.query(
    `INSERT INTO referrals (referrer_user_id, referred_user_id, referral_code)
     VALUES ($1, $2, $3) ON CONFLICT (referred_user_id) DO NOTHING`,
    [referrerUserId, referredUserId, code.trim().toUpperCase()]
  )
}

export interface ReferralStats {
  pending: number
  rewarded: number
}

export async function getReferralStats(userId: string): Promise<ReferralStats> {
  const { rows } = await pool.query<{ status: string, n: string }>(
    'SELECT status, COUNT(*) as n FROM referrals WHERE referrer_user_id = $1 GROUP BY status',
    [userId]
  )
  const stats: ReferralStats = { pending: 0, rewarded: 0 }
  for (const row of rows) {
    if (row.status === 'pending') stats.pending = Number(row.n)
    else if (row.status === 'rewarded') stats.rewarded = Number(row.n)
  }
  return stats
}
