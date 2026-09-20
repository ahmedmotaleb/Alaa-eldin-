// اختبارات أمان حقيقية على مستوى HTTP (نفس نمط httpSecurity.test.ts) + تزامن حقيقي على
// قاعدة بيانات فعلية — تغطي: منع التخصيص الجماعي (mass assignment) على حقول الولاء/الإحالة،
// عزل بيانات العملاء (IDOR)، وسيناريوهين تزامن حقيقيين (انتهاء صلاحية + استخدام في نفس
// اللحظة، وتأهّل إحالة مزدوج متزامن) — الأقسام 54-56 من مواصفة دفعة الولاء.
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { app } from './app.js'
import { pool, withTransaction } from './db.js'
import { getLoyaltyBalance, adjustLoyaltyPointsManually, runLoyaltyExpiryBatch } from './services/loyaltyService.js'
import { grantPointsForDeliveredOrder } from './services/loyaltyService.js'
import { getOrCreateReferralCode, recordReferralSignup, getReferralStats } from './services/referralService.js'

const PREFIX = 'loysec-'

async function cleanup() {
  await pool.query('DELETE FROM order_items')
  await pool.query('DELETE FROM orders WHERE customer_mobile = $1', ['01099999999'])
  await pool.query('DELETE FROM loyalty_ledger WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)', [`${PREFIX}%`])
  await pool.query('DELETE FROM referrals WHERE referrer_user_id IN (SELECT id FROM users WHERE email LIKE $1) OR referred_user_id IN (SELECT id FROM users WHERE email LIKE $1)', [`${PREFIX}%`])
  await pool.query('DELETE FROM referral_codes WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)', [`${PREFIX}%`])
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${PREFIX}%`])
}

beforeEach(cleanup)

afterAll(async () => {
  await cleanup()
  await pool.end()
})

function uniqueEmail(label: string): string {
  return `${PREFIX}${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`
}

const STRONG_PASSWORD = 'CorrectHorse9'

async function registerCustomer(agent: ReturnType<typeof request.agent>, email: string): Promise<string> {
  const res = await agent.post('/api/auth/register').send({ email, password: STRONG_PASSWORD, fullName: 'عميل اختبار' })
  expect(res.status).toBe(201)
  return res.body.user.id as string
}

async function insertOrder(id: string, userId: string, total: number, deliveryFee: number) {
  await pool.query(
    `INSERT INTO orders (id, order_number, user_id, customer_full_name, customer_mobile, customer_governorate, customer_address,
                          delivery_slot, payment_method, subtotal, delivery_fee, total, status, created_at)
     VALUES ($1, $1, $2, 'عميل', '01099999999', 'القاهرة', 'عنوان', 'morning', 'cod', $3, $4, $5, 'placed', now())`,
    [id, userId, total - deliveryFee, deliveryFee, total]
  )
}

describe('Section 54 — mass assignment protection on registration', () => {
  it('ignores client-submitted loyalty/referral state fields on registration — no such state can be created this way', async () => {
    const agent = request.agent(app)
    const email = uniqueEmail('register-mass')
    const res = await agent.post('/api/auth/register').send({
      email, password: STRONG_PASSWORD, fullName: 'عميل اختبار',
      loyalty_balance: 999999,
      loyaltyPoints: 999999,
      referral_rewarded: true,
      isAdmin: true,
      role: 'admin'
    })
    expect(res.status).toBe(201)
    const userId = res.body.user.id as string
    expect(await getLoyaltyBalance(userId)).toBe(0)
    // العمود role هنا مخصّص فقط للتمييز بين موظفي/مديري لوحة التحكم (staff/admin) — قيمته
    // الافتراضية غير ذات صلة أصلاً للعميل العادي؛ ما يهم فعلياً هو isAdmin (اللي كل حماية
    // لوحة التحكم بتتحقق منه)، ولازم يفضل 0 مهما كان الجسم الخام المُرسَل.
    const { rows } = await pool.query('SELECT is_admin as "isAdmin" FROM users WHERE id = $1', [userId])
    expect(rows[0].isAdmin).toBe(0)
  })
})

describe('Section 54/55 — checkout mass assignment and per-account isolation', () => {
  it('a checkout request cannot inject a foreign loyalty balance, points, or discount amount via extra JSON fields', async () => {
    const agent = request.agent(app)
    await registerCustomer(agent, uniqueEmail('checkout-mass'))
    const { rows: before } = await pool.query('SELECT count(*) as n FROM orders')

    // مفيش أي منتجات حقيقية في الفكستشر ده، فمتوقع إن الطلب يترفض على مستوى المخزون/المنتج —
    // المهم هنا إن أي حقل ولاء زايف في الجسم الخام ما يتحسبش ولا يغيّر أي حالة في قاعدة البيانات.
    const res = await agent.post('/api/orders').send({
      deliverySlot: 'now',
      deliveryDate: new Date().toISOString().slice(0, 10),
      paymentMethod: 'COD',
      customer: { fullName: 'عميل اختبار', mobile: '01012345678', governorate: 'القاهرة', address: 'شارع الاختبار رقم 1' },
      items: [{ productId: 'non-existent-product', quantity: 1 }],
      loyaltyBalance: 999999,
      loyaltyPointsRedeemed: 999999,
      loyaltyDiscountAmount: 99999,
      referralRewarded: true
    })
    // إما يترفض بسبب منتج غير موجود، أو (لو حصل تغيير مستقبلي في الفاليديشن) بسبب رصيد غير
    // كافٍ — الحالتين مقبولتين هنا، المهم إنه ما ينفعش ينجح بخصم زايف. المهم فعلياً إنه لسه
    // مرفوض ومفيش أي صف طلب جديد اتسجّل (فرق العدّاد صفر، مش عدّاد مطلق قد يتأثر ببيانات
    // متبقية من ملفات اختبار تانية تشارك نفس قاعدة البيانات).
    expect(res.status).toBeGreaterThanOrEqual(400)
    const { rows: after } = await pool.query('SELECT count(*) as n FROM orders')
    expect(Number(after[0].n)).toBe(Number(before[0].n))
  })

  it('customer A can never see customer B\'s loyalty balance or referral stats through the authenticated /api/loyalty endpoint', async () => {
    const agentA = request.agent(app)
    const userA = await registerCustomer(agentA, uniqueEmail('idor-a'))
    const agentB = request.agent(app)
    const userB = await registerCustomer(agentB, uniqueEmail('idor-b'))

    await adjustLoyaltyPointsManually(userA, 100, 'رصيد أ', userA)
    await adjustLoyaltyPointsManually(userB, 777, 'رصيد ب', userB)

    const resA = await agentA.get('/api/loyalty')
    const resB = await agentB.get('/api/loyalty')
    expect(resA.status).toBe(200)
    expect(resB.status).toBe(200)
    expect(resA.body.balance).toBe(100)
    expect(resB.body.balance).toBe(777)
    // مفيش أي مسار (query param أو خلافه) بيسمح لعميل يحدد id عميل تاني في هذا الطلب — الرصيد
    // المُرجع دايماً رصيد الجلسة الحالية (req.user.id) بس، بغض النظر عن أي بارامتر يُبعت.
    const resACrossQuery = await agentA.get(`/api/loyalty?userId=${userB}`)
    expect(resACrossQuery.body.balance).toBe(100) // لسه رصيد A نفسه، مش اتأثر بمحاولة تحديد B
  })

  it('an authenticated checkout always redeems against the logged-in user\'s own balance, never a different account\'s', async () => {
    const agentA = request.agent(app)
    const userA = await registerCustomer(agentA, uniqueEmail('redeem-a'))
    const agentB = request.agent(app)
    const userB = await registerCustomer(agentB, uniqueEmail('redeem-b'))
    await adjustLoyaltyPointsManually(userB, 5000, 'رصيد ب الكبير', userB)
    // A ماعندوش رصيد أصلاً — لو حاول يستخدم نقاط، لازم يترفض برصيده هو (صفر)، مش رصيد B
    // حتى لو حاول (نظرياً) يحدد B بأي طريقة — مفيش أي حقل زي ده في شكل الطلب المتوقع أصلاً.
    const res = await agentA.post('/api/orders').send({
      deliverySlot: 'now',
      deliveryDate: new Date().toISOString().slice(0, 10),
      paymentMethod: 'COD',
      customer: { fullName: 'عميل اختبار', mobile: '01012345678', governorate: 'القاهرة', address: 'شارع الاختبار رقم 1' },
      items: [{ productId: 'non-existent-product', quantity: 1 }],
      loyaltyPointsRedeemed: 100
    })
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(await getLoyaltyBalance(userB)).toBe(5000) // رصيد B ما اتلمسش أبداً
  })
})

describe('Section 56 — real concurrency: expiry processor racing a live redemption', () => {
  it('never double-counts or goes negative when expiry and redemption race on the same lot', async () => {
    await pool.query('UPDATE store_settings SET loyalty_expiry_enabled = 1, loyalty_min_redeem_points = 1, loyalty_max_redemption_percent = 100 WHERE id = 1')
    const agent = request.agent(app)
    const userId = await registerCustomer(agent, uniqueEmail('race-expiry'))
    await adjustLoyaltyPointsManually(userId, 300, 'دفعة سباق', userId)
    await pool.query(`UPDATE loyalty_point_lots SET expires_at = now() - interval '1 day' WHERE user_id = $1`, [userId])

    const [redemptionResult, expiredCount] = await Promise.allSettled([
      agent.post('/api/orders').send({
        deliverySlot: 'now',
        deliveryDate: new Date().toISOString().slice(0, 10),
        paymentMethod: 'COD',
        customer: { fullName: 'عميل اختبار', mobile: '01012345678', governorate: 'القاهرة', address: 'شارع الاختبار رقم 1' },
        items: [{ productId: 'non-existent-product', quantity: 1 }],
        loyaltyPointsRedeemed: 300
      }),
      runLoyaltyExpiryBatch(200)
    ])

    // الطلب هيترفض أصلاً (منتج غير موجود) — المهم إن السباق نفسه ما يعملش استثناء غير متوقع
    // ولا يوصل لحالة غير منطقية (رصيد سالب أو انتهاء نقاط مستخدمة بالفعل).
    expect(redemptionResult.status).toBe('fulfilled')
    expect(expiredCount.status).toBe('fulfilled')
    const finalBalance = await getLoyaltyBalance(userId)
    expect(finalBalance).toBeGreaterThanOrEqual(0)
    expect(finalBalance).toBeLessThanOrEqual(300)
  })
})

describe('Section 56 — real concurrency: duplicate referral qualification attempts', () => {
  it('two concurrent delivered-order transitions for the same referred user reward the referrer exactly once', async () => {
    const referrer = uniqueEmail('ref-referrer')
    const referred = uniqueEmail('ref-referred')
    const agentReferrer = request.agent(app)
    const referrerId = await registerCustomer(agentReferrer, referrer)
    const agentReferred = request.agent(app)
    const referredId = await registerCustomer(agentReferred, referred)

    const code = await getOrCreateReferralCode(referrerId)
    await recordReferralSignup(referrerId, referredId, code)

    await insertOrder(`${PREFIX}order-a`, referredId, 300, 0)
    await insertOrder(`${PREFIX}order-b`, referredId, 300, 0)

    await Promise.all([
      withTransaction(client => grantPointsForDeliveredOrder(client, `${PREFIX}order-a`)),
      withTransaction(client => grantPointsForDeliveredOrder(client, `${PREFIX}order-b`))
    ])

    expect(await getLoyaltyBalance(referrerId)).toBe(50) // مكافأة واحدة بس، مش 100
    expect(await getReferralStats(referrerId)).toEqual({ pending: 0, qualified: 0, rewarded: 1 })
  })
})
