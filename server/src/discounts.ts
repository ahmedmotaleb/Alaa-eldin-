import type { PoolClient } from 'pg'
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

// بتُقفل (FOR UPDATE) داخل معاملة إنشاء الطلب — عشان لو فيه أكتر من عميل بيحاول يستخدم
// نفس كود الخصم في نفس اللحظة وفيه حد أقصى لعدد الاستخدامات (max_uses)، الطلبات التانية
// بتستنى لحد ما المعاملة الأولى تخلص (commit أو rollback) قبل ما تقرأ العدّاد، فمفيش
// احتمال إن طلبين يتحسبلهم نفس "الاستخدام الأخير" المسموح به في نفس الوقت.
export async function findDiscountForUpdate(client: PoolClient, code: string): Promise<DiscountRow | undefined> {
  const { rows } = await client.query<DiscountRow>(`${SELECT_DISCOUNT} FOR UPDATE`, [code.trim().toUpperCase()])
  return rows[0]
}

export function computeDiscountAmount(discount: DiscountRow, subtotal: number) {
  const raw = discount.type === 'percentage' ? subtotal * (discount.value / 100) : discount.value
  return Math.min(Math.round(raw * 100) / 100, subtotal)
}

export type DiscountError = 'discount_not_found' | 'discount_inactive' | 'discount_expired' | 'discount_min_order' | 'discount_max_uses'

export type DiscountEvaluation =
  | { ok: true, discount: DiscountRow, amount: number }
  | { ok: false, error: DiscountError, minOrder?: number }

// منطق التحقق نفسه، منفصل عن جلب الصف — بيُستخدم مع صف عادي (المعاينة العامة قبل الدفع)
// أو مع صف مُقفل بـ FOR UPDATE (أثناء إنشاء الطلب فعلياً).
export function validateDiscountAgainstSubtotal(discount: DiscountRow | undefined, subtotal: number): DiscountEvaluation {
  if (!discount) return { ok: false, error: 'discount_not_found' }
  if (!discount.active) return { ok: false, error: 'discount_inactive' }
  if (discount.expiresAt && new Date(discount.expiresAt).getTime() < Date.now()) return { ok: false, error: 'discount_expired' }
  if (discount.maxUses !== null && discount.usedCount >= discount.maxUses) return { ok: false, error: 'discount_max_uses' }
  if (subtotal < discount.minOrder) return { ok: false, error: 'discount_min_order', minOrder: discount.minOrder }

  return { ok: true, discount, amount: computeDiscountAmount(discount, subtotal) }
}

export async function evaluateDiscount(code: string, subtotal: number): Promise<DiscountEvaluation> {
  const discount = await findDiscount(code)
  return validateDiscountAgainstSubtotal(discount, subtotal)
}

// تحديث ذرّي وآمن من التزامن: الشرط (active AND under max_uses) بيتحقق في نفس جملة الـ
// UPDATE، مش في استعلام SELECT منفصل قبلها. حتى من غير القفل اليدوي (findDiscountForUpdate)
// ده كان كافي لمنع تجاوز max_uses، لكن مع القفل بيبقى فيه ضمان مزدوج. لو رجعت 0 صفوف
// معناها الخصم بقى مش صالح للاستخدام (اتلغي أو استنفد الحد الأقصى) في اللحظة دي بالظبط —
// ولازم المعاملة اللي بتنادي الدالة دي تعمل rollback للطلب كله.
export async function incrementDiscountUsageAtomic(client: PoolClient, code: string): Promise<boolean> {
  const result = await client.query(
    `UPDATE discounts SET used_count = used_count + 1
     WHERE code = $1 AND active = 1 AND (max_uses IS NULL OR used_count < max_uses)`,
    [code.trim().toUpperCase()]
  )
  return (result.rowCount ?? 0) > 0
}
