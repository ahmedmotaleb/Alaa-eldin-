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
}

const ZONE_FIELDS = 'governorate, delivery_fee as "deliveryFee", is_active as "isActive", sort_order as "sortOrder"'
const SLOT_FIELDS = 'id, label, note, is_active as "isActive", sort_order as "sortOrder"'

function mapZone(row: { governorate: string, deliveryFee: number, isActive: number, sortOrder: number }): DeliveryZone {
  return { governorate: row.governorate, deliveryFee: row.deliveryFee, isActive: !!row.isActive, sortOrder: row.sortOrder }
}

function mapSlot(row: { id: string, label: string, note: string, isActive: number, sortOrder: number }): DeliverySlot {
  return { id: row.id, label: row.label, note: row.note, isActive: !!row.isActive, sortOrder: row.sortOrder }
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

export async function createDeliverySlot(input: { id: string, label: string, note: string, isActive: boolean }): Promise<DeliverySlot> {
  const { rows: maxRows } = await pool.query<{ m: number | null }>('SELECT MAX(sort_order) as m FROM delivery_slots')
  const sortOrder = (maxRows[0].m ?? -1) + 1
  const { rows } = await pool.query(
    `INSERT INTO delivery_slots (id, label, note, is_active, sort_order) VALUES ($1,$2,$3,$4,$5) RETURNING ${SLOT_FIELDS}`,
    [input.id, input.label, input.note, input.isActive ? 1 : 0, sortOrder]
  )
  return mapSlot(rows[0])
}

export async function updateDeliverySlot(
  id: string,
  updates: { label: string, note: string, isActive: boolean }
): Promise<DeliverySlot | null> {
  const { rows } = await pool.query(
    `UPDATE delivery_slots SET label = $2, note = $3, is_active = $4 WHERE id = $1 RETURNING ${SLOT_FIELDS}`,
    [id, updates.label, updates.note, updates.isActive ? 1 : 0]
  )
  return rows[0] ? mapSlot(rows[0]) : null
}
