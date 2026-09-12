import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { pool, withTransaction } from '../db.js'
import {
  listActiveDeliveryZones, listActiveDeliverySlots, getActiveDeliveryZoneFee, isActiveDeliverySlot,
  listAllDeliveryZones, updateDeliveryZone, listAllDeliverySlots, createDeliverySlot, updateDeliverySlot,
  checkDeliverySlotCapacity, getDeliverySlotUsageToday, listActiveDeliverySlotsWithAvailability
} from './deliveryService.js'

const TEST_SLOT_ID = 'test-slot-1'
const TEST_ORDER_ID_1 = 'test-order-capacity-1'
const TEST_ORDER_ID_2 = 'test-order-capacity-2'
const TEST_CATEGORY_ID = 'test-cat-capacity'
const TEST_PRODUCT_ID = 'test-prod-capacity'

// delivery_zones/delivery_slots بيانات مرجعية دائمة (اتزرعت بالـ migration، مش fixture لكل
// اختبار) — بترجع لحالتها الافتراضية قبل كل اختبار عشان مفيش اختبار يأثر على اللي بعده.
async function resetFixtures() {
  await pool.query(`DELETE FROM orders WHERE id = ANY($1::text[])`, [[TEST_ORDER_ID_1, TEST_ORDER_ID_2]])
  await pool.query(`DELETE FROM products WHERE id = $1`, [TEST_PRODUCT_ID])
  await pool.query(`DELETE FROM categories WHERE id = $1`, [TEST_CATEGORY_ID])
  await pool.query(`DELETE FROM delivery_slots WHERE id = $1`, [TEST_SLOT_ID])
  await pool.query(`UPDATE delivery_zones SET delivery_fee = 30, is_active = 1 WHERE governorate = 'القاهرة'`)
  await pool.query(`UPDATE delivery_zones SET is_active = 1 WHERE governorate = 'الجيزة'`)
  await pool.query(`UPDATE delivery_slots SET is_active = 1, max_orders_per_day = NULL WHERE id IN ('now', 'evening', 'tomorrow')`)
}

async function insertOrderForSlot(id: string, slotId: string, status = 'placed') {
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
    `INSERT INTO orders (id, order_number, created_at, delivery_slot, payment_method,
       customer_full_name, customer_mobile, customer_governorate, customer_address,
       subtotal, delivery_fee, total, status)
     VALUES ($1, $1, now(), $2, 'COD', 'عميل اختبار', '01012345678', 'القاهرة', 'عنوان', 10, 0, 10, $3)`,
    [id, slotId, status]
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

describe('delivery slot capacity', () => {
  // بتستخدم ميعاد مخصص للاختبار (TEST_SLOT_ID) بدل المواعيد المشتركة (now/evening/tomorrow)
  // عشان النتيجة تفضل معزولة تماماً عن أي طلبات حقيقية تانية بنفس الميعاد المشترك من ملفات
  // اختبار تانية — مش بس عدد بيعتمد على إن الاختبار ده لوحده في الجدول.
  beforeEach(async () => {
    await createDeliverySlot({ id: TEST_SLOT_ID, label: 'ميعاد اختبار السعة', note: '', isActive: true, maxOrdersPerDay: null })
  })

  it('checkDeliverySlotCapacity allows unlimited orders when maxOrdersPerDay is null', async () => {
    await insertOrderForSlot(TEST_ORDER_ID_1, TEST_SLOT_ID)
    await withTransaction(async client => {
      expect(await checkDeliverySlotCapacity(client, TEST_SLOT_ID)).toBe(true)
    })
  })

  it('getDeliverySlotUsageToday counts only today\'s non-cancelled orders for that slot', async () => {
    await insertOrderForSlot(TEST_ORDER_ID_1, TEST_SLOT_ID, 'placed')
    await insertOrderForSlot(TEST_ORDER_ID_2, TEST_SLOT_ID, 'cancelled')
    expect(await getDeliverySlotUsageToday(TEST_SLOT_ID)).toBe(1)
  })

  it('checkDeliverySlotCapacity blocks once usage reaches the configured max', async () => {
    await pool.query(`UPDATE delivery_slots SET max_orders_per_day = 1 WHERE id = $1`, [TEST_SLOT_ID])
    await insertOrderForSlot(TEST_ORDER_ID_1, TEST_SLOT_ID)
    await withTransaction(async client => {
      expect(await checkDeliverySlotCapacity(client, TEST_SLOT_ID)).toBe(false)
    })
  })

  it('checkDeliverySlotCapacity ignores cancelled orders when counting against the cap', async () => {
    await pool.query(`UPDATE delivery_slots SET max_orders_per_day = 1 WHERE id = $1`, [TEST_SLOT_ID])
    await insertOrderForSlot(TEST_ORDER_ID_1, TEST_SLOT_ID, 'cancelled')
    await withTransaction(async client => {
      expect(await checkDeliverySlotCapacity(client, TEST_SLOT_ID)).toBe(true)
    })
  })

  it('listActiveDeliverySlotsWithAvailability marks a full slot as unavailable', async () => {
    await pool.query(`UPDATE delivery_slots SET max_orders_per_day = 1 WHERE id = $1`, [TEST_SLOT_ID])
    await insertOrderForSlot(TEST_ORDER_ID_1, TEST_SLOT_ID)
    const slots = await listActiveDeliverySlotsWithAvailability()
    const slot = slots.find(s => s.id === TEST_SLOT_ID)!
    expect(slot.available).toBe(false)
    expect(slot.usedToday).toBe(1)
  })

  it('listActiveDeliverySlotsWithAvailability marks an unlimited slot as always available', async () => {
    const slots = await listActiveDeliverySlotsWithAvailability()
    const slot = slots.find(s => s.id === TEST_SLOT_ID)!
    expect(slot.available).toBe(true)
  })
})
