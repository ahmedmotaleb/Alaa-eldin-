import type { PoolClient } from 'pg'
import { pool } from './db.js'

export type DiscountScope = 'order' | 'category' | 'product'

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
  startsAt: string | null
  scope: DiscountScope
  scopeId: string | null
  minQuantity: number | null
  firstOrderOnly: number
  freeDelivery: number
  maxUsesPerCustomer: number | null
}

const SELECT_DISCOUNT = `
  SELECT code, type, value, min_order as "minOrder", max_uses as "maxUses", used_count as "usedCount",
         active, expires_at as "expiresAt", created_at as "createdAt", starts_at as "startsAt",
         scope, scope_id as "scopeId", min_quantity as "minQuantity", first_order_only as "firstOrderOnly",
         free_delivery as "freeDelivery", max_uses_per_customer as "maxUsesPerCustomer"
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

export interface DiscountCartItem {
  productId: string
  categoryId: string
  quantity: number
  unitPrice: number
}

// عناصر السلة اللي فعلاً داخلة في نطاق الخصم — كل السلة لو النطاق "طلب كامل" (الافتراضي
// وسلوك كل الأكواد القديمة)، أو بس أصناف فئة/منتج معيّن لو النطاق مقيّد.
export function eligibleCartItems(discount: DiscountRow, items: DiscountCartItem[]): DiscountCartItem[] {
  if (discount.scope === 'category') return items.filter(i => i.categoryId === discount.scopeId)
  if (discount.scope === 'product') return items.filter(i => i.productId === discount.scopeId)
  return items
}

export function computeEligibleSubtotal(discount: DiscountRow, items: DiscountCartItem[]): number {
  return eligibleCartItems(discount, items).reduce((sum, i) => sum + i.unitPrice * i.quantity, 0)
}

export function computeEligibleQuantity(discount: DiscountRow, items: DiscountCartItem[]): number {
  return eligibleCartItems(discount, items).reduce((sum, i) => sum + i.quantity, 0)
}

// المبلغ بيتحسب دايماً من الإجمالي الفرعي *المؤهّل* بس (سلة كاملة لو النطاق طلب كامل، أو
// جزء من السلة بس لو مقيّد بفئة/منتج) — مش إجمالي السلة كله لخصم مقيّد بالغلط.
export function computeDiscountAmount(discount: DiscountRow, eligibleSubtotal: number): number {
  const raw = discount.type === 'percentage' ? eligibleSubtotal * (discount.value / 100) : discount.value
  return Math.min(Math.round(raw * 100) / 100, eligibleSubtotal)
}

export type DiscountError =
  | 'discount_not_found' | 'discount_inactive' | 'discount_not_started' | 'discount_expired'
  | 'discount_min_order' | 'discount_min_quantity' | 'discount_max_uses'
  | 'discount_first_order_only' | 'discount_max_uses_per_customer'

export type DiscountEvaluation =
  | { ok: true, discount: DiscountRow, amount: number }
  | { ok: false, error: DiscountError, minOrder?: number, minQuantity?: number }

// منطق التحقق التزامني (بدون أي استعلام قاعدة بيانات إضافي) — بيُستخدم مع صف عادي
// (المعاينة العامة قبل الدفع) أو مع صف مُقفل بـ FOR UPDATE (أثناء إنشاء الطلب فعلياً).
// eligibleSubtotal/eligibleQuantity اختياريان ويرجعوا لنفس subtotal (نطاق طلب كامل، بلا حد
// أدنى كمية) لو الكولر لسه معندوش تفاصيل عناصر السلة — بيحافظ على سلوك كل استدعاء قديم
// بنفس المعامَلين القدامى تماماً.
export function validateDiscountAgainstSubtotal(
  discount: DiscountRow | undefined,
  subtotal: number,
  eligibleSubtotal: number = subtotal,
  eligibleQuantity: number = Infinity
): DiscountEvaluation {
  if (!discount) return { ok: false, error: 'discount_not_found' }
  if (!discount.active) return { ok: false, error: 'discount_inactive' }
  if (discount.startsAt && new Date(discount.startsAt).getTime() > Date.now()) return { ok: false, error: 'discount_not_started' }
  if (discount.expiresAt && new Date(discount.expiresAt).getTime() < Date.now()) return { ok: false, error: 'discount_expired' }
  if (discount.maxUses !== null && discount.usedCount >= discount.maxUses) return { ok: false, error: 'discount_max_uses' }
  if (subtotal < discount.minOrder) return { ok: false, error: 'discount_min_order', minOrder: discount.minOrder }
  if (discount.minQuantity !== null && eligibleQuantity < discount.minQuantity) {
    return { ok: false, error: 'discount_min_quantity', minQuantity: discount.minQuantity }
  }

  return { ok: true, discount, amount: computeDiscountAmount(discount, eligibleSubtotal) }
}

// المعاينة العامة (قبل ما العميل يسجّل بياناته وقت الدفع) — لو عناصر السلة اتبعتت، الحساب
// بيبقى دقيق حتى لخصم مقيّد بفئة/منتج؛ لو لأ (كولر قديم)، بيرجع لنفس الافتراض القديم
// (السلة كلها مؤهّلة). فحوصات "أول طلب"/"حد لكل عميل" مش ممكنة هنا أصلاً (محتاجة هوية
// العميل اللي لسه معروفة إلا وقت إنشاء الطلب الفعلي في orderService.createOrder).
export async function evaluateDiscount(code: string, subtotal: number, items: DiscountCartItem[] = []): Promise<DiscountEvaluation> {
  const discount = await findDiscount(code)
  if (!discount) return { ok: false, error: 'discount_not_found' }
  const eligibleSubtotal = items.length > 0 ? computeEligibleSubtotal(discount, items) : subtotal
  const eligibleQuantity = items.length > 0 ? computeEligibleQuantity(discount, items) : Infinity
  return validateDiscountAgainstSubtotal(discount, subtotal, eligibleSubtotal, eligibleQuantity)
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

// "أول طلب" بيتحقق بيه بموبايل العميل (مش user_id بس) — عميل زائر استخدم نفس الموبايل قبل
// كده، أو حساب مسجّل جديد بموبايل سبق واتسجّل بيه طلب زائر، الاتنين يتحسبوا "مش أول مرة".
// الطلبات الملغاة مستثناة عمداً — عميل لغى طلبه الوحيد لسه يستاهل يتعامل كـ "عميل جديد".
export async function checkFirstOrderEligibility(client: PoolClient, userId: string | null, mobile: string): Promise<boolean> {
  const { rows } = await client.query<{ n: string }>(
    `SELECT COUNT(*) as n FROM orders WHERE status != 'cancelled' AND (customer_mobile = $1 OR ($2::text IS NOT NULL AND user_id = $2))`,
    [mobile, userId]
  )
  return Number(rows[0].n) === 0
}

// عدد مرات استخدام كود الخصم ده فعلياً بواسطة نفس العميل (بنفس هوية "أول طلب" أعلاه) —
// أساس حد "لكل عميل"، منفصل تماماً عن max_uses الإجمالي (discounts.used_count).
export async function countDiscountUsagesForCustomer(client: PoolClient, code: string, userId: string | null, mobile: string): Promise<number> {
  const { rows } = await client.query<{ n: string }>(
    `SELECT COUNT(*) as n FROM discount_usages WHERE discount_code = $1 AND (customer_mobile = $2 OR ($3::text IS NOT NULL AND user_id = $3))`,
    [code.trim().toUpperCase(), mobile, userId]
  )
  return Number(rows[0].n)
}

export async function recordDiscountUsage(client: PoolClient, code: string, orderId: string, userId: string | null, mobile: string): Promise<void> {
  await client.query(
    `INSERT INTO discount_usages (discount_code, order_id, user_id, customer_mobile, created_at) VALUES ($1,$2,$3,$4,now())`,
    [code.trim().toUpperCase(), orderId, userId, mobile]
  )
}
