import type { Pool, PoolClient } from 'pg'
import { pool } from '../db.js'
import { isoWeekdayOf, parseClosedWeekdays, serializeClosedWeekdays } from '../cairoDate.js'

// دوال السعة/التقويم بتحت بتقبل Pool أو PoolClient سوا — بعضها بيتنادى جوه معاملة إنشاء
// الطلب (لازم client عشان يشوف قفل الصفوف/القراءات الحالية جوه نفس المعاملة)، وبعضها
// بيتنادى بره أي معاملة (قوائم الإدارة، صفحة توفر المواعيد للعميل) فبيستخدم pool مباشرة.
type Queryable = Pool | PoolClient

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

// السعة الفعلية لميعاد معيّن في تاريخ توصيل معيّن: لو فيه سعة استثنائية مضبوطة لنفس
// التاريخ+الميعاد بالظبط (delivery_slot_date_capacity) بتتقدّم على القيمة الافتراضية
// للميعاد (delivery_slots.max_orders_per_day). null يعني بلا حد أقصى في الحالتين.
export async function getEffectiveSlotCapacity(db: Queryable, slotId: string, date: string): Promise<number | null> {
  const { rows: overrideRows } = await db.query<{ maxOrders: number }>(
    'SELECT max_orders as "maxOrders" FROM delivery_slot_date_capacity WHERE delivery_date = $1 AND delivery_slot_id = $2',
    [date, slotId]
  )
  if (overrideRows[0]) return overrideRows[0].maxOrders

  const { rows: slotRows } = await db.query<{ maxOrdersPerDay: number | null }>(
    'SELECT max_orders_per_day as "maxOrdersPerDay" FROM delivery_slots WHERE id = $1',
    [slotId]
  )
  return slotRows[0]?.maxOrdersPerDay ?? null
}

// عدد الطلبات المستخدَمة فعلياً من سعة ميعاد+تاريخ توصيل معيّن — السعة بقت مربوطة بتاريخ
// التوصيل الحقيقي (orders.delivery_date) بدل تاريخ إنشاء الطلب، عشان طلب اتعمل النهاردة
// لتوصيل بعد 3 أيام يتحسب على سعة يوم التوصيل نفسه مش يوم الطلب.
export async function getDeliverySlotUsageForDate(slotId: string, date: string): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(
    `SELECT COUNT(*) as n FROM orders
     WHERE delivery_slot = $1 AND delivery_date = $2 AND status != 'cancelled'`,
    [slotId, date]
  )
  return Number(rows[0].n)
}

// بيرجع كل المواعيد المفعّلة مع سعتها المتبقية لتاريخ توصيل معيّن — يستخدمها العميل وقت
// الدفع عشان يشوف المواعيد الممتلئة قبل ما يحاول يختارها، مش بس يترفض بعد المحاولة.
export async function listActiveDeliverySlotsWithAvailability(
  date: string
): Promise<(DeliverySlot & { usedToday: number; available: boolean; remainingCapacity: number | null })[]> {
  const slots = await listActiveDeliverySlots()
  return Promise.all(slots.map(async slot => {
    const maxOrders = await getEffectiveSlotCapacity(pool, slot.id, date)
    if (maxOrders === null) return { ...slot, usedToday: 0, available: true, remainingCapacity: null }
    const usedToday = await getDeliverySlotUsageForDate(slot.id, date)
    return { ...slot, usedToday, available: usedToday < maxOrders, remainingCapacity: Math.max(0, maxOrders - usedToday) }
  }))
}

// بيتنادى جوه معاملة إنشاء الطلب (FOR UPDATE على صفوف الطلبات لنفس التاريخ+الميعاد مش ممكن
// هنا بسهولة — السباق النظري لو طلبين بالظبط في نفس اللحظة على آخر مكان فاضل نادر جداً
// وغير حرج زي حجز مخزون؛ لو حصل، النتيجة القصوى طلب واحد زيادة عن السعة المحددة، مش بيع
// منتج مش موجود).
export async function checkDeliverySlotCapacityForDate(client: PoolClient, slotId: string, date: string): Promise<boolean> {
  const maxOrders = await getEffectiveSlotCapacity(client, slotId, date)
  if (maxOrders === null) return true

  const { rows: countRows } = await client.query<{ n: string }>(
    `SELECT COUNT(*) as n FROM orders
     WHERE delivery_slot = $1 AND delivery_date = $2 AND status != 'cancelled'`,
    [slotId, date]
  )
  return Number(countRows[0].n) < maxOrders
}

// --- تقويم التوصيل (تاريخ فعلي) ---

export interface DeliveryCalendarSettings {
  daysAhead: number
  closedWeekdays: number[]
}

export async function getDeliveryCalendarSettings(): Promise<DeliveryCalendarSettings> {
  const { rows } = await pool.query<{ daysAhead: number, closedWeekdays: string }>(
    'SELECT delivery_days_ahead as "daysAhead", delivery_closed_weekdays as "closedWeekdays" FROM store_settings WHERE id = 1'
  )
  return { daysAhead: rows[0].daysAhead, closedWeekdays: parseClosedWeekdays(rows[0].closedWeekdays) }
}

export async function updateDeliveryCalendarSettings(input: { daysAhead: number, closedWeekdays: number[] }): Promise<DeliveryCalendarSettings> {
  const closedWeekdaysRaw = serializeClosedWeekdays(input.closedWeekdays)
  await pool.query(
    'UPDATE store_settings SET delivery_days_ahead = $1, delivery_closed_weekdays = $2 WHERE id = 1',
    [input.daysAhead, closedWeekdaysRaw]
  )
  return { daysAhead: input.daysAhead, closedWeekdays: parseClosedWeekdays(closedWeekdaysRaw) }
}

export interface DeliveryDateOverride {
  date: string
  active: boolean
  notes: string
}

export async function listDateOverridesInRange(startDate: string, endDate: string): Promise<DeliveryDateOverride[]> {
  const { rows } = await pool.query<DeliveryDateOverride>(
    'SELECT delivery_date as "date", active, notes FROM delivery_date_overrides WHERE delivery_date BETWEEN $1 AND $2 ORDER BY delivery_date',
    [startDate, endDate]
  )
  return rows
}

export async function upsertDateOverride(date: string, active: boolean, notes: string): Promise<DeliveryDateOverride> {
  const { rows } = await pool.query<DeliveryDateOverride>(
    `INSERT INTO delivery_date_overrides (delivery_date, active, notes, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (delivery_date) DO UPDATE SET active = $2, notes = $3, updated_at = now()
     RETURNING delivery_date as "date", active, notes`,
    [date, active, notes]
  )
  return rows[0]
}

export async function deleteDateOverride(date: string): Promise<boolean> {
  const { rowCount } = await pool.query('DELETE FROM delivery_date_overrides WHERE delivery_date = $1', [date])
  return !!rowCount
}

// هل تاريخ توصيل معيّن مفتوح فعلياً؟ صف موجود في delivery_date_overrides بيتغلّب على القاعدة
// الأسبوعية الافتراضية تماماً لنفس التاريخ (سواء بالفتح الاستثنائي أو القفل الاستثنائي)؛
// من غير أي صف، بيرجع لقاعدة أيام الأسبوع المقفولة افتراضياً.
export async function isDeliveryDateOpen(db: Queryable, date: string): Promise<boolean> {
  const { rows: overrideRows } = await db.query<{ active: boolean }>(
    'SELECT active FROM delivery_date_overrides WHERE delivery_date = $1',
    [date]
  )
  if (overrideRows[0]) return overrideRows[0].active

  const { rows: settingsRows } = await db.query<{ closedWeekdays: string }>(
    'SELECT delivery_closed_weekdays as "closedWeekdays" FROM store_settings WHERE id = 1'
  )
  const closedWeekdays = parseClosedWeekdays(settingsRows[0].closedWeekdays)
  return !closedWeekdays.includes(isoWeekdayOf(date))
}

export interface SlotDateCapacityOverride {
  date: string
  slotId: string
  maxOrders: number
}

export async function listSlotDateCapacityOverridesInRange(startDate: string, endDate: string): Promise<SlotDateCapacityOverride[]> {
  const { rows } = await pool.query<SlotDateCapacityOverride>(
    'SELECT delivery_date as "date", delivery_slot_id as "slotId", max_orders as "maxOrders" FROM delivery_slot_date_capacity WHERE delivery_date BETWEEN $1 AND $2',
    [startDate, endDate]
  )
  return rows
}

// maxOrders = null بيشيل السعة الاستثنائية ويرجّع الميعاد لسعته الافتراضية (max_orders_per_day).
export async function setSlotDateCapacity(date: string, slotId: string, maxOrders: number | null): Promise<void> {
  if (maxOrders === null) {
    await pool.query('DELETE FROM delivery_slot_date_capacity WHERE delivery_date = $1 AND delivery_slot_id = $2', [date, slotId])
    return
  }
  await pool.query(
    `INSERT INTO delivery_slot_date_capacity (delivery_date, delivery_slot_id, max_orders)
     VALUES ($1, $2, $3)
     ON CONFLICT (delivery_date, delivery_slot_id) DO UPDATE SET max_orders = $3`,
    [date, slotId, maxOrders]
  )
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
