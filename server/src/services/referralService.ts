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
  qualified: number
  rewarded: number
}

export async function getReferralStats(userId: string): Promise<ReferralStats> {
  const { rows } = await pool.query<{ status: string, n: string }>(
    'SELECT status, COUNT(*) as n FROM referrals WHERE referrer_user_id = $1 GROUP BY status',
    [userId]
  )
  const stats: ReferralStats = { pending: 0, qualified: 0, rewarded: 0 }
  for (const row of rows) {
    if (row.status === 'pending') stats.pending = Number(row.n)
    else if (row.status === 'qualified') stats.qualified = Number(row.n)
    else if (row.status === 'rewarded') stats.rewarded = Number(row.n)
  }
  return stats
}

// ---------- لوحة تحكم الإدارة: قائمة/تفاصيل/تحليلات الإحالات ----------

export type AdminReferralStatus = 'pending' | 'qualified' | 'rewarded'

export interface AdminReferralFilter {
  status?: AdminReferralStatus
  search?: string
  dateFrom?: string
  dateTo?: string
  page: number
  limit: number
}

export interface AdminReferralRow {
  id: number
  referralCode: string
  status: AdminReferralStatus
  createdAt: string
  rewardedAt: string | null
  referrerUserId: string
  referrerName: string
  referredUserId: string
  referredName: string
  qualifyingOrderId: string | null
  qualifyingOrderNumber: string | null
  qualifyingOrderValue: number | null
  referrerRewardPoints: number | null
  referredRewardPoints: number | null
}

const ADMIN_REFERRAL_SELECT = `
  SELECT r.id, r.referral_code as "referralCode", r.status, r.created_at as "createdAt", r.rewarded_at as "rewardedAt",
         r.referrer_user_id as "referrerUserId", ru.full_name as "referrerName",
         r.referred_user_id as "referredUserId", rd.full_name as "referredName",
         r.qualifying_order_id as "qualifyingOrderId", qo.order_number as "qualifyingOrderNumber",
         r.qualifying_order_value as "qualifyingOrderValue",
         r.referrer_reward_points as "referrerRewardPoints", r.referred_reward_points as "referredRewardPoints"
  FROM referrals r
  JOIN users ru ON ru.id = r.referrer_user_id
  JOIN users rd ON rd.id = r.referred_user_id
  LEFT JOIN orders qo ON qo.id = r.qualifying_order_id
`

export async function listReferralsForAdmin(filter: AdminReferralFilter): Promise<{ referrals: AdminReferralRow[], total: number }> {
  const conditions: string[] = []
  const values: unknown[] = []

  if (filter.status) {
    values.push(filter.status)
    conditions.push(`r.status = $${values.length}`)
  }
  if (filter.dateFrom) {
    values.push(filter.dateFrom)
    conditions.push(`r.created_at >= $${values.length}`)
  }
  if (filter.dateTo) {
    values.push(filter.dateTo)
    conditions.push(`r.created_at <= $${values.length}`)
  }
  if (filter.search && filter.search.trim()) {
    const term = `%${filter.search.trim()}%`
    values.push(term, term, term, term, term)
    const i = values.length
    conditions.push(`(
      r.referral_code ILIKE $${i - 4} OR ru.full_name ILIKE $${i - 3} OR rd.full_name ILIKE $${i - 2}
      OR ru.mobile ILIKE $${i - 1} OR rd.mobile ILIKE $${i}
    )`)
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const offset = (filter.page - 1) * filter.limit
  const limitIdx = values.length + 1
  const offsetIdx = values.length + 2

  const [{ rows: referrals }, { rows: countRows }] = await Promise.all([
    pool.query<AdminReferralRow>(
      `${ADMIN_REFERRAL_SELECT} ${whereClause} ORDER BY r.created_at DESC, r.id DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      [...values, filter.limit, offset]
    ),
    pool.query<{ n: string }>(
      `SELECT COUNT(*) as n FROM referrals r JOIN users ru ON ru.id = r.referrer_user_id JOIN users rd ON rd.id = r.referred_user_id ${whereClause}`,
      values
    )
  ])

  return { referrals, total: Number(countRows[0]?.n ?? 0) }
}

export async function getReferralDetailForAdmin(id: number): Promise<AdminReferralRow | null> {
  const { rows } = await pool.query<AdminReferralRow>(`${ADMIN_REFERRAL_SELECT} WHERE r.id = $1`, [id])
  return rows[0] ?? null
}

export interface ReferralAnalytics {
  totalReferrals: number
  pendingReferrals: number
  qualifiedReferrals: number
  rewardedReferrals: number
  customersAcquired: number
  totalPointsAwarded: number
  revenueFromQualifyingOrders: number
  // نسبة التحويل = عدد الإحالات اللي اتأهّلت (qualified أو rewarded) ÷ إجمالي العملاء
  // المُحالين المسجّلين (كل صف referrals بيمثّل عميل مُحال واحد مسجّل بالفعل). القيمة دي
  // "إيراد" خام من الطلبات المؤهِّلة، مش ربح — لا تُفسَّر كصافي ربح أبداً.
  conversionRate: number
}

export async function getReferralAnalytics(): Promise<ReferralAnalytics> {
  const { rows: statusRows } = await pool.query<{ status: string, n: string }>(
    'SELECT status, COUNT(*) as n FROM referrals GROUP BY status'
  )
  let pendingReferrals = 0, qualifiedReferrals = 0, rewardedReferrals = 0
  for (const row of statusRows) {
    if (row.status === 'pending') pendingReferrals = Number(row.n)
    else if (row.status === 'qualified') qualifiedReferrals = Number(row.n)
    else if (row.status === 'rewarded') rewardedReferrals = Number(row.n)
  }
  const totalReferrals = pendingReferrals + qualifiedReferrals + rewardedReferrals

  const { rows: aggregateRows } = await pool.query<{ totalPoints: string | null, totalRevenue: string | null }>(
    `SELECT
       COALESCE(SUM(COALESCE(referrer_reward_points, 0) + COALESCE(referred_reward_points, 0)), 0) as "totalPoints",
       COALESCE(SUM(qualifying_order_value), 0) as "totalRevenue"
     FROM referrals`
  )

  const customersAcquired = totalReferrals // كل صف referrals هو عميل واحد اتسجّل عن طريق إحالة فعلية.
  const qualifiedOrRewarded = qualifiedReferrals + rewardedReferrals
  const conversionRate = customersAcquired > 0 ? qualifiedOrRewarded / customersAcquired : 0

  return {
    totalReferrals, pendingReferrals, qualifiedReferrals, rewardedReferrals, customersAcquired,
    totalPointsAwarded: Number(aggregateRows[0]?.totalPoints ?? 0),
    revenueFromQualifyingOrders: Number(aggregateRows[0]?.totalRevenue ?? 0),
    conversionRate
  }
}
