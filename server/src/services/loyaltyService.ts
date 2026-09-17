import type { PoolClient } from 'pg'
import { pool } from '../db.js'

export type LoyaltySourceType = 'order_delivered' | 'referral_bonus' | 'manual_adjustment'

export interface LoyaltyLedgerEntry {
  id: number
  pointsChange: number
  sourceType: LoyaltySourceType
  sourceOrderId: string | null
  note: string
  createdAt: string
}

const SELECT_LEDGER = `
  SELECT id, points_change as "pointsChange", source_type as "sourceType",
         source_order_id as "sourceOrderId", note, created_at as "createdAt"
  FROM loyalty_ledger
`

export async function getLoyaltyBalance(userId: string): Promise<number> {
  const { rows } = await pool.query<{ balance: string | null }>(
    'SELECT SUM(points_change)::int as balance FROM loyalty_ledger WHERE user_id = $1',
    [userId]
  )
  return Number(rows[0]?.balance ?? 0)
}

export async function listLoyaltyLedger(userId: string, page = 1, limit = 20): Promise<{ entries: LoyaltyLedgerEntry[], total: number }> {
  const offset = (page - 1) * limit
  const [{ rows: entries }, { rows: countRows }] = await Promise.all([
    pool.query<LoyaltyLedgerEntry>(
      `${SELECT_LEDGER} WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    ),
    pool.query<{ n: string }>('SELECT COUNT(*) as n FROM loyalty_ledger WHERE user_id = $1', [userId])
  ])
  return { entries, total: Number(countRows[0]?.n ?? 0) }
}

// تعديل يدوي من الإدارة (زيادة أو خصم نقاط) — نفس مبدأ product_cost_history: سجل جديد
// دايماً، مفيش أي تعديل أو حذف لسجل قديم.
export async function adjustLoyaltyPointsManually(userId: string, pointsChange: number, note: string, adminUserId: string): Promise<void> {
  await pool.query(
    `INSERT INTO loyalty_ledger (user_id, points_change, source_type, note, created_by_admin_id)
     VALUES ($1, $2, 'manual_adjustment', $3, $4)`,
    [userId, pointsChange, note, adminUserId]
  )
}

async function getLoyaltyEarnRate(client: PoolClient): Promise<number> {
  const { rows } = await client.query<{ rate: number }>('SELECT loyalty_points_per_egp as rate FROM store_settings WHERE id = 1')
  return Number(rows[0]?.rate ?? 0)
}

async function getReferralBonusPoints(client: PoolClient): Promise<number> {
  const { rows } = await client.query<{ points: number }>('SELECT referral_bonus_points as points FROM store_settings WHERE id = 1')
  return Number(rows[0]?.points ?? 0)
}

// بتتنفّذ جوه نفس معاملة تحديث حالة الطلب لـ 'delivered' (نفس نمط recordOrderStatusChange) —
// عميل زائر بدون حساب (user_id = NULL) ما بيكسبش نقاط أصلاً، لأن مفيش حساب دائم يتحسب عليه
// الرصيد أو يتم استرجاعه بيه لاحقاً. النقاط بتتحسب على (الإجمالي - رسوم التوصيل) عشان رسوم
// الشحن مش قيمة شراء فعلية من المتجر.
export async function grantPointsForDeliveredOrder(client: PoolClient, orderId: string): Promise<void> {
  const { rows } = await client.query<{ userId: string | null, total: number, deliveryFee: number }>(
    'SELECT user_id as "userId", total, delivery_fee as "deliveryFee" FROM orders WHERE id = $1',
    [orderId]
  )
  const order = rows[0]
  if (!order || !order.userId) return

  const eligibleAmount = Math.max(0, Number(order.total) - Number(order.deliveryFee))
  const rate = await getLoyaltyEarnRate(client)
  const points = Math.floor(eligibleAmount * rate)
  if (points <= 0) return

  const result = await client.query(
    `INSERT INTO loyalty_ledger (user_id, points_change, source_type, source_order_id, note)
     VALUES ($1, $2, 'order_delivered', $3, $4)
     ON CONFLICT (source_order_id) WHERE source_type = 'order_delivered' DO NOTHING`,
    [order.userId, points, orderId, `نقاط طلب رقم ${orderId}`]
  )
  // مفيش صف جديد اتضاف يبقى الطلب ده سبق منح نقاط عليه (استدعاء مكرر) — منع الازدواجية.
  if (!result.rowCount) return

  await maybeRewardReferralForFirstDelivery(client, order.userId)
}

// أول طلب "delivered" فعلي للمُحال بس هو اللي بيكافئ المُحيل — بمجرد ما referrals.status
// يبقى 'rewarded' مفيش أي طلب لاحق هيلاقي صف pending تاني، يعني المكافأة مرة واحدة مضمونة.
async function maybeRewardReferralForFirstDelivery(client: PoolClient, referredUserId: string): Promise<void> {
  const { rows } = await client.query<{ id: number, referrerUserId: string }>(
    `SELECT id, referrer_user_id as "referrerUserId" FROM referrals WHERE referred_user_id = $1 AND status = 'pending' FOR UPDATE`,
    [referredUserId]
  )
  const referral = rows[0]
  if (!referral) return

  const bonus = await getReferralBonusPoints(client)
  if (bonus > 0) {
    await client.query(
      `INSERT INTO loyalty_ledger (user_id, points_change, source_type, note) VALUES ($1, $2, 'referral_bonus', $3)`,
      [referral.referrerUserId, bonus, 'مكافأة إحالة صديق لأول طلب فعلي']
    )
  }
  await client.query(`UPDATE referrals SET status = 'rewarded', rewarded_at = now() WHERE id = $1`, [referral.id])
}
