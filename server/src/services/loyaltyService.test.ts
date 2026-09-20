import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { pool, withTransaction } from '../db.js'
import {
  getLoyaltyBalance, listLoyaltyLedger, adjustLoyaltyPointsManually, grantPointsForDeliveredOrder,
  calculateLoyaltyRedemption, lockAndValidateLoyaltyRedemption, commitLoyaltyRedemption,
  restoreRedeemedPointsForOrder, reverseEarnedPointsForOrder, runLoyaltyExpiryBatch,
  listUpcomingLoyaltyExpiry, getLoyaltySettings, type LoyaltySettings
} from './loyaltyService.js'
import { getOrCreateReferralCode, recordReferralSignup, getReferralStats } from './referralService.js'

const REFERRER_ID = 'test-user-loyalty-referrer'
const CUSTOMER_ID = 'test-user-loyalty-customer'
const ADMIN_ID = 'test-user-loyalty-admin'

async function insertUser(id: string) {
  await pool.query(
    `INSERT INTO users (id, email, password_hash, full_name, created_at) VALUES ($1, $1 || '@test.local', 'x', 'عميل اختبار', now())`,
    [id]
  )
}

async function insertOrder(id: string, userId: string | null, total: number, deliveryFee: number, status = 'delivered') {
  await pool.query(
    `INSERT INTO orders (id, order_number, user_id, customer_full_name, customer_mobile, customer_governorate, customer_address,
                          delivery_slot, payment_method, subtotal, delivery_fee, total, status, created_at)
     VALUES ($1, $1, $2, 'عميل', '01012345678', 'القاهرة', 'عنوان', 'morning', 'cod', $3, $4, $5, $6, now())`,
    [id, userId, total - deliveryFee, deliveryFee, total, status]
  )
}

async function resetFixtures() {
  await pool.query('DELETE FROM loyalty_ledger')
  await pool.query('DELETE FROM referrals')
  await pool.query('DELETE FROM referral_codes')
  await pool.query('DELETE FROM order_items')
  await pool.query('DELETE FROM orders')
  await pool.query('DELETE FROM users WHERE id IN ($1, $2, $3)', [REFERRER_ID, CUSTOMER_ID, ADMIN_ID])
  await insertUser(REFERRER_ID)
  await insertUser(CUSTOMER_ID)
  await insertUser(ADMIN_ID)
  await pool.query(`
    UPDATE store_settings SET
      loyalty_points_per_egp = 0.1, referral_bonus_points = 50,
      loyalty_enabled = 1, loyalty_point_value_egp = 0.05, loyalty_min_redeem_points = 100,
      loyalty_max_redemption_percent = 20, loyalty_min_order_for_redemption = 0,
      loyalty_expiry_enabled = 0, loyalty_expiry_days = 365, loyalty_expiry_warning_days = 30,
      referral_enabled = 1, referral_referred_bonus_points = 0, referral_min_qualifying_order = 0
    WHERE id = 1
  `)
}

async function settings(overrides: Partial<LoyaltySettings> = {}): Promise<LoyaltySettings> {
  return { ...(await getLoyaltySettings()), ...overrides }
}

beforeEach(async () => {
  await resetFixtures()
})

afterAll(async () => {
  await pool.end()
})

describe('getLoyaltyBalance / listLoyaltyLedger / adjustLoyaltyPointsManually', () => {
  it('returns 0 balance for a user with no ledger entries', async () => {
    expect(await getLoyaltyBalance(CUSTOMER_ID)).toBe(0)
  })

  it('a manual adjustment creates a real ledger row and updates the balance', async () => {
    await adjustLoyaltyPointsManually(CUSTOMER_ID, 100, 'مكافأة يدوية', ADMIN_ID)
    expect(await getLoyaltyBalance(CUSTOMER_ID)).toBe(100)
    const { entries, total } = await listLoyaltyLedger(CUSTOMER_ID)
    expect(total).toBe(1)
    expect(entries[0]).toMatchObject({ pointsChange: 100, sourceType: 'manual_adjustment', note: 'مكافأة يدوية' })
  })

  it('balance correctly sums multiple entries, including a negative manual deduction', async () => {
    await adjustLoyaltyPointsManually(CUSTOMER_ID, 100, 'إضافة', ADMIN_ID)
    await adjustLoyaltyPointsManually(CUSTOMER_ID, -30, 'خصم', ADMIN_ID)
    expect(await getLoyaltyBalance(CUSTOMER_ID)).toBe(70)
  })

  it('lists ledger entries newest first', async () => {
    await adjustLoyaltyPointsManually(CUSTOMER_ID, 10, 'أول', ADMIN_ID)
    await adjustLoyaltyPointsManually(CUSTOMER_ID, 20, 'ثاني', ADMIN_ID)
    const { entries } = await listLoyaltyLedger(CUSTOMER_ID)
    expect(entries.map(e => e.note)).toEqual(['ثاني', 'أول'])
  })
})

describe('grantPointsForDeliveredOrder', () => {
  it('grants floor(eligible amount * rate) points for a delivered order with a real account', async () => {
    await insertOrder('loy-order-1', CUSTOMER_ID, 235, 30)
    await withTransaction(client => grantPointsForDeliveredOrder(client, 'loy-order-1'))
    // eligible = 235 - 30 = 205, rate 0.1 -> 20.5 -> floor 20
    expect(await getLoyaltyBalance(CUSTOMER_ID)).toBe(20)
  })

  it('grants nothing for a guest order (no user account to credit)', async () => {
    await insertOrder('loy-order-guest', null, 500, 0)
    await withTransaction(client => grantPointsForDeliveredOrder(client, 'loy-order-guest'))
    const { rows } = await pool.query('SELECT count(*) as n FROM loyalty_ledger')
    expect(Number(rows[0].n)).toBe(0)
  })

  it('grants nothing when the eligible amount rounds down to 0 points', async () => {
    await insertOrder('loy-order-tiny', CUSTOMER_ID, 5, 0)
    await withTransaction(client => grantPointsForDeliveredOrder(client, 'loy-order-tiny'))
    expect(await getLoyaltyBalance(CUSTOMER_ID)).toBe(0)
  })

  it('is idempotent — granting twice for the same order only credits points once', async () => {
    await insertOrder('loy-order-2', CUSTOMER_ID, 300, 0)
    await withTransaction(client => grantPointsForDeliveredOrder(client, 'loy-order-2'))
    await withTransaction(client => grantPointsForDeliveredOrder(client, 'loy-order-2'))
    expect(await getLoyaltyBalance(CUSTOMER_ID)).toBe(30)
  })

  it("rewards the referrer with bonus points on the referred user's first delivered order, and flips the referral to rewarded", async () => {
    const code = await getOrCreateReferralCode(REFERRER_ID)
    await recordReferralSignup(REFERRER_ID, CUSTOMER_ID, code)

    await insertOrder('loy-order-ref-1', CUSTOMER_ID, 300, 0)
    await withTransaction(client => grantPointsForDeliveredOrder(client, 'loy-order-ref-1'))

    expect(await getLoyaltyBalance(REFERRER_ID)).toBe(50)
    const stats = await getReferralStats(REFERRER_ID)
    expect(stats).toEqual({ pending: 0, qualified: 0, rewarded: 1 })
  })

  it('does not reward the referrer again on a second delivered order for the same referred user', async () => {
    const code = await getOrCreateReferralCode(REFERRER_ID)
    await recordReferralSignup(REFERRER_ID, CUSTOMER_ID, code)

    await insertOrder('loy-order-ref-2a', CUSTOMER_ID, 300, 0)
    await withTransaction(client => grantPointsForDeliveredOrder(client, 'loy-order-ref-2a'))
    await insertOrder('loy-order-ref-2b', CUSTOMER_ID, 300, 0)
    await withTransaction(client => grantPointsForDeliveredOrder(client, 'loy-order-ref-2b'))

    expect(await getLoyaltyBalance(REFERRER_ID)).toBe(50)
  })
})

describe('calculateLoyaltyRedemption (pure)', () => {
  it('treats 0 requested points as always valid, even when the program is disabled', async () => {
    const result = calculateLoyaltyRedemption({
      requestedPoints: 0, balance: 0, eligibleSubtotal: 100, settings: await settings({ loyaltyEnabled: false })
    })
    expect(result).toEqual({ ok: true, pointsToRedeem: 0, discountAmount: 0 })
  })

  it('rejects a negative point count', async () => {
    const result = calculateLoyaltyRedemption({ requestedPoints: -1, balance: 1000, eligibleSubtotal: 300, settings: await settings() })
    expect(result).toEqual({ ok: false, error: 'invalid_points' })
  })

  it('rejects a decimal point count', async () => {
    const result = calculateLoyaltyRedemption({ requestedPoints: 10.5, balance: 1000, eligibleSubtotal: 300, settings: await settings() })
    expect(result).toEqual({ ok: false, error: 'invalid_points' })
  })

  it('rejects a non-finite (NaN) point count', async () => {
    const result = calculateLoyaltyRedemption({ requestedPoints: NaN, balance: 1000, eligibleSubtotal: 300, settings: await settings() })
    expect(result).toEqual({ ok: false, error: 'invalid_points' })
  })

  it('rejects any positive redemption when the loyalty program is disabled', async () => {
    const result = calculateLoyaltyRedemption({
      requestedPoints: 200, balance: 1000, eligibleSubtotal: 300, settings: await settings({ loyaltyEnabled: false })
    })
    expect(result).toEqual({ ok: false, error: 'loyalty_disabled' })
  })

  it('rejects a redemption below the minimum redeemable points', async () => {
    const result = calculateLoyaltyRedemption({
      requestedPoints: 50, balance: 1000, eligibleSubtotal: 300, settings: await settings({ loyaltyMinRedeemPoints: 100 })
    })
    expect(result).toEqual({ ok: false, error: 'below_minimum_redeem_points', details: { minimum: 100 } })
  })

  it('rejects a redemption when the eligible order subtotal is below the configured minimum', async () => {
    const result = calculateLoyaltyRedemption({
      requestedPoints: 200, balance: 1000, eligibleSubtotal: 50,
      settings: await settings({ loyaltyMinOrderForRedemption: 100 })
    })
    expect(result).toEqual({ ok: false, error: 'order_below_minimum_for_redemption', details: { minimumOrder: 100 } })
  })

  it('rejects a redemption that exceeds the current balance (stale frontend balance)', async () => {
    const result = calculateLoyaltyRedemption({
      requestedPoints: 500, balance: 300, eligibleSubtotal: 1000, settings: await settings()
    })
    expect(result).toEqual({ ok: false, error: 'loyalty_balance_changed', details: { balance: 300 } })
  })

  it('rejects a redemption that exceeds the maximum percentage of the eligible subtotal', async () => {
    // eligibleSubtotal 300، 20% أقصى -> أقصى خصم 60 ج.م -> بقيمة نقطة 0.05 يبقى أقصى نقاط 1200،
    // لكن هنا الرصيد نفسه أكبر من كده (عشان نتأكد الرفض بسبب النسبة مش الرصيد) فبنطلب نقاط
    // أكبر من 1200 مباشرة.
    const result = calculateLoyaltyRedemption({
      requestedPoints: 1300, balance: 5000, eligibleSubtotal: 300,
      settings: await settings({ loyaltyPointValueEgp: 0.05, loyaltyMaxRedemptionPercent: 20, loyaltyMinRedeemPoints: 1 })
    })
    expect(result).toEqual({ ok: false, error: 'redemption_exceeds_limit', details: { maxAllowedPoints: 1200 } })
  })

  it('computes the exact worked example from spec: balance 1000, 0.05 EGP/point, subtotal 300, max 20% -> 1000 points = 50 EGP', async () => {
    const result = calculateLoyaltyRedemption({
      requestedPoints: 1000, balance: 1000, eligibleSubtotal: 300,
      settings: await settings({ loyaltyPointValueEgp: 0.05, loyaltyMaxRedemptionPercent: 20, loyaltyMinRedeemPoints: 1 })
    })
    // أقصى خصم بالنسبة = 300 * 20% = 60 ج.م -> 60/0.05 = 1200 نقطة كحد أقصى بالنسبة، لكن
    // الرصيد (1000) هو القيد الفعلي هنا (أقل من 1200) -> النقاط المطلوبة (1000) مسموحة بالكامل.
    expect(result).toEqual({ ok: true, pointsToRedeem: 1000, discountAmount: 50 })
  })
})

describe('lockAndValidateLoyaltyRedemption / commitLoyaltyRedemption (integration)', () => {
  it('rejects any redemption attempt for a guest (no account)', async () => {
    const result = await withTransaction(client => lockAndValidateLoyaltyRedemption(client, null, 200, 1000))
    expect(result).toEqual({ ok: false, error: 'loyalty_disabled' })
  })

  it('locks the real DB balance, commits a redeemed ledger entry, and consumes points FIFO', async () => {
    await adjustLoyaltyPointsManually(CUSTOMER_ID, 500, 'تعبئة', ADMIN_ID)
    await insertOrder('loy-redeem-1', CUSTOMER_ID, 200, 20)

    await withTransaction(async client => {
      const validation = await lockAndValidateLoyaltyRedemption(client, CUSTOMER_ID, 300, 1000)
      expect(validation.ok).toBe(true)
      if (!validation.ok) return
      await commitLoyaltyRedemption(client, CUSTOMER_ID, 'loy-redeem-1', validation.pointsToRedeem)
    })

    expect(await getLoyaltyBalance(CUSTOMER_ID)).toBe(200)
    const { entries } = await listLoyaltyLedger(CUSTOMER_ID)
    expect(entries[0]).toMatchObject({ pointsChange: -300, sourceType: 'redeemed', sourceOrderId: 'loy-redeem-1' })
  })

  it('double-spend protection: two concurrent full-balance redemption attempts — only one may succeed', async () => {
    await adjustLoyaltyPointsManually(CUSTOMER_ID, 200, 'تعبئة', ADMIN_ID)
    await insertOrder('loy-concurrent-a', CUSTOMER_ID, 100, 0)
    await insertOrder('loy-concurrent-b', CUSTOMER_ID, 100, 0)

    async function attempt(orderId: string) {
      return withTransaction(async client => {
        const validation = await lockAndValidateLoyaltyRedemption(client, CUSTOMER_ID, 150, 1000000)
        if (validation.ok && validation.pointsToRedeem > 0) {
          await commitLoyaltyRedemption(client, CUSTOMER_ID, orderId, validation.pointsToRedeem)
        }
        return validation
      })
    }

    const [a, b] = await Promise.all([attempt('loy-concurrent-a'), attempt('loy-concurrent-b')])
    const results = [a, b]
    const succeeded = results.filter(r => r.ok && r.pointsToRedeem > 0)
    const failed = results.filter(r => !r.ok)
    expect(succeeded).toHaveLength(1)
    expect(failed).toHaveLength(1)
    expect(failed[0]).toMatchObject({ ok: false, error: 'loyalty_balance_changed', details: { balance: 50 } })
    // الرصيد النهائي بيعكس نجاح محاولة واحدة بس (200 - 150)، مش الاتنين (200 - 300 = -100).
    expect(await getLoyaltyBalance(CUSTOMER_ID)).toBe(50)
  })
})

describe('restoreRedeemedPointsForOrder', () => {
  it('restores redeemed points via a redemption_reversal entry after order cancellation', async () => {
    await adjustLoyaltyPointsManually(CUSTOMER_ID, 500, 'تعبئة', ADMIN_ID)
    await insertOrder('loy-cancel-1', CUSTOMER_ID, 200, 0)
    await withTransaction(async client => {
      const validation = await lockAndValidateLoyaltyRedemption(client, CUSTOMER_ID, 300, 1000)
      if (validation.ok) await commitLoyaltyRedemption(client, CUSTOMER_ID, 'loy-cancel-1', validation.pointsToRedeem)
    })
    expect(await getLoyaltyBalance(CUSTOMER_ID)).toBe(200)

    await withTransaction(client => restoreRedeemedPointsForOrder(client, 'loy-cancel-1'))
    expect(await getLoyaltyBalance(CUSTOMER_ID)).toBe(500)
    const { entries } = await listLoyaltyLedger(CUSTOMER_ID)
    expect(entries[0]).toMatchObject({ pointsChange: 300, sourceType: 'redemption_reversal', sourceOrderId: 'loy-cancel-1' })
  })

  it('is idempotent — processing the same cancellation twice does not double-credit', async () => {
    await adjustLoyaltyPointsManually(CUSTOMER_ID, 500, 'تعبئة', ADMIN_ID)
    await insertOrder('loy-cancel-2', CUSTOMER_ID, 200, 0)
    await withTransaction(async client => {
      const validation = await lockAndValidateLoyaltyRedemption(client, CUSTOMER_ID, 300, 1000)
      if (validation.ok) await commitLoyaltyRedemption(client, CUSTOMER_ID, 'loy-cancel-2', validation.pointsToRedeem)
    })

    await withTransaction(client => restoreRedeemedPointsForOrder(client, 'loy-cancel-2'))
    await withTransaction(client => restoreRedeemedPointsForOrder(client, 'loy-cancel-2'))

    expect(await getLoyaltyBalance(CUSTOMER_ID)).toBe(500)
  })

  it('does nothing for an order that never redeemed any points', async () => {
    await insertOrder('loy-cancel-3', CUSTOMER_ID, 200, 0)
    await withTransaction(client => restoreRedeemedPointsForOrder(client, 'loy-cancel-3'))
    expect(await getLoyaltyBalance(CUSTOMER_ID)).toBe(0)
  })
})

describe('reverseEarnedPointsForOrder', () => {
  it('reverses previously-earned points via an earned_reversal entry', async () => {
    await insertOrder('loy-earn-rev-1', CUSTOMER_ID, 300, 0)
    await withTransaction(client => grantPointsForDeliveredOrder(client, 'loy-earn-rev-1'))
    expect(await getLoyaltyBalance(CUSTOMER_ID)).toBe(30)

    await withTransaction(client => reverseEarnedPointsForOrder(client, 'loy-earn-rev-1'))
    expect(await getLoyaltyBalance(CUSTOMER_ID)).toBe(0)
    const { entries } = await listLoyaltyLedger(CUSTOMER_ID)
    expect(entries[0]).toMatchObject({ pointsChange: -30, sourceType: 'earned_reversal', sourceOrderId: 'loy-earn-rev-1' })
  })

  it('is idempotent — reversing the same order twice does not double-debit', async () => {
    await insertOrder('loy-earn-rev-2', CUSTOMER_ID, 300, 0)
    await withTransaction(client => grantPointsForDeliveredOrder(client, 'loy-earn-rev-2'))

    await withTransaction(client => reverseEarnedPointsForOrder(client, 'loy-earn-rev-2'))
    await withTransaction(client => reverseEarnedPointsForOrder(client, 'loy-earn-rev-2'))

    expect(await getLoyaltyBalance(CUSTOMER_ID)).toBe(0)
  })
})

describe('FIFO consumption, expiry, and upcoming-expiry reporting', () => {
  async function setLotExpiry(orderId: string, expiresAt: Date | null) {
    await pool.query(
      `UPDATE loyalty_point_lots SET expires_at = $1
       WHERE source_ledger_id = (SELECT id FROM loyalty_ledger WHERE source_order_id = $2 ORDER BY id DESC LIMIT 1)`,
      [expiresAt, orderId]
    )
  }

  it('consumes the oldest lot first, matching the spec FIFO example (Jan +300, Feb +400, spend 350)', async () => {
    await insertOrder('loy-fifo-jan', CUSTOMER_ID, 3000, 0) // eligible 3000 * 0.1 = 300 points
    await withTransaction(client => grantPointsForDeliveredOrder(client, 'loy-fifo-jan'))
    await insertOrder('loy-fifo-feb', CUSTOMER_ID, 4000, 0) // eligible 4000 * 0.1 = 400 points
    await withTransaction(client => grantPointsForDeliveredOrder(client, 'loy-fifo-feb'))
    expect(await getLoyaltyBalance(CUSTOMER_ID)).toBe(700)

    await insertOrder('loy-fifo-spend', CUSTOMER_ID, 350, 0)
    await withTransaction(async client => {
      const validation = await lockAndValidateLoyaltyRedemption(client, CUSTOMER_ID, 350, 1000000)
      if (validation.ok) await commitLoyaltyRedemption(client, CUSTOMER_ID, 'loy-fifo-spend', validation.pointsToRedeem)
    })
    expect(await getLoyaltyBalance(CUSTOMER_ID)).toBe(350)

    const { rows } = await pool.query<{ remaining: number, sourceOrderId: string }>(
      `SELECT lot.remaining_points as remaining, l.source_order_id as "sourceOrderId"
       FROM loyalty_point_lots lot JOIN loyalty_ledger l ON l.id = lot.source_ledger_id
       WHERE lot.user_id = $1 ORDER BY lot.earned_at`,
      [CUSTOMER_ID]
    )
    // يناير (300) استُهلكت بالكامل الأول، فبراير (400) اتاستهلك منها 50 بس -> باقي 350.
    expect(rows.find(r => r.sourceOrderId === 'loy-fifo-jan')?.remaining).toBe(0)
    expect(rows.find(r => r.sourceOrderId === 'loy-fifo-feb')?.remaining).toBe(350)
  })

  it('runLoyaltyExpiryBatch does nothing when expiry is disabled in settings', async () => {
    await pool.query('UPDATE store_settings SET loyalty_expiry_enabled = 0 WHERE id = 1')
    await adjustLoyaltyPointsManually(CUSTOMER_ID, 100, 'تعبئة', ADMIN_ID)
    await pool.query(`UPDATE loyalty_point_lots SET expires_at = now() - interval '1 day' WHERE user_id = $1`, [CUSTOMER_ID])
    const expiredCount = await runLoyaltyExpiryBatch(200)
    expect(expiredCount).toBe(0)
    expect(await getLoyaltyBalance(CUSTOMER_ID)).toBe(100)
  })

  it('expires only currently-remaining points — already-spent points from an older lot never expire', async () => {
    await pool.query('UPDATE store_settings SET loyalty_expiry_enabled = 1 WHERE id = 1')
    await insertOrder('loy-exp-jan', CUSTOMER_ID, 3000, 0)
    await withTransaction(client => grantPointsForDeliveredOrder(client, 'loy-exp-jan')) // +300
    await insertOrder('loy-exp-feb', CUSTOMER_ID, 4000, 0)
    await withTransaction(client => grantPointsForDeliveredOrder(client, 'loy-exp-feb')) // +400

    // العميل بيصرف 350 -> يستهلك يناير (300) بالكامل + 50 من فبراير -> باقي فبراير 350.
    await insertOrder('loy-exp-spend', CUSTOMER_ID, 350, 0)
    await withTransaction(async client => {
      const validation = await lockAndValidateLoyaltyRedemption(client, CUSTOMER_ID, 350, 1000000)
      if (validation.ok) await commitLoyaltyRedemption(client, CUSTOMER_ID, 'loy-exp-spend', validation.pointsToRedeem)
    })

    // دفعتا يناير وفبراير الاتنين وصلوا تاريخ انتهاء (ماضي) — لكن يناير remaining_points = 0
    // بالفعل (اتصرفت كلها)، فمفروض ميترفعش منها حاجة، وفبراير الباقي (350) هو بس اللي ينتهي.
    await setLotExpiry('loy-exp-jan', new Date(Date.now() - 86400000))
    await setLotExpiry('loy-exp-feb', new Date(Date.now() - 86400000))

    const expiredCount = await runLoyaltyExpiryBatch(200)
    expect(expiredCount).toBe(1) // دفعة واحدة بس فيها رصيد فعلي وقت الانتهاء (فبراير)
    expect(await getLoyaltyBalance(CUSTOMER_ID)).toBe(0) // 350 المتبقية اتصفرت بالكامل
    const { entries } = await listLoyaltyLedger(CUSTOMER_ID)
    expect(entries[0]).toMatchObject({ pointsChange: -350, sourceType: 'expired' })
  })

  it('a repeated run of the expiry processor right after does not expire the same points twice', async () => {
    await pool.query('UPDATE store_settings SET loyalty_expiry_enabled = 1 WHERE id = 1')
    await adjustLoyaltyPointsManually(CUSTOMER_ID, 100, 'تعبئة', ADMIN_ID)
    await pool.query(`UPDATE loyalty_point_lots SET expires_at = now() - interval '1 day' WHERE user_id = $1`, [CUSTOMER_ID])

    const first = await runLoyaltyExpiryBatch(200)
    const second = await runLoyaltyExpiryBatch(200)
    expect(first).toBe(1)
    expect(second).toBe(0)
    expect(await getLoyaltyBalance(CUSTOMER_ID)).toBe(0)
  })

  it('listUpcomingLoyaltyExpiry returns nothing when expiry is disabled', async () => {
    await pool.query('UPDATE store_settings SET loyalty_expiry_enabled = 0 WHERE id = 1')
    await adjustLoyaltyPointsManually(CUSTOMER_ID, 100, 'تعبئة', ADMIN_ID)
    expect(await listUpcomingLoyaltyExpiry(CUSTOMER_ID)).toEqual([])
  })

  it('listUpcomingLoyaltyExpiry reports lots expiring within the configured warning window', async () => {
    await pool.query(`UPDATE store_settings SET loyalty_expiry_enabled = 1, loyalty_expiry_warning_days = 30 WHERE id = 1`)
    await adjustLoyaltyPointsManually(CUSTOMER_ID, 150, 'تعبئة قريبة الانتهاء', ADMIN_ID)
    const soon = new Date(Date.now() + 10 * 86400000)
    await pool.query('UPDATE loyalty_point_lots SET expires_at = $1 WHERE user_id = $2', [soon.toISOString(), CUSTOMER_ID])

    const upcoming = await listUpcomingLoyaltyExpiry(CUSTOMER_ID)
    expect(upcoming).toHaveLength(1)
    expect(upcoming[0].points).toBe(150)
  })

  it('listUpcomingLoyaltyExpiry does not report a lot expiring outside the warning window', async () => {
    await pool.query(`UPDATE store_settings SET loyalty_expiry_enabled = 1, loyalty_expiry_warning_days = 30 WHERE id = 1`)
    await adjustLoyaltyPointsManually(CUSTOMER_ID, 150, 'تعبئة بعيدة الانتهاء', ADMIN_ID)
    const farAway = new Date(Date.now() + 365 * 86400000)
    await pool.query('UPDATE loyalty_point_lots SET expires_at = $1 WHERE user_id = $2', [farAway.toISOString(), CUSTOMER_ID])

    expect(await listUpcomingLoyaltyExpiry(CUSTOMER_ID)).toEqual([])
  })
})

describe('referral qualification thresholds and referred-customer bonus', () => {
  it('an order below the minimum qualifying value keeps the referral pending with no reward', async () => {
    await pool.query('UPDATE store_settings SET referral_min_qualifying_order = 500 WHERE id = 1')
    const code = await getOrCreateReferralCode(REFERRER_ID)
    await recordReferralSignup(REFERRER_ID, CUSTOMER_ID, code)

    await insertOrder('loy-ref-min-1', CUSTOMER_ID, 300, 0)
    await withTransaction(client => grantPointsForDeliveredOrder(client, 'loy-ref-min-1'))

    expect(await getLoyaltyBalance(REFERRER_ID)).toBe(0)
    expect(await getReferralStats(REFERRER_ID)).toEqual({ pending: 1, qualified: 0, rewarded: 0 })
  })

  it('a later larger delivered order rewards a referral that was previously below the minimum', async () => {
    await pool.query('UPDATE store_settings SET referral_min_qualifying_order = 500 WHERE id = 1')
    const code = await getOrCreateReferralCode(REFERRER_ID)
    await recordReferralSignup(REFERRER_ID, CUSTOMER_ID, code)

    await insertOrder('loy-ref-min-2a', CUSTOMER_ID, 300, 0)
    await withTransaction(client => grantPointsForDeliveredOrder(client, 'loy-ref-min-2a'))
    await insertOrder('loy-ref-min-2b', CUSTOMER_ID, 600, 0)
    await withTransaction(client => grantPointsForDeliveredOrder(client, 'loy-ref-min-2b'))

    expect(await getLoyaltyBalance(REFERRER_ID)).toBe(50)
    expect(await getReferralStats(REFERRER_ID)).toEqual({ pending: 0, qualified: 0, rewarded: 1 })
  })

  it('rewards both the referrer and the new referred customer exactly once when a referred bonus is configured', async () => {
    await pool.query('UPDATE store_settings SET referral_referred_bonus_points = 100 WHERE id = 1')
    const code = await getOrCreateReferralCode(REFERRER_ID)
    await recordReferralSignup(REFERRER_ID, CUSTOMER_ID, code)

    await insertOrder('loy-ref-both-1', CUSTOMER_ID, 300, 0)
    await withTransaction(client => grantPointsForDeliveredOrder(client, 'loy-ref-both-1'))
    // ثاني طلب مُسلَّم للمُحال نفسه — المكافأة لازم تتمنح مرة واحدة بس لكل طرف.
    await insertOrder('loy-ref-both-2', CUSTOMER_ID, 300, 0)
    await withTransaction(client => grantPointsForDeliveredOrder(client, 'loy-ref-both-2'))

    expect(await getLoyaltyBalance(REFERRER_ID)).toBe(50)
    // العميل المُحال بياخد مكافأته (100) + نقاط اكتساب طلبيه العاديين (30+30).
    expect(await getLoyaltyBalance(CUSTOMER_ID)).toBe(100 + 30 + 30)
  })

  it('when the referral program is disabled, a qualifying order flips status to qualified but grants no reward points', async () => {
    await pool.query('UPDATE store_settings SET referral_enabled = 0 WHERE id = 1')
    const code = await getOrCreateReferralCode(REFERRER_ID)
    await recordReferralSignup(REFERRER_ID, CUSTOMER_ID, code)

    await insertOrder('loy-ref-disabled-1', CUSTOMER_ID, 300, 0)
    await withTransaction(client => grantPointsForDeliveredOrder(client, 'loy-ref-disabled-1'))

    expect(await getLoyaltyBalance(REFERRER_ID)).toBe(0)
    expect(await getReferralStats(REFERRER_ID)).toEqual({ pending: 0, qualified: 1, rewarded: 0 })
  })
})
