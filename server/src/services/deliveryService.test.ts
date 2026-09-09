import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { pool, withTransaction } from '../db.js'
import {
  listActiveDeliveryZones, listActiveDeliverySlots, getActiveDeliveryZoneFee, isActiveDeliverySlot,
  listAllDeliveryZones, updateDeliveryZone, listAllDeliverySlots, createDeliverySlot, updateDeliverySlot
} from './deliveryService.js'

const TEST_SLOT_ID = 'test-slot-1'

// delivery_zones/delivery_slots بيانات مرجعية دائمة (اتزرعت بالـ migration، مش fixture لكل
// اختبار) — بترجع لحالتها الافتراضية قبل كل اختبار عشان مفيش اختبار يأثر على اللي بعده.
async function resetFixtures() {
  await pool.query(`DELETE FROM delivery_slots WHERE id = $1`, [TEST_SLOT_ID])
  await pool.query(`UPDATE delivery_zones SET delivery_fee = 30, is_active = 1 WHERE governorate = 'القاهرة'`)
  await pool.query(`UPDATE delivery_zones SET is_active = 1 WHERE governorate = 'الجيزة'`)
  await pool.query(`UPDATE delivery_slots SET is_active = 1 WHERE id IN ('now', 'evening', 'tomorrow')`)
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
    const slot = await createDeliverySlot({ id: TEST_SLOT_ID, label: 'ميعاد اختبار', note: 'ملاحظة', isActive: true })
    expect(slot).toMatchObject({ id: TEST_SLOT_ID, label: 'ميعاد اختبار', note: 'ملاحظة', isActive: true })
    const all = await listAllDeliverySlots()
    const maxExistingOrder = Math.max(...all.filter(s => s.id !== TEST_SLOT_ID).map(s => s.sortOrder))
    expect(slot.sortOrder).toBeGreaterThan(maxExistingOrder)
  })

  it('updateDeliverySlot changes label/note/active state', async () => {
    await createDeliverySlot({ id: TEST_SLOT_ID, label: 'قبل', note: '', isActive: true })
    const updated = await updateDeliverySlot(TEST_SLOT_ID, { label: 'بعد', note: 'ملاحظة جديدة', isActive: false })
    expect(updated).toMatchObject({ id: TEST_SLOT_ID, label: 'بعد', note: 'ملاحظة جديدة', isActive: false })
  })

  it('updateDeliverySlot returns null for a nonexistent slot id', async () => {
    expect(await updateDeliverySlot('nonexistent', { label: 'x', note: '', isActive: true })).toBeNull()
  })
})
