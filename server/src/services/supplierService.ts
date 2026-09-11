import crypto from 'node:crypto'
import { pool } from '../db.js'

export interface SupplierRow {
  id: string
  name: string
  contactPerson: string
  mobile: string
  whatsapp: string
  email: string
  address: string
  taxNumber: string
  notes: string
  active: boolean
  createdAt: string
  updatedAt: string
}

export interface SupplierInput {
  name: string
  contactPerson?: string
  mobile?: string
  whatsapp?: string
  email?: string
  address?: string
  taxNumber?: string
  notes?: string
}

const SUPPLIER_SELECT = `
  SELECT id, name, contact_person as "contactPerson", mobile, whatsapp, email, address,
         tax_number as "taxNumber", notes, active, created_at as "createdAt", updated_at as "updatedAt"
  FROM suppliers
`

function serialize(row: SupplierRow): SupplierRow {
  return { ...row, active: !!row.active }
}

export async function listSuppliers(params: { search?: string; activeOnly?: boolean } = {}): Promise<SupplierRow[]> {
  const conditions: string[] = []
  const values: unknown[] = []
  if (params.search?.trim()) {
    values.push(`%${params.search.trim()}%`)
    conditions.push(`(name ILIKE $${values.length} OR mobile ILIKE $${values.length} OR whatsapp ILIKE $${values.length})`)
  }
  if (params.activeOnly) conditions.push('active = 1')
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const { rows } = await pool.query<SupplierRow>(`${SUPPLIER_SELECT} ${where} ORDER BY name ASC`, values)
  return rows.map(serialize)
}

export async function getSupplierById(id: string): Promise<SupplierRow | null> {
  const { rows } = await pool.query<SupplierRow>(`${SUPPLIER_SELECT} WHERE id = $1`, [id])
  return rows[0] ? serialize(rows[0]) : null
}

export async function createSupplier(input: SupplierInput): Promise<SupplierRow> {
  const id = crypto.randomUUID()
  const { rows } = await pool.query<SupplierRow>(
    `INSERT INTO suppliers (id, name, contact_person, mobile, whatsapp, email, address, tax_number, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, name, contact_person as "contactPerson", mobile, whatsapp, email, address,
               tax_number as "taxNumber", notes, active, created_at as "createdAt", updated_at as "updatedAt"`,
    [
      id, input.name.trim(),
      input.contactPerson?.trim() ?? '', input.mobile?.trim() ?? '', input.whatsapp?.trim() ?? '',
      input.email?.trim() ?? '', input.address?.trim() ?? '', input.taxNumber?.trim() ?? '', input.notes?.trim() ?? ''
    ]
  )
  return serialize(rows[0])
}

export async function updateSupplier(id: string, input: SupplierInput): Promise<SupplierRow | null> {
  const { rows } = await pool.query<SupplierRow>(
    `UPDATE suppliers SET
       name = $2, contact_person = $3, mobile = $4, whatsapp = $5, email = $6,
       address = $7, tax_number = $8, notes = $9, updated_at = now()
     WHERE id = $1
     RETURNING id, name, contact_person as "contactPerson", mobile, whatsapp, email, address,
               tax_number as "taxNumber", notes, active, created_at as "createdAt", updated_at as "updatedAt"`,
    [
      id, input.name.trim(),
      input.contactPerson?.trim() ?? '', input.mobile?.trim() ?? '', input.whatsapp?.trim() ?? '',
      input.email?.trim() ?? '', input.address?.trim() ?? '', input.taxNumber?.trim() ?? '', input.notes?.trim() ?? ''
    ]
  )
  return rows[0] ? serialize(rows[0]) : null
}

export async function setSupplierActive(id: string, active: boolean): Promise<SupplierRow | null> {
  const { rows } = await pool.query<SupplierRow>(
    `UPDATE suppliers SET active = $2, updated_at = now() WHERE id = $1
     RETURNING id, name, contact_person as "contactPerson", mobile, whatsapp, email, address,
               tax_number as "taxNumber", notes, active, created_at as "createdAt", updated_at as "updatedAt"`,
    [id, active ? 1 : 0]
  )
  return rows[0] ? serialize(rows[0]) : null
}

export interface SupplierProductRow {
  id: string
  supplierId: string
  productId: string
  supplierSku: string
  lastCost: number | null
  leadTimeDays: number | null
  minimumOrderQty: number | null
  preferred: boolean
  createdAt: string
  updatedAt: string
}

export interface SupplierProductInput {
  supplierSku?: string
  lastCost?: number | null
  leadTimeDays?: number | null
  minimumOrderQty?: number | null
  preferred?: boolean
}

const SUPPLIER_PRODUCT_SELECT = `
  SELECT id, supplier_id as "supplierId", product_id as "productId", supplier_sku as "supplierSku",
         last_cost as "lastCost", lead_time_days as "leadTimeDays", minimum_order_qty as "minimumOrderQty",
         preferred, created_at as "createdAt", updated_at as "updatedAt"
  FROM supplier_products
`

function serializeSupplierProduct(row: SupplierProductRow): SupplierProductRow {
  return {
    ...row,
    preferred: !!row.preferred,
    lastCost: row.lastCost !== null ? Number(row.lastCost) : null
  }
}

export async function listSupplierProductsForSupplier(supplierId: string): Promise<SupplierProductRow[]> {
  const { rows } = await pool.query<SupplierProductRow>(
    `${SUPPLIER_PRODUCT_SELECT} WHERE supplier_id = $1 ORDER BY created_at DESC`,
    [supplierId]
  )
  return rows.map(serializeSupplierProduct)
}

export async function listSuppliersForProduct(productId: string): Promise<SupplierProductRow[]> {
  const { rows } = await pool.query<SupplierProductRow>(
    `${SUPPLIER_PRODUCT_SELECT} WHERE product_id = $1 ORDER BY preferred DESC, created_at ASC`,
    [productId]
  )
  return rows.map(serializeSupplierProduct)
}

// "preferred" فريد لكل منتج (فهرس جزئي في الداتابيز) — لو الإدخال ده هيبقى المفضّل، لازم
// نشيل التفضيل من أي مورد تاني لنفس المنتج الأول جوه نفس المعاملة عشان الفهرس ما يرفضش الإدراج.
export async function upsertSupplierProduct(
  supplierId: string,
  productId: string,
  input: SupplierProductInput
): Promise<SupplierProductRow> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    if (input.preferred) {
      await client.query('UPDATE supplier_products SET preferred = 0, updated_at = now() WHERE product_id = $1 AND preferred = 1', [productId])
    }
    const { rows } = await client.query<SupplierProductRow>(
      `INSERT INTO supplier_products (id, supplier_id, product_id, supplier_sku, last_cost, lead_time_days, minimum_order_qty, preferred)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (supplier_id, product_id) DO UPDATE SET
         supplier_sku = $4, last_cost = $5, lead_time_days = $6, minimum_order_qty = $7, preferred = $8, updated_at = now()
       RETURNING id, supplier_id as "supplierId", product_id as "productId", supplier_sku as "supplierSku",
                 last_cost as "lastCost", lead_time_days as "leadTimeDays", minimum_order_qty as "minimumOrderQty",
                 preferred, created_at as "createdAt", updated_at as "updatedAt"`,
      [
        crypto.randomUUID(), supplierId, productId,
        input.supplierSku?.trim() ?? '', input.lastCost ?? null, input.leadTimeDays ?? null,
        input.minimumOrderQty ?? null, input.preferred ? 1 : 0
      ]
    )
    await client.query('COMMIT')
    return serializeSupplierProduct(rows[0])
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export async function removeSupplierProduct(supplierId: string, productId: string): Promise<void> {
  await pool.query('DELETE FROM supplier_products WHERE supplier_id = $1 AND product_id = $2', [supplierId, productId])
}
