import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { pool, withTransaction } from '../db.js'
import { getLoyaltyBalance, listLoyaltyLedger, adjustLoyaltyPointsManually, grantPointsForDeliveredOrder } from './loyaltyService.js'
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
  await pool.query('UPDATE store_settings SET loyalty_points_per_egp = 0.1, referral_bonus_points = 50 WHERE id = 1')
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
    expect(stats).toEqual({ pending: 0, rewarded: 1 })
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
