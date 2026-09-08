import { pool } from './db.js'

export interface DiscountRow {
  code: string
  type: 'percentage' | 'fixed'
  value: number
  minOrder: number
  maxUses: number | null
  usedCount: number
  active: number
  expiresAt: string | null
  createdAt: string
}

const SELECT_DISCOUNT = `
  SELECT code, type, value, min_order as "minOrder", max_uses as "maxUses", used_count as "usedCount",
         active, expires_at as "expiresAt", created_at as "createdAt"
  FROM discounts WHERE code = $1
`

export async function findDiscount(code: string): Promise<DiscountRow | undefined> {
  const { rows } = await pool.query<DiscountRow>(SELECT_DISCOUNT, [code.trim().toUpperCase()])
  return rows[0]
}

export function computeDiscountAmount(discount: DiscountRow, subtotal: number) {
  const raw = discount.type === 'percentage' ? subtotal * (discount.value / 100) : discount.value
  return Math.min(Math.round(raw * 100) / 100, subtotal)
}

export type DiscountError = 'discount_not_found' | 'discount_inactive' | 'discount_expired' | 'discount_min_order' | 'discount_max_uses'

export async function evaluateDiscount(code: string, subtotal: number): Promise<
  | { ok: true, discount: DiscountRow, amount: number }
  | { ok: false, error: DiscountError, minOrder?: number }
> {
  const discount = await findDiscount(code)
  if (!discount) return { ok: false, error: 'discount_not_found' }
  if (!discount.active) return { ok: false, error: 'discount_inactive' }
  if (discount.expiresAt && new Date(discount.expiresAt).getTime() < Date.now()) return { ok: false, error: 'discount_expired' }
  if (discount.maxUses !== null && discount.usedCount >= discount.maxUses) return { ok: false, error: 'discount_max_uses' }
  if (subtotal < discount.minOrder) return { ok: false, error: 'discount_min_order', minOrder: discount.minOrder }

  return { ok: true, discount, amount: computeDiscountAmount(discount, subtotal) }
}
