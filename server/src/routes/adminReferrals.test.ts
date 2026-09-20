// اختبارات HTTP حقيقية (supertest على app.ts الفعلي) لمسارات إدارة الإحالات — بتغطي RBAC
// (منع/سماح حسب الدور)، الترقيم، الفلترة، وتفاصيل الإحالة المفردة. نفس نمط httpSecurity.test.ts.
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { app } from '../app.js'
import { pool } from '../db.js'

const PREFIX = 'adminref-'

async function cleanup() {
  await pool.query('DELETE FROM referrals WHERE referral_code LIKE $1', [`${PREFIX}%`])
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
  const res = await agent.post('/api/auth/register').send({ email, password: STRONG_PASSWORD, fullName: 'مستخدم اختبار' })
  expect(res.status).toBe(201)
  return res.body.user.id as string
}

async function promoteToAdmin(userId: string, roleId: string | null) {
  await pool.query('UPDATE users SET is_admin = 1, role = $2, role_id = $3 WHERE id = $1', [userId, 'staff', roleId])
}

async function insertPlainUser(idSuffix: string, fullName: string): Promise<string> {
  const id = `${PREFIX}user-${idSuffix}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  await pool.query(
    `INSERT INTO users (id, email, password_hash, full_name, created_at) VALUES ($1, $1 || '@test.local', 'x', $2, now())`,
    [id, fullName]
  )
  return id
}

async function insertReferral(referrerUserId: string, referredUserId: string, overrides: Partial<{
  status: string, code: string, qualifyingOrderValue: number | null, referrerRewardPoints: number | null, referredRewardPoints: number | null
}> = {}) {
  const { status = 'pending', code = `${PREFIX}${Math.random().toString(36).slice(2, 8)}`, qualifyingOrderValue = null, referrerRewardPoints = null, referredRewardPoints = null } = overrides
  await pool.query(
    `INSERT INTO referrals (referrer_user_id, referred_user_id, referral_code, status, qualifying_order_value, referrer_reward_points, referred_reward_points, rewarded_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $4 = 'rewarded' THEN now() ELSE NULL END)`,
    [referrerUserId, referredUserId, code, status, qualifyingOrderValue, referrerRewardPoints, referredRewardPoints]
  )
}

describe('GET /api/admin/referrals — RBAC', () => {
  it('rejects an unauthenticated request', async () => {
    const res = await request(app).get('/api/admin/referrals')
    expect(res.status).toBe(401)
  })

  it('rejects a non-admin authenticated customer', async () => {
    const agent = request.agent(app)
    await registerCustomer(agent, uniqueEmail('customer'))
    const res = await agent.get('/api/admin/referrals')
    expect(res.status).toBe(403)
  })

  it('rejects an admin-panel user whose granular role lacks referrals.view (e.g. a picker)', async () => {
    const agent = request.agent(app)
    const userId = await registerCustomer(agent, uniqueEmail('picker'))
    await promoteToAdmin(userId, 'role-picker')
    const res = await agent.get('/api/admin/referrals')
    expect(res.status).toBe(403)
  })

  it('allows a legacy full-admin account (isAdmin, no granular role) through', async () => {
    const agent = request.agent(app)
    const userId = await registerCustomer(agent, uniqueEmail('legacy-admin'))
    await promoteToAdmin(userId, null)
    const res = await agent.get('/api/admin/referrals')
    expect(res.status).toBe(200)
  })

  it('allows a role-manager account through (granted referrals.view via migration)', async () => {
    const agent = request.agent(app)
    const userId = await registerCustomer(agent, uniqueEmail('manager'))
    await promoteToAdmin(userId, 'role-manager')
    const res = await agent.get('/api/admin/referrals')
    expect(res.status).toBe(200)
  })
})

describe('GET /api/admin/referrals — pagination and filtering', () => {
  async function adminAgent() {
    const agent = request.agent(app)
    const userId = await registerCustomer(agent, uniqueEmail('manager-list'))
    await promoteToAdmin(userId, 'role-manager')
    return agent
  }

  it('paginates results and reports accurate totals instead of loading everything at once', async () => {
    // اسم فريد للمُحيل بيُستخدم كفلتر بحث — عشان العدّ يقتصر على بيانات الاختبار ده بس، مش
    // كل صف referrals موجود في قاعدة البيانات المشتركة (ملفات اختبار تانية بتسيب صفوف حقيقية).
    const uniqueName = `محيل-اختبار-ترقيم-${Date.now()}`
    const referrer = await insertPlainUser('referrer-a', uniqueName)
    for (let i = 0; i < 5; i++) {
      const referred = await insertPlainUser(`referred-${i}`, `عميل مُحال ${i}`)
      await insertReferral(referrer, referred)
    }

    const agent = await adminAgent()
    const res = await agent.get('/api/admin/referrals').query({ page: 1, limit: 2, search: uniqueName })
    expect(res.status).toBe(200)
    expect(res.body.referrals).toHaveLength(2)
    expect(res.body.total).toBe(5)
    expect(res.body.totalPages).toBe(3)
    expect(res.body.page).toBe(1)
  })

  it('filters by status', async () => {
    const referrer = await insertPlainUser('referrer-b', 'محيل ب')
    const referredPending = await insertPlainUser('referred-pending', 'معلّق')
    const referredRewarded = await insertPlainUser('referred-rewarded', 'مكافأ')
    await insertReferral(referrer, referredPending, { status: 'pending' })
    await insertReferral(referrer, referredRewarded, { status: 'rewarded', qualifyingOrderValue: 300, referrerRewardPoints: 50 })

    const agent = await adminAgent()
    const res = await agent.get('/api/admin/referrals?status=rewarded')
    expect(res.status).toBe(200)
    expect(res.body.referrals).toHaveLength(1)
    expect(res.body.referrals[0].status).toBe('rewarded')
    expect(res.body.referrals[0].referrerRewardPoints).toBe(50)
  })

  it('searches by referral code', async () => {
    const referrer = await insertPlainUser('referrer-c', 'محيل ج')
    const referred = await insertPlainUser('referred-c', 'مُحال ج')
    await insertReferral(referrer, referred, { code: `${PREFIX}FINDME99` })

    const agent = await adminAgent()
    const res = await agent.get('/api/admin/referrals?search=FINDME99')
    expect(res.status).toBe(200)
    expect(res.body.referrals).toHaveLength(1)
    expect(res.body.referrals[0].referralCode).toBe(`${PREFIX}FINDME99`)
  })

  it('rejects an invalid status value silently by ignoring the filter (only whitelisted statuses accepted)', async () => {
    const referrer = await insertPlainUser('referrer-d', 'محيل د')
    const referred = await insertPlainUser('referred-d', 'مُحال د')
    await insertReferral(referrer, referred, { status: 'pending' })

    const agent = await adminAgent()
    const res = await agent.get('/api/admin/referrals?status=not_a_real_status')
    expect(res.status).toBe(200)
    expect(res.body.referrals.length).toBeGreaterThanOrEqual(1) // الفلتر اتجاهل، مش رفض الطلب كله
  })
})

describe('GET /api/admin/referrals/:id — detail view', () => {
  it('returns 404 for an unknown referral id', async () => {
    const agent = request.agent(app)
    const userId = await registerCustomer(agent, uniqueEmail('manager-detail'))
    await promoteToAdmin(userId, 'role-manager')
    const res = await agent.get('/api/admin/referrals/999999999')
    expect(res.status).toBe(404)
  })

  it('returns 400 for a non-numeric id (no SQL injection surface via the id param)', async () => {
    const agent = request.agent(app)
    const userId = await registerCustomer(agent, uniqueEmail('manager-detail-2'))
    await promoteToAdmin(userId, 'role-manager')
    const res = await agent.get('/api/admin/referrals/not-a-number')
    expect(res.status).toBe(400)
  })

  it('returns full referral detail including referrer/referred names for a known id', async () => {
    const referrer = await insertPlainUser('referrer-e', 'محمد المحيل')
    const referred = await insertPlainUser('referred-e', 'سارة المُحالة')
    await insertReferral(referrer, referred, { status: 'rewarded', qualifyingOrderValue: 400, referrerRewardPoints: 50, referredRewardPoints: 20 })

    const { rows } = await pool.query<{ id: number }>('SELECT id FROM referrals WHERE referrer_user_id = $1', [referrer])
    const referralId = rows[0].id

    const agent = request.agent(app)
    const userId = await registerCustomer(agent, uniqueEmail('manager-detail-3'))
    await promoteToAdmin(userId, 'role-manager')
    const res = await agent.get(`/api/admin/referrals/${referralId}`)
    expect(res.status).toBe(200)
    expect(res.body.referral).toMatchObject({
      referrerName: 'محمد المحيل', referredName: 'سارة المُحالة',
      status: 'rewarded', referrerRewardPoints: 50, referredRewardPoints: 20
    })
  })
})

describe('GET /api/admin/referrals/analytics', () => {
  it('returns the analytics shape and never labels revenue as profit', async () => {
    const agent = request.agent(app)
    const userId = await registerCustomer(agent, uniqueEmail('manager-analytics'))
    await promoteToAdmin(userId, 'role-manager')
    const res = await agent.get('/api/admin/referrals/analytics')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      totalReferrals: expect.any(Number),
      pendingReferrals: expect.any(Number),
      qualifiedReferrals: expect.any(Number),
      rewardedReferrals: expect.any(Number),
      customersAcquired: expect.any(Number),
      totalPointsAwarded: expect.any(Number),
      revenueFromQualifyingOrders: expect.any(Number),
      conversionRate: expect.any(Number)
    })
    expect(res.body).not.toHaveProperty('profit')
  })
})

describe('POST /api/admin/customers/:id/loyalty-adjustments — RBAC', () => {
  it('rejects an admin-panel user whose granular role lacks loyalty.adjust', async () => {
    const target = await insertPlainUser('target-a', 'عميل مستهدف')
    const agent = request.agent(app)
    const userId = await registerCustomer(agent, uniqueEmail('picker-adjust'))
    await promoteToAdmin(userId, 'role-picker')
    const res = await agent.post(`/api/admin/customers/${target}/loyalty-adjustments`).send({ points: 100, note: 'test' })
    expect(res.status).toBe(403)
  })

  it('allows a role-manager account to adjust points and rejects a resulting negative balance', async () => {
    const target = await insertPlainUser('target-b', 'عميل مستهدف ب')
    const agent = request.agent(app)
    const userId = await registerCustomer(agent, uniqueEmail('manager-adjust'))
    await promoteToAdmin(userId, 'role-manager')

    const ok = await agent.post(`/api/admin/customers/${target}/loyalty-adjustments`).send({ points: 100, note: 'مكافأة تعويضية' })
    expect(ok.status).toBe(201)
    expect(ok.body.balance).toBe(100)

    const overdraft = await agent.post(`/api/admin/customers/${target}/loyalty-adjustments`).send({ points: -500, note: 'خصم كبير' })
    expect(overdraft.status).toBe(400)
    expect(overdraft.body.error).toBe('resulting_balance_negative')
  })
})
