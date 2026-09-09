import crypto from 'node:crypto'
import { pool, withTransaction } from '../db.js'

export interface AddressInput {
  label: string
  fullName?: string
  mobile?: string
  governorate: string
  area?: string
  address: string
  building?: string
  floor?: string
  apartment?: string
  landmark?: string
  isDefault: boolean
}

export interface Address extends AddressInput {
  id: string
  createdAt: string
  updatedAt: string
}

interface AddressRow {
  id: string
  label: string
  fullName: string | null
  mobile: string | null
  governorate: string
  area: string
  address: string
  building: string
  floor: string
  apartment: string
  landmark: string
  isDefault: number
  createdAt: string
  updatedAt: string
}

const SELECT_FIELDS = `
  id, label, full_name as "fullName", mobile, governorate, area, address, building, floor, apartment, landmark,
  is_default as "isDefault", created_at as "createdAt", updated_at as "updatedAt"
`

function serialize(row: AddressRow): Address {
  return {
    id: row.id,
    label: row.label,
    fullName: row.fullName ?? undefined,
    mobile: row.mobile ?? undefined,
    governorate: row.governorate,
    area: row.area,
    address: row.address,
    building: row.building,
    floor: row.floor,
    apartment: row.apartment,
    landmark: row.landmark,
    isDefault: !!row.isDefault,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
}

export async function listAddresses(userId: string): Promise<Address[]> {
  const { rows } = await pool.query<AddressRow>(
    `SELECT ${SELECT_FIELDS} FROM customer_addresses WHERE user_id = $1 ORDER BY is_default DESC, updated_at DESC`,
    [userId]
  )
  return rows.map(serialize)
}

export async function getAddress(userId: string, id: string): Promise<Address | null> {
  const { rows } = await pool.query<AddressRow>(
    `SELECT ${SELECT_FIELDS} FROM customer_addresses WHERE user_id = $1 AND id = $2`,
    [userId, id]
  )
  return rows[0] ? serialize(rows[0]) : null
}

export async function createAddress(userId: string, input: AddressInput): Promise<Address> {
  const id = 'addr' + crypto.randomBytes(8).toString('hex')
  await withTransaction(async client => {
    if (input.isDefault) {
      await client.query('UPDATE customer_addresses SET is_default = 0 WHERE user_id = $1', [userId])
    }
    await client.query(
      `INSERT INTO customer_addresses
         (id, user_id, label, full_name, mobile, governorate, area, address, building, floor, apartment, landmark, is_default)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        id, userId, input.label, input.fullName ?? null, input.mobile ?? null, input.governorate,
        input.area ?? '', input.address, input.building ?? '', input.floor ?? '', input.apartment ?? '',
        input.landmark ?? '', input.isDefault ? 1 : 0
      ]
    )
  })
  return (await getAddress(userId, id))!
}

export async function updateAddress(userId: string, id: string, input: AddressInput): Promise<Address | null> {
  const existing = await getAddress(userId, id)
  if (!existing) return null

  await withTransaction(async client => {
    if (input.isDefault) {
      await client.query('UPDATE customer_addresses SET is_default = 0 WHERE user_id = $1 AND id != $2', [userId, id])
    }
    await client.query(
      `UPDATE customer_addresses SET
         label=$1, full_name=$2, mobile=$3, governorate=$4, area=$5, address=$6,
         building=$7, floor=$8, apartment=$9, landmark=$10, is_default=$11, updated_at=now()
       WHERE user_id = $12 AND id = $13`,
      [
        input.label, input.fullName ?? null, input.mobile ?? null, input.governorate, input.area ?? '', input.address,
        input.building ?? '', input.floor ?? '', input.apartment ?? '', input.landmark ?? '', input.isDefault ? 1 : 0,
        userId, id
      ]
    )
  })
  return getAddress(userId, id)
}

export async function deleteAddress(userId: string, id: string): Promise<boolean> {
  const { rowCount } = await pool.query('DELETE FROM customer_addresses WHERE user_id = $1 AND id = $2', [userId, id])
  return (rowCount ?? 0) > 0
}

export async function setDefaultAddress(userId: string, id: string): Promise<Address | null> {
  const existing = await getAddress(userId, id)
  if (!existing) return null
  await withTransaction(async client => {
    await client.query('UPDATE customer_addresses SET is_default = 0 WHERE user_id = $1', [userId])
    await client.query('UPDATE customer_addresses SET is_default = 1, updated_at = now() WHERE user_id = $1 AND id = $2', [userId, id])
  })
  return getAddress(userId, id)
}
