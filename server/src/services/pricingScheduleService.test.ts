// اختبارات تكامل حقيقية لخدمة جدولة الأسعار — بتتصل بقاعدة بيانات اختبار فعلية (نفس مبدأ
// orderService.test.ts): لازم تثبت فعلياً إن فحص التعارض (لو السعر اتغيّر يدوياً بعد إنشاء
// الجدولة) وحماية التداخل (FOR UPDATE SKIP LOCKED) بيشتغلوا صح تحت قاعدة بيانات حقيقية.
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { pool } from '../db.js'
import { createPriceSchedule, listPriceSchedules, cancelPriceSchedule, runApplyScheduledBatch } from './pricingScheduleService.js'

const CATEGORY_ID = 'test-pxsch-cat'
const PRODUCT_ID = 'test-pxsch-prod'
const VARIANT_ID = 'test-pxsch-variant'
const ADMIN_ID = 'test-pxsch-admin'

async function resetFixtures() {
  await pool.query('DELETE FROM product_price_schedules')
  await pool.query('DELETE FROM product_price_history')
  await pool.query('DELETE FROM product_variants')
  await pool.query('DELETE FROM products')
  await pool.query('DELETE FROM categories WHERE id = $1', [CATEGORY_ID])
  await pool.query('DELETE FROM users WHERE id = $1', [ADMIN_ID])

  await pool.query(`INSERT INTO users (id, email, password_hash, full_name, created_at) VALUES ($1, $1 || '@test.local', 'x', 'أدمن اختبار', now())`, [ADMIN_ID])
  await pool.query(`INSERT INTO categories (id, name, emoji, tint, sort_order) VALUES ($1, 'فئة اختبار', '🧪', '#fff', 1)`, [CATEGORY_ID])
  await pool.query(
    `INSERT INTO products (id, slug, category_id, name, description, price, cost, unit, emoji, available, stock, created_at)
     VALUES ($1, $1, $2, 'منتج اختبار', 'وصف', 50, 20, 'قطعة', '🧪', 1, 100, now())`,
    [PRODUCT_ID, CATEGORY_ID]
  )
  await pool.query(
    `INSERT INTO product_variants (id, product_id, name, price, cost, stock, available, sort_order, created_at)
     VALUES ($1, $2, 'متغيّر اختبار', 60, 25, 50, 1, 0, now())`,
    [VARIANT_ID, PRODUCT_ID]
  )
}

function futureDate(minutesFromNow = 10): string {
  return new Date(Date.now() + minutesFromNow * 60 * 1000).toISOString()
}

// createPriceSchedule بيرفض starts_at في الماضي (منطقي للإنشاء الفعلي من الأدمن) — لكن
// اختبار التنفيذ نفسه محتاج جدولة "مستحقة" فعلاً (starts_at فات معاده)، فبنحاكي هنا حالة
// جدولة اتعملت فعلاً في الماضي (starts_at كان مستقبلي وقتها) ولسه pending، بإدخال مباشر.
async function insertDueSchedule(overrides: { productId?: string | null, variantId?: string | null, newPrice: number, newOldPrice?: number | null, expectedCurrentPrice: number }): Promise<string> {
  const id = `test-due-${Math.random().toString(36).slice(2)}`
  await pool.query(
    `INSERT INTO product_price_schedules (id, product_id, variant_id, new_price, new_old_price, expected_current_price, starts_at, created_by)
     VALUES ($1,$2,$3,$4,$5,$6, now() - interval '1 minute', $7)`,
    [id, overrides.productId ?? null, overrides.variantId ?? null, overrides.newPrice, overrides.newOldPrice ?? null, overrides.expectedCurrentPrice, ADMIN_ID]
  )
  return id
}

beforeEach(resetFixtures, 20000)
afterAll(async () => { await pool.end() })

describe('createPriceSchedule', () => {
  it('snapshots the actual current price at creation time', async () => {
    const result = await createPriceSchedule({ productId: PRODUCT_ID, variantId: null, newPrice: 45, newOldPrice: null, startsAt: futureDate() }, ADMIN_ID)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.schedule.expectedCurrentPrice).toBe(50)
  })

  it('rejects a target product/variant that does not exist', async () => {
    const result = await createPriceSchedule({ productId: 'does-not-exist', variantId: null, newPrice: 45, newOldPrice: null, startsAt: futureDate() }, ADMIN_ID)
    expect(result).toEqual({ ok: false, error: 'target_not_found' })
  })

  it('rejects a start time in the past', async () => {
    const result = await createPriceSchedule({ productId: PRODUCT_ID, variantId: null, newPrice: 45, newOldPrice: null, startsAt: new Date(Date.now() - 60000).toISOString() }, ADMIN_ID)
    expect(result).toEqual({ ok: false, error: 'starts_at_in_past' })
  })

  it('supports variant-level schedules independently of the parent product', async () => {
    const result = await createPriceSchedule({ productId: null, variantId: VARIANT_ID, newPrice: 55, newOldPrice: null, startsAt: futureDate() }, ADMIN_ID)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.schedule.expectedCurrentPrice).toBe(60)
      expect(result.schedule.variantId).toBe(VARIANT_ID)
    }
  })
})

describe('runApplyScheduledBatch', () => {
  it('applies a due schedule, updates the product price, and records price history', async () => {
    await insertDueSchedule({ productId: PRODUCT_ID, newPrice: 45, newOldPrice: 55, expectedCurrentPrice: 50 })

    const { applied, conflicts } = await runApplyScheduledBatch(50)
    expect(applied).toBe(1)
    expect(conflicts).toBe(0)

    const { rows } = await pool.query<{ price: number, oldPrice: number }>('SELECT price, old_price as "oldPrice" FROM products WHERE id = $1', [PRODUCT_ID])
    expect(rows[0].price).toBe(45)
    expect(rows[0].oldPrice).toBe(55)

    const { rows: historyRows } = await pool.query('SELECT source, old_price as "oldPrice", new_price as "newPrice" FROM product_price_history WHERE product_id = $1', [PRODUCT_ID])
    expect(historyRows).toHaveLength(1)
    expect(historyRows[0]).toMatchObject({ source: 'scheduled_price', oldPrice: 50, newPrice: 45 })

    const [schedule] = await listPriceSchedules({ productId: PRODUCT_ID })
    expect(schedule.status).toBe('applied')
    expect(schedule.appliedAt).not.toBeNull()
  })

  it('never applies a schedule before its starts_at time', async () => {
    await createPriceSchedule({ productId: PRODUCT_ID, variantId: null, newPrice: 45, newOldPrice: null, startsAt: futureDate(60) }, ADMIN_ID)
    const { applied } = await runApplyScheduledBatch(50)
    expect(applied).toBe(0)

    const { rows } = await pool.query<{ price: number }>('SELECT price FROM products WHERE id = $1', [PRODUCT_ID])
    expect(rows[0].price).toBe(50)
  })

  it('detects a conflict when the price changed manually after the schedule was created, and does not overwrite it', async () => {
    await insertDueSchedule({ productId: PRODUCT_ID, newPrice: 45, expectedCurrentPrice: 50 })

    // تعديل يدوي للسعر بعد إنشاء الجدولة مباشرة — بيحاكي أدمن غيّر السعر من صفحة المنتج.
    await pool.query('UPDATE products SET price = 70 WHERE id = $1', [PRODUCT_ID])

    const { applied, conflicts } = await runApplyScheduledBatch(50)
    expect(applied).toBe(0)
    expect(conflicts).toBe(1)

    const { rows } = await pool.query<{ price: number }>('SELECT price FROM products WHERE id = $1', [PRODUCT_ID])
    expect(rows[0].price).toBe(70) // لسه 70، مش 45 — التعارض منع الكتابة فوق التعديل اليدوي

    const [schedule] = await listPriceSchedules({ productId: PRODUCT_ID })
    expect(schedule.status).toBe('conflict')
  })

  it('is safe under concurrent overlapping runs — never applies the same schedule twice', async () => {
    await insertDueSchedule({ productId: PRODUCT_ID, newPrice: 45, expectedCurrentPrice: 50 })

    const [first, second] = await Promise.all([runApplyScheduledBatch(50), runApplyScheduledBatch(50)])
    const totalApplied = first.applied + second.applied
    expect(totalApplied).toBe(1)

    const { rows: historyRows } = await pool.query('SELECT count(*) as n FROM product_price_history WHERE product_id = $1', [PRODUCT_ID])
    expect(Number(historyRows[0].n)).toBe(1)
  })
})

describe('cancelPriceSchedule', () => {
  it('cancels a pending schedule', async () => {
    const created = await createPriceSchedule({ productId: PRODUCT_ID, variantId: null, newPrice: 45, newOldPrice: null, startsAt: futureDate() }, ADMIN_ID)
    expect(created.ok).toBe(true)
    if (!created.ok) return

    const cancelled = await cancelPriceSchedule(created.schedule.id)
    expect(cancelled).toBe(true)

    const [schedule] = await listPriceSchedules({ productId: PRODUCT_ID })
    expect(schedule.status).toBe('cancelled')
  })

  it('cannot cancel a schedule that has already been applied', async () => {
    const id = await insertDueSchedule({ productId: PRODUCT_ID, newPrice: 45, expectedCurrentPrice: 50 })
    await runApplyScheduledBatch(50)

    const cancelled = await cancelPriceSchedule(id)
    expect(cancelled).toBe(false)
  })
})
