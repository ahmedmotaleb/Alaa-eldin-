import { db } from './db.js'

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
  SELECT code, type, value, min_order as minOrder, max_uses as maxUses, used_count as usedCount,
         active, expires_at as expiresAt, created_at as createdAt
  FROM discounts WHERE code = ?
`

export function findDiscount(code: string): DiscountRow | undefined {
  return db.prepare(SELECT_DISCOUNT).get(code.trim().toUpperCase()) as DiscountRow | undefined
}

export function computeDiscountAmount(discount: DiscountRow, subtotal: number) {
  const raw = discount.type === 'percentage' ? subtotal * (discount.value / 100) : discount.value
  return Math.min(Math.round(raw * 100) / 100, subtotal)
}

export type DiscountError = 'discount_not_found' | 'discount_inactive' | 'discount_expired' | 'discount_min_order' | 'discount_max_uses'

export function evaluateDiscount(code: string, subtotal: number):
  | { ok: true, discount: DiscountRow, amount: number }
  | { ok: false, error: DiscountError, minOrder?: number } {
  const discount = findDiscount(code)
  if (!discount) return { ok: false, error: 'discount_not_found' }
  if (!discount.active) return { ok: false, error: 'discount_inactive' }
  if (discount.expiresAt && new Date(discount.expiresAt).getTime() < Date.now()) return { ok: false, error: 'discount_expired' }
  if (discount.maxUses !== null && discount.usedCount >= discount.maxUses) return { ok: false, error: 'discount_max_uses' }
  if (subtotal < discount.minOrder) return { ok: false, error: 'discount_min_order', minOrder: discount.minOrder }

  return { ok: true, discount, amount: computeDiscountAmount(discount, subtotal) }
}
