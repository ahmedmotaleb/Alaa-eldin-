import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { pool, withTransaction } from '../db.js'
import {
  listActiveDeliveryZones, listActiveDeliverySlots, getActiveDeliveryZoneFee, isActiveDeliverySlot,
  listAllDeliveryZones, updateDeliveryZone, listAllDeliverySlots, createDeliverySlot, updateDeliverySlot,
  checkDeliverySlotCapacityForDate, getDeliverySlotUsageForDate, listActiveDeliverySlotsWithAvailability,
  getEffectiveSlotCapacity, getDeliveryCalendarSettings, updateDeliveryCalendarSettings,
  upsertDateOverride, deleteDateOverride, listDateOverridesInRange, isDeliveryDateOpen,
  setSlotDateCapacity, listSlotDateCapacityOverridesInRange
} from './deliveryService.js'
import { todayInCairo, addCalendarDays, isoWeekdayOf } from '../cairoDate.js'

const TEST_SLOT_ID = 'test-slot-1'
const TEST_ORDER_ID_1 = 'test-order-capacity-1'
const TEST_ORDER_ID_2 = 'test-order-capacity-2'
const TEST_CATEGORY_ID = 'test-cat-capacity'
const TEST_PRODUCT_ID = 'test-prod-capacity'
const TEST_DATE = todayInCairo()

// delivery_zones/delivery_slots بيانات مرجعية دائمة (اتزرعت بالـ migration، مش fixture لكل
// اختبار) — بترجع لحالتها الافتراضية قبل كل اختبار عشان مفيش اختبار يأثر على اللي بعده.
// delivery_date_overrides/delivery_slot_date_capacity/إعدادات التقويم مش بيانات مرجعية —
// لازم تترجع لحالتها الافتراضية (فاضية) كمان.
async function resetFixtures() {
  await pool.query(`DELETE FROM orders WHERE id = ANY($1::text[])`, [[TEST_ORDER_ID_1, TEST_ORDER_ID_2]])
  await pool.query(`DELETE FROM products WHERE id = $1`, [TEST_PRODUCT_ID])
  await pool.query(`DELETE FROM categories WHERE id = $1`, [TEST_CATEGORY_ID])
  await pool.query(`DELETE FROM delivery_slots WHERE id = $1`, [TEST_SLOT_ID])
  await pool.query(`UPDATE delivery_zones SET delivery_fee = 30, is_active = 1 WHERE governorate = 'القاهرة'`)
  await pool.query(`UPDATE delivery_zones SET is_active = 1 WHERE governorate = 'الجيزة'`)
  await pool.query(`UPDATE delivery_slots SET is_active = 1, max_orders_per_day = NULL WHERE id IN ('now', 'evening', 'tomorrow')`)
  await pool.query('DELETE FROM delivery_date_overrides')
  await pool.query('DELETE FROM delivery_slot_date_capacity')
  await pool.query(`UPDATE store_settings SET delivery_days_ahead = 7, delivery_closed_weekdays = '' WHERE id = 1`)
}

async function insertOrderForSlot(id: string, slotId: string, status = 'placed', deliveryDate = TEST_DATE) {
  await pool.query(
    `INSERT INTO categories (id, name, emoji, tint, sort_order) VALUES ($1, 'فئة', '🧪', '#fff', 1) ON CONFLICT (id) DO NOTHING`,
    [TEST_CATEGORY_ID]
  )
  await pool.query(
    `INSERT INTO products (id, slug, category_id, name, description, price, cost, unit, emoji, available, stock, created_at)
     VALUES ($1, 'capacity-prod', $2, 'منتج', 'وصف', 10, 5, 'وحدة', '🧪', 1, 50, now())
     ON CONFLICT (id) DO NOTHING`,
    [TEST_PRODUCT_ID, TEST_CATEGORY_ID]
  )
  await pool.query(
    `INSERT INTO orders (id, order_number, created_at, delivery_slot, delivery_date, payment_method,
       customer_full_name, customer_mobile, customer_governorate, customer_address,
       subtotal, delivery_fee, total, status)
     VALUES ($1, $1, now(), $2, $4, 'COD', 'عميل اختبار', '01012345678', 'القاهرة', 'عنوان', 10, 0, 10, $3)`,
    [id, slotId, status, deliveryDate]
  )
}

beforeEach(async () => {
  await resetFixtures()
})

afterAll(async () => {
  await resetFixtures()
  await pool.end()
})

describe('listActiveDeliveryZones / listActiveDeliverySlots (public)', () => {
  it('never includes a deactivated zone', async () => {
    await pool.query(`UPDATE delivery_zones SET is_active = 0 WHERE governorate = 'الجيزة'`)
    const zones = await listActiveDeliveryZones()
    expect(zones.some(z => z.governorate === 'الجيزة')).toBe(false)
    expect(zones.some(z => z.governorate === 'القاهرة')).toBe(true)
  })

  it('never includes a deactivated slot', async () => {
    await pool.query(`UPDATE delivery_slots SET is_active = 0 WHERE id = 'evening'`)
    const slots = await listActiveDeliverySlots()
    expect(slots.some(s => s.id === 'evening')).toBe(false)
    expect(slots.some(s => s.id === 'now')).toBe(true)
  })

  it('exposes only governorate/deliveryFee shape, no internal is_active/sort_order leaking through the type', async () => {
    const zones = await listActiveDeliveryZones()
    const cairo = zones.find(z => z.governorate === 'القاهرة')
    expect(cairo).toMatchObject({ governorate: 'القاهرة', deliveryFee: 30, isActive: true })
  })
})

describe('getActiveDeliveryZoneFee / isActiveDeliverySlot (used inside checkout transaction)', () => {
  it('returns the fee for an active zone', async () => {
    await withTransaction(async client => {
      expect(await getActiveDeliveryZoneFee(client, 'القاهرة')).toBe(30)
    })
  })

  it('returns null for a deactivated zone', async () => {
    await pool.query(`UPDATE delivery_zones SET is_active = 0 WHERE governorate = 'القاهرة'`)
    await withTransaction(async client => {
      expect(await getActiveDeliveryZoneFee(client, 'القاهرة')).toBeNull()
    })
  })

  it('returns null for a governorate that was never configured as a zone', async () => {
    await withTransaction(async client => {
      expect(await getActiveDeliveryZoneFee(client, 'محافظة وهمية')).toBeNull()
    })
  })

  it('confirms an active slot', async () => {
    await withTransaction(async client => {
      expect(await isActiveDeliverySlot(client, 'now')).toBe(true)
    })
  })

  it('rejects a deactivated slot', async () => {
    await pool.query(`UPDATE delivery_slots SET is_active = 0 WHERE id = 'now'`)
    await withTransaction(async client => {
      expect(await isActiveDeliverySlot(client, 'now')).toBe(false)
    })
  })

  it('rejects a slot id that was never created', async () => {
    await withTransaction(async client => {
      expect(await isActiveDeliverySlot(client, 'nonexistent')).toBe(false)
    })
  })
})

describe('admin management', () => {
  it('listAllDeliveryZones includes deactivated zones too (unlike the public list)', async () => {
    await pool.query(`UPDATE delivery_zones SET is_active = 0 WHERE governorate = 'الجيزة'`)
    const zones = await listAllDeliveryZones()
    expect(zones.find(z => z.governorate === 'الجيزة')).toMatchObject({ isActive: false })
  })

  it('updateDeliveryZone changes fee and active state, and only that zone', async () => {
    const updated = await updateDeliveryZone('الجيزة', { deliveryFee: 45, isActive: false })
    expect(updated).toMatchObject({ governorate: 'الجيزة', deliveryFee: 45, isActive: false })
    const cairo = (await listAllDeliveryZones()).find(z => z.governorate === 'القاهرة')
    expect(cairo).toMatchObject({ deliveryFee: 30, isActive: true })
  })

  it('updateDeliveryZone returns null for a governorate outside the fixed zone list', async () => {
    expect(await updateDeliveryZone('محافظة مش موجودة أصلاً', { deliveryFee: 10, isActive: true })).toBeNull()
  })

  it('createDeliverySlot adds a new slot after the existing ones, active by default as requested', async () => {
    const slot = await createDeliverySlot({ id: TEST_SLOT_ID, label: 'ميعاد اختبار', note: 'ملاحظة', isActive: true, maxOrdersPerDay: null })
    expect(slot).toMatchObject({ id: TEST_SLOT_ID, label: 'ميعاد اختبار', note: 'ملاحظة', isActive: true })
    const all = await listAllDeliverySlots()
    const maxExistingOrder = Math.max(...all.filter(s => s.id !== TEST_SLOT_ID).map(s => s.sortOrder))
    expect(slot.sortOrder).toBeGreaterThan(maxExistingOrder)
  })

  it('updateDeliverySlot changes label/note/active state', async () => {
    await createDeliverySlot({ id: TEST_SLOT_ID, label: 'قبل', note: '', isActive: true, maxOrdersPerDay: null })
    const updated = await updateDeliverySlot(TEST_SLOT_ID, { label: 'بعد', note: 'ملاحظة جديدة', isActive: false, maxOrdersPerDay: 5 })
    expect(updated).toMatchObject({ id: TEST_SLOT_ID, label: 'بعد', note: 'ملاحظة جديدة', isActive: false })
  })

  it('updateDeliverySlot returns null for a nonexistent slot id', async () => {
    expect(await updateDeliverySlot('nonexistent', { label: 'x', note: '', isActive: true, maxOrdersPerDay: null })).toBeNull()
  })
})

describe('delivery slot capacity (by delivery date)', () => {
  // بتستخدم ميعاد مخصص للاختبار (TEST_SLOT_ID) بدل المواعيد المشتركة (now/evening/tomorrow)
  // عشان النتيجة تفضل معزولة تماماً عن أي طلبات حقيقية تانية بنفس الميعاد المشترك من ملفات
  // اختبار تانية — مش بس عدد بيعتمد على إن الاختبار ده لوحده في الجدول.
  beforeEach(async () => {
    await createDeliverySlot({ id: TEST_SLOT_ID, label: 'ميعاد اختبار السعة', note: '', isActive: true, maxOrdersPerDay: null })
  })

  it('checkDeliverySlotCapacityForDate allows unlimited orders when maxOrdersPerDay is null', async () => {
    await insertOrderForSlot(TEST_ORDER_ID_1, TEST_SLOT_ID)
    await withTransaction(async client => {
      expect(await checkDeliverySlotCapacityForDate(client, TEST_SLOT_ID, TEST_DATE)).toBe(true)
    })
  })

  it('getDeliverySlotUsageForDate counts only non-cancelled orders for that slot+date', async () => {
    await insertOrderForSlot(TEST_ORDER_ID_1, TEST_SLOT_ID, 'placed')
    await insertOrderForSlot(TEST_ORDER_ID_2, TEST_SLOT_ID, 'cancelled')
    expect(await getDeliverySlotUsageForDate(TEST_SLOT_ID, TEST_DATE)).toBe(1)
  })

  it('getDeliverySlotUsageForDate does not count an order placed for a different delivery date', async () => {
    await insertOrderForSlot(TEST_ORDER_ID_1, TEST_SLOT_ID, 'placed', addCalendarDays(TEST_DATE, 1))
    expect(await getDeliverySlotUsageForDate(TEST_SLOT_ID, TEST_DATE)).toBe(0)
  })

  it('checkDeliverySlotCapacityForDate blocks once usage reaches the configured max for that date', async () => {
    await pool.query(`UPDATE delivery_slots SET max_orders_per_day = 1 WHERE id = $1`, [TEST_SLOT_ID])
    await insertOrderForSlot(TEST_ORDER_ID_1, TEST_SLOT_ID)
    await withTransaction(async client => {
      expect(await checkDeliverySlotCapacityForDate(client, TEST_SLOT_ID, TEST_DATE)).toBe(false)
    })
  })

  it('checkDeliverySlotCapacityForDate ignores cancelled orders when counting against the cap', async () => {
    await pool.query(`UPDATE delivery_slots SET max_orders_per_day = 1 WHERE id = $1`, [TEST_SLOT_ID])
    await insertOrderForSlot(TEST_ORDER_ID_1, TEST_SLOT_ID, 'cancelled')
    await withTransaction(async client => {
      expect(await checkDeliverySlotCapacityForDate(client, TEST_SLOT_ID, TEST_DATE)).toBe(true)
    })
  })

  it('checkDeliverySlotCapacityForDate does not block a different date once one date is full', async () => {
    await pool.query(`UPDATE delivery_slots SET max_orders_per_day = 1 WHERE id = $1`, [TEST_SLOT_ID])
    await insertOrderForSlot(TEST_ORDER_ID_1, TEST_SLOT_ID, 'placed', TEST_DATE)
    await withTransaction(async client => {
      expect(await checkDeliverySlotCapacityForDate(client, TEST_SLOT_ID, addCalendarDays(TEST_DATE, 1))).toBe(true)
    })
  })

  it('getEffectiveSlotCapacity prefers a per-date override over the slot default', async () => {
    await pool.query(`UPDATE delivery_slots SET max_orders_per_day = 10 WHERE id = $1`, [TEST_SLOT_ID])
    await setSlotDateCapacity(TEST_DATE, TEST_SLOT_ID, 2)
    expect(await getEffectiveSlotCapacity(pool, TEST_SLOT_ID, TEST_DATE)).toBe(2)
    expect(await getEffectiveSlotCapacity(pool, TEST_SLOT_ID, addCalendarDays(TEST_DATE, 1))).toBe(10)
  })

  it('setSlotDateCapacity(null) removes the override and reverts to the slot default', async () => {
    await pool.query(`UPDATE delivery_slots SET max_orders_per_day = 10 WHERE id = $1`, [TEST_SLOT_ID])
    await setSlotDateCapacity(TEST_DATE, TEST_SLOT_ID, 2)
    await setSlotDateCapacity(TEST_DATE, TEST_SLOT_ID, null)
    expect(await getEffectiveSlotCapacity(pool, TEST_SLOT_ID, TEST_DATE)).toBe(10)
  })

  it('listActiveDeliverySlotsWithAvailability marks a full slot as unavailable for that date, with remainingCapacity 0', async () => {
    await pool.query(`UPDATE delivery_slots SET max_orders_per_day = 1 WHERE id = $1`, [TEST_SLOT_ID])
    await insertOrderForSlot(TEST_ORDER_ID_1, TEST_SLOT_ID)
    const slots = await listActiveDeliverySlotsWithAvailability(TEST_DATE)
    const slot = slots.find(s => s.id === TEST_SLOT_ID)!
    expect(slot.available).toBe(false)
    expect(slot.usedToday).toBe(1)
    expect(slot.remainingCapacity).toBe(0)
  })

  it('listActiveDeliverySlotsWithAvailability marks an unlimited slot as always available with null remainingCapacity', async () => {
    const slots = await listActiveDeliverySlotsWithAvailability(TEST_DATE)
    const slot = slots.find(s => s.id === TEST_SLOT_ID)!
    expect(slot.available).toBe(true)
    expect(slot.remainingCapacity).toBeNull()
  })
})

describe('delivery calendar settings', () => {
  it('reads and updates days-ahead and closed weekdays', async () => {
    const updated = await updateDeliveryCalendarSettings({ daysAhead: 10, closedWeekdays: [5, 7] })
    expect(updated).toEqual({ daysAhead: 10, closedWeekdays: [5, 7] })
    expect(await getDeliveryCalendarSettings()).toEqual({ daysAhead: 10, closedWeekdays: [5, 7] })
  })

  it('defaults to 7 days ahead and no closed weekdays', async () => {
    expect(await getDeliveryCalendarSettings()).toEqual({ daysAhead: 7, closedWeekdays: [] })
  })
})

describe('isDeliveryDateOpen / date overrides', () => {
  it('is open by default when no closed weekday rule and no override exist', async () => {
    expect(await isDeliveryDateOpen(pool, TEST_DATE)).toBe(true)
  })

  it('is closed when its weekday is in the closed-weekdays list', async () => {
    await updateDeliveryCalendarSettings({ daysAhead: 7, closedWeekdays: [isoWeekdayOf(TEST_DATE)] })
    expect(await isDeliveryDateOpen(pool, TEST_DATE)).toBe(false)
  })

  it('an explicit active=false override closes a date regardless of the weekday rule', async () => {
    await upsertDateOverride(TEST_DATE, false, 'صيانة')
    expect(await isDeliveryDateOpen(pool, TEST_DATE)).toBe(false)
  })

  it('an explicit active=true override opens a date even on a normally-closed weekday', async () => {
    await updateDeliveryCalendarSettings({ daysAhead: 7, closedWeekdays: [isoWeekdayOf(TEST_DATE)] })
    await upsertDateOverride(TEST_DATE, true, 'فتح استثنائي')
    expect(await isDeliveryDateOpen(pool, TEST_DATE)).toBe(true)
  })

  it('deleteDateOverride reverts the date back to the weekday-rule default', async () => {
    await upsertDateOverride(TEST_DATE, false, 'مؤقت')
    expect(await isDeliveryDateOpen(pool, TEST_DATE)).toBe(false)
    expect(await deleteDateOverride(TEST_DATE)).toBe(true)
    expect(await isDeliveryDateOpen(pool, TEST_DATE)).toBe(true)
  })

  it('deleteDateOverride returns false for a date with no existing override', async () => {
    expect(await deleteDateOverride(TEST_DATE)).toBe(false)
  })

  it('listDateOverridesInRange only returns overrides within the requested range', async () => {
    const outOfRange = addCalendarDays(TEST_DATE, 100)
    await upsertDateOverride(TEST_DATE, false, 'داخل النطاق')
    await upsertDateOverride(outOfRange, false, 'برة النطاق')
    const overrides = await listDateOverridesInRange(TEST_DATE, addCalendarDays(TEST_DATE, 10))
    expect(overrides.map(o => o.date)).toEqual([TEST_DATE])
  })

  it('listSlotDateCapacityOverridesInRange only returns overrides within the requested range', async () => {
    await createDeliverySlot({ id: TEST_SLOT_ID, label: 'ميعاد اختبار السعة', note: '', isActive: true, maxOrdersPerDay: null })
    const outOfRange = addCalendarDays(TEST_DATE, 100)
    await setSlotDateCapacity(TEST_DATE, TEST_SLOT_ID, 3)
    await setSlotDateCapacity(outOfRange, TEST_SLOT_ID, 5)
    const overrides = await listSlotDateCapacityOverridesInRange(TEST_DATE, addCalendarDays(TEST_DATE, 10))
    expect(overrides).toEqual([{ date: TEST_DATE, slotId: TEST_SLOT_ID, maxOrders: 3 }])
  })
})
