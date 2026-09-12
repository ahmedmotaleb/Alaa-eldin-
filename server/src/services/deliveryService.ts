import type { PoolClient } from 'pg'
import { pool } from '../db.js'

export interface DeliveryZone {
  governorate: string
  deliveryFee: number
  isActive: boolean
  sortOrder: number
}

export interface DeliverySlot {
  id: string
  label: string
  note: string
  isActive: boolean
  sortOrder: number
  maxOrdersPerDay: number | null
}

const ZONE_FIELDS = 'governorate, delivery_fee as "deliveryFee", is_active as "isActive", sort_order as "sortOrder"'
const SLOT_FIELDS = 'id, label, note, is_active as "isActive", sort_order as "sortOrder", max_orders_per_day as "maxOrdersPerDay"'

function mapZone(row: { governorate: string, deliveryFee: number, isActive: number, sortOrder: number }): DeliveryZone {
  return { governorate: row.governorate, deliveryFee: row.deliveryFee, isActive: !!row.isActive, sortOrder: row.sortOrder }
}

function mapSlot(row: { id: string, label: string, note: string, isActive: number, sortOrder: number, maxOrdersPerDay: number | null }): DeliverySlot {
  return { id: row.id, label: row.label, note: row.note, isActive: !!row.isActive, sortOrder: row.sortOrder, maxOrdersPerDay: row.maxOrdersPerDay }
}

// النسخة العامة (للعميل): بس المناطق/المواعيد المفعّلة، بترتيب العرض.
export async function listActiveDeliveryZones(): Promise<DeliveryZone[]> {
  const { rows } = await pool.query(`SELECT ${ZONE_FIELDS} FROM delivery_zones WHERE is_active = 1 ORDER BY sort_order, governorate`)
  return rows.map(mapZone)
}

export async function listActiveDeliverySlots(): Promise<DeliverySlot[]> {
  const { rows } = await pool.query(`SELECT ${SLOT_FIELDS} FROM delivery_slots WHERE is_active = 1 ORDER BY sort_order`)
  return rows.map(mapSlot)
}

// عدد الطلبات المستخدَمة من سعة الميعاد "اليوم" — المواعيد نص نسبي (now/evening/tomorrow)
// مش مربوطة بتاريخ توصيل محدد فعلياً، فـ"اليوم" (تاريخ إنشاء الطلب) هو أقرب مرجع عملي متاح؛
// تبسيط متعمّد وموثّق، مش نظام تواريخ توصيل كامل.
export async function getDeliverySlotUsageToday(slotId: string): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(
    `SELECT COUNT(*) as n FROM orders
     WHERE delivery_slot = $1 AND created_at::date = CURRENT_DATE AND status != 'cancelled'`,
    [slotId]
  )
  return Number(rows[0].n)
}

// بيرجع كل المواعيد المفعّلة مع سعتها المتبقية النهاردة — يستخدمها العميل وقت الدفع عشان
// يشوف المواعيد الممتلئة قبل ما يحاول يختارها، مش بس يترفض بعد المحاولة.
export async function listActiveDeliverySlotsWithAvailability(): Promise<(DeliverySlot & { usedToday: number; available: boolean })[]> {
  const slots = await listActiveDeliverySlots()
  return Promise.all(slots.map(async slot => {
    if (slot.maxOrdersPerDay === null) return { ...slot, usedToday: 0, available: true }
    const usedToday = await getDeliverySlotUsageToday(slot.id)
    return { ...slot, usedToday, available: usedToday < slot.maxOrdersPerDay }
  }))
}

// بيتنادى جوه معاملة إنشاء الطلب (FOR UPDATE على صفوف الطلبات النهاردة مش ممكن هنا بسهولة —
// السباق النظري لو طلبين بالظبط في نفس اللحظة على آخر مكان فاضل نادر جداً وغير حرج زي حجز
// مخزون؛ لو حصل، النتيجة القصوى طلب واحد زيادة عن السعة المحددة، مش بيع منتج مش موجود).
export async function checkDeliverySlotCapacity(client: PoolClient, slotId: string): Promise<boolean> {
  const { rows } = await client.query<{ maxOrdersPerDay: number | null }>(
    'SELECT max_orders_per_day as "maxOrdersPerDay" FROM delivery_slots WHERE id = $1',
    [slotId]
  )
  const maxOrdersPerDay = rows[0]?.maxOrdersPerDay
  if (maxOrdersPerDay === null || maxOrdersPerDay === undefined) return true

  const { rows: countRows } = await client.query<{ n: string }>(
    `SELECT COUNT(*) as n FROM orders
     WHERE delivery_slot = $1 AND created_at::date = CURRENT_DATE AND status != 'cancelled'`,
    [slotId]
  )
  return Number(countRows[0].n) < maxOrdersPerDay
}

// بيتنادى جوه معاملة إنشاء الطلب — بيرجع null لو المحافظة مش موجودة أو متوقفة حالياً،
// عشان الطلب يترفض بدل ما يتحسب برسوم توصيل افتراضية غلط.
export async function getActiveDeliveryZoneFee(client: PoolClient, governorate: string): Promise<number | null> {
  const { rows } = await client.query<{ deliveryFee: number }>(
    'SELECT delivery_fee as "deliveryFee" FROM delivery_zones WHERE governorate = $1 AND is_active = 1',
    [governorate]
  )
  return rows[0] ? rows[0].deliveryFee : null
}

export async function isActiveDeliverySlot(client: PoolClient, slotId: string): Promise<boolean> {
  const { rows } = await client.query('SELECT 1 FROM delivery_slots WHERE id = $1 AND is_active = 1', [slotId])
  return rows.length > 0
}

// --- إدارة (أدمن) ---

export async function listAllDeliveryZones(): Promise<DeliveryZone[]> {
  const { rows } = await pool.query(`SELECT ${ZONE_FIELDS} FROM delivery_zones ORDER BY sort_order, governorate`)
  return rows.map(mapZone)
}

export async function updateDeliveryZone(
  governorate: string,
  updates: { deliveryFee: number, isActive: boolean }
): Promise<DeliveryZone | null> {
  const { rows } = await pool.query(
    `UPDATE delivery_zones SET delivery_fee = $2, is_active = $3 WHERE governorate = $1 RETURNING ${ZONE_FIELDS}`,
    [governorate, updates.deliveryFee, updates.isActive ? 1 : 0]
  )
  return rows[0] ? mapZone(rows[0]) : null
}

export async function listAllDeliverySlots(): Promise<DeliverySlot[]> {
  const { rows } = await pool.query(`SELECT ${SLOT_FIELDS} FROM delivery_slots ORDER BY sort_order`)
  return rows.map(mapSlot)
}

export async function createDeliverySlot(input: { id: string, label: string, note: string, isActive: boolean, maxOrdersPerDay: number | null }): Promise<DeliverySlot> {
  const { rows: maxRows } = await pool.query<{ m: number | null }>('SELECT MAX(sort_order) as m FROM delivery_slots')
  const sortOrder = (maxRows[0].m ?? -1) + 1
  const { rows } = await pool.query(
    `INSERT INTO delivery_slots (id, label, note, is_active, sort_order, max_orders_per_day) VALUES ($1,$2,$3,$4,$5,$6) RETURNING ${SLOT_FIELDS}`,
    [input.id, input.label, input.note, input.isActive ? 1 : 0, sortOrder, input.maxOrdersPerDay]
  )
  return mapSlot(rows[0])
}

export async function updateDeliverySlot(
  id: string,
  updates: { label: string, note: string, isActive: boolean, maxOrdersPerDay: number | null }
): Promise<DeliverySlot | null> {
  const { rows } = await pool.query(
    `UPDATE delivery_slots SET label = $2, note = $3, is_active = $4, max_orders_per_day = $5 WHERE id = $1 RETURNING ${SLOT_FIELDS}`,
    [id, updates.label, updates.note, updates.isActive ? 1 : 0, updates.maxOrdersPerDay]
  )
  return rows[0] ? mapSlot(rows[0]) : null
}
