import type { PoolClient } from 'pg'
import { pool } from '../db.js'
import { toPiastres, toEgp } from './pricingService.js'

export type PromotionType = 'buy_x_get_y' | 'bundle_fixed_price'

export interface PromotionRow {
  id: string
  name: string
  type: PromotionType
  active: number
  startsAt: string | null
  expiresAt: string | null
  priority: number
  maxApplicationsPerOrder: number | null
  triggerProductId: string | null
  triggerCategoryId: string | null
  buyQuantity: number | null
  getQuantity: number | null
  getDiscountPercent: number | null
  rewardProductId: string | null
  rewardCategoryId: string | null
  bundlePrice: number | null
  createdAt: string
  createdBy: string | null
}

export interface PromotionBundleItemRow {
  id: number
  promotionId: string
  productId: string | null
  categoryId: string | null
  requiredQuantity: number
}

export const SELECT_PROMOTION = `
  SELECT id, name, type, active, starts_at as "startsAt", expires_at as "expiresAt", priority,
         max_applications_per_order as "maxApplicationsPerOrder",
         trigger_product_id as "triggerProductId", trigger_category_id as "triggerCategoryId",
         buy_quantity as "buyQuantity", get_quantity as "getQuantity", get_discount_percent as "getDiscountPercent",
         reward_product_id as "rewardProductId", reward_category_id as "rewardCategoryId",
         bundle_price as "bundlePrice", created_at as "createdAt", created_by as "createdBy"
  FROM promotions
`

export async function listBundleItems(promotionIds: string[]): Promise<Map<string, PromotionBundleItemRow[]>> {
  const byPromotion = new Map<string, PromotionBundleItemRow[]>()
  if (promotionIds.length === 0) return byPromotion
  const { rows } = await pool.query<PromotionBundleItemRow>(
    `SELECT id, promotion_id as "promotionId", product_id as "productId", category_id as "categoryId",
            required_quantity as "requiredQuantity"
     FROM promotion_bundle_items WHERE promotion_id = ANY($1) ORDER BY id ASC`,
    [promotionIds]
  )
  for (const row of rows) {
    if (!byPromotion.has(row.promotionId)) byPromotion.set(row.promotionId, [])
    byPromotion.get(row.promotionId)!.push(row)
  }
  return byPromotion
}

export interface ActivePromotion {
  promotion: PromotionRow
  bundleItems: PromotionBundleItemRow[]
}

// العروض النشطة فعلياً دلوقتي (تاريخياً) — بترتيب حتمي ثابت (priority تنازلياً، بعدين وقت
// الإنشاء تصاعدياً، بعدين المعرّف نفسه كفاصل تعادل أخير) عشان نفس السلة تدّي دايماً نفس
// النتيجة بالظبط بغض النظر عن ترتيب رجوع الصفوف من القاعدة.
export async function listActivePromotions(): Promise<ActivePromotion[]> {
  const { rows } = await pool.query<PromotionRow>(
    `${SELECT_PROMOTION}
     WHERE active = 1 AND (starts_at IS NULL OR starts_at <= CURRENT_DATE) AND (expires_at IS NULL OR expires_at >= CURRENT_DATE)
     ORDER BY priority DESC, created_at ASC, id ASC`
  )
  const bundleItemsByPromotion = await listBundleItems(rows.filter(r => r.type === 'bundle_fixed_price').map(r => r.id))
  return rows.map(promotion => ({ promotion, bundleItems: bundleItemsByPromotion.get(promotion.id) ?? [] }))
}

export interface PromotionCartItem {
  productId: string
  categoryId: string
  quantity: number
  unitPrice: number
}

interface WorkingLine {
  productId: string
  categoryId: string
  unitPrice: number
  remaining: number
}

export interface PromotionApplicationResult {
  promotionId: string
  name: string
  type: PromotionType
  applicationsCount: number
  discountAmount: number
}

export interface PromotionComputationResult {
  applications: PromotionApplicationResult[]
  totalDiscount: number
}

function matchesGroup(line: WorkingLine, productId: string | null, categoryId: string | null): boolean {
  if (productId) return line.productId === productId
  if (categoryId) return line.categoryId === categoryId
  return false
}

// أرخص الوحدات المتاحة أولاً، وبعدها معرّف المنتج كفاصل تعادل حتمي — نفس ترتيب الاختيار
// دايماً بغض النظر عن ترتيب دخول الأصناف للسلة.
function sortCheapestFirst(lines: WorkingLine[]): WorkingLine[] {
  return [...lines].sort((a, b) => a.unitPrice - b.unitPrice || a.productId.localeCompare(b.productId))
}

// بتسحب أرخص `count` وحدة من المجموعة المرتبة (بيتفرض إنها sortCheapestFirst بالفعل)،
// وبترجع إجمالي سعرها الطبيعي بالقرش الصحيح + بتنقص remaining كل سطر مباشرة (mutation
// مقصودة — دي نسخة عمل داخلية بس، مش صفوف قاعدة بيانات فعلية).
function consumeCheapest(sortedLines: WorkingLine[], count: number): number {
  let remainingToTake = count
  let totalPiastres = 0
  for (const line of sortedLines) {
    if (remainingToTake <= 0) break
    const take = Math.min(line.remaining, remainingToTake)
    if (take <= 0) continue
    totalPiastres += toPiastres(line.unitPrice) * take
    line.remaining -= take
    remainingToTake -= take
  }
  return totalPiastres
}

function totalAvailable(lines: WorkingLine[]): number {
  return lines.reduce((sum, l) => sum + l.remaining, 0)
}

function computeBuyXGetY(promotion: PromotionRow, lines: WorkingLine[]): PromotionApplicationResult | null {
  const triggerLines = lines.filter(l => matchesGroup(l, promotion.triggerProductId, promotion.triggerCategoryId))
  const sameGroup = !promotion.rewardProductId && !promotion.rewardCategoryId
  const rewardLines = sameGroup
    ? triggerLines
    : lines.filter(l => matchesGroup(l, promotion.rewardProductId, promotion.rewardCategoryId))

  const buyQuantity = promotion.buyQuantity!
  const getQuantity = promotion.getQuantity!
  const availableTrigger = totalAvailable(triggerLines)
  const availableReward = totalAvailable(rewardLines)

  let applications: number
  if (sameGroup) {
    // نفس المجموعة: كل تطبيق محتاج (buy + get) وحدة مجتمعة من نفس المجموعة.
    applications = Math.floor(availableTrigger / (buyQuantity + getQuantity))
  } else {
    applications = Math.min(Math.floor(availableTrigger / buyQuantity), Math.floor(availableReward / getQuantity))
  }
  if (promotion.maxApplicationsPerOrder !== null) applications = Math.min(applications, promotion.maxApplicationsPerOrder)
  if (applications <= 0) return null

  let discountPiastres = 0
  if (sameGroup) {
    const sorted = sortCheapestFirst(triggerLines)
    for (let i = 0; i < applications; i++) {
      // بنسحب جزء "الهدية" الأرخص الأول من نفس المجموعة المرتبة تصاعدياً، وبعدين جزء "الشراء"
      // المدفوع من الباقي (الأغلى نسبياً) — ده أكتر تفسير عادل ومتوقع لعرض "اشترِ X واحصل
      // على Y" لما يكون المُحفِّز فئة كاملة: أرخص صنف موجود فعلاً هو اللي بيتخصم دايماً.
      discountPiastres += consumeCheapest(sorted, getQuantity)
      consumeCheapest(sorted, buyQuantity)
    }
  } else {
    const sortedTrigger = sortCheapestFirst(triggerLines)
    const sortedReward = sortCheapestFirst(rewardLines)
    consumeCheapest(sortedTrigger, buyQuantity * applications)
    discountPiastres += consumeCheapest(sortedReward, getQuantity * applications)
  }

  const discountAmount = toEgp(Math.round(discountPiastres * (promotion.getDiscountPercent! / 100)))
  if (discountAmount <= 0) return null
  return { promotionId: promotion.id, name: promotion.name, type: promotion.type, applicationsCount: applications, discountAmount }
}

function computeBundle(promotion: PromotionRow, bundleItems: PromotionBundleItemRow[], lines: WorkingLine[]): PromotionApplicationResult | null {
  if (bundleItems.length === 0) return null
  const groupLines = bundleItems.map(item => sortCheapestFirst(lines.filter(l => matchesGroup(l, item.productId, item.categoryId))))

  let applications = Infinity
  for (let i = 0; i < bundleItems.length; i++) {
    const available = totalAvailable(groupLines[i])
    applications = Math.min(applications, Math.floor(available / bundleItems[i].requiredQuantity))
  }
  if (promotion.maxApplicationsPerOrder !== null) applications = Math.min(applications, promotion.maxApplicationsPerOrder)
  if (!Number.isFinite(applications) || applications <= 0) return null

  let discountPiastres = 0
  for (let app = 0; app < applications; app++) {
    let naturalPiastres = 0
    for (let i = 0; i < bundleItems.length; i++) {
      naturalPiastres += consumeCheapest(groupLines[i], bundleItems[i].requiredQuantity)
    }
    const bundlePriastres = toPiastres(promotion.bundlePrice!)
    discountPiastres += Math.max(0, naturalPiastres - bundlePriastres)
  }

  const discountAmount = toEgp(discountPiastres)
  if (discountAmount <= 0) return null
  return { promotionId: promotion.id, name: promotion.name, type: promotion.type, applicationsCount: applications, discountAmount }
}

// الدالة الأساسية — بتاخد سلة حقيقية وقائمة عروض نشطة، وبترجع كل التطبيقات الفعلية +
// إجمالي الخصم. بتُستخدم في المعاينة (قبل الدفع) وفي orderService.createOrder (مصدر الحقيقة
// الوحيد وقت إنشاء الطلب الفعلي — نفس مبدأ باقي محرك التسعير كله في المشروع).
export function computePromotionApplications(cartItems: PromotionCartItem[], activePromotions: ActivePromotion[]): PromotionComputationResult {
  const lines: WorkingLine[] = cartItems.map(i => ({ productId: i.productId, categoryId: i.categoryId, unitPrice: i.unitPrice, remaining: i.quantity }))

  const applications: PromotionApplicationResult[] = []
  for (const { promotion, bundleItems } of activePromotions) {
    const result = promotion.type === 'buy_x_get_y'
      ? computeBuyXGetY(promotion, lines)
      : computeBundle(promotion, bundleItems, lines)
    if (result) applications.push(result)
  }

  const totalDiscount = toEgp(applications.reduce((sum, a) => sum + toPiastres(a.discountAmount), 0))
  return { applications, totalDiscount }
}

export async function computePromotionsForCart(cartItems: PromotionCartItem[]): Promise<PromotionComputationResult> {
  const activePromotions = await listActivePromotions()
  return computePromotionApplications(cartItems, activePromotions)
}

export async function recordPromotionApplications(client: PoolClient, orderId: string, applications: PromotionApplicationResult[]): Promise<void> {
  for (const app of applications) {
    await client.query(
      `INSERT INTO order_promotion_applications (order_id, promotion_id, promotion_name, promotion_type, applications_count, discount_amount)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [orderId, app.promotionId, app.name, app.type, app.applicationsCount, app.discountAmount]
    )
  }
}

export async function listPromotionApplicationsForOrder(orderId: string): Promise<PromotionApplicationResult[]> {
  const { rows } = await pool.query<{ promotionId: string, name: string, type: PromotionType, applicationsCount: number, discountAmount: number }>(
    `SELECT promotion_id as "promotionId", promotion_name as "name", promotion_type as "type",
            applications_count as "applicationsCount", discount_amount as "discountAmount"
     FROM order_promotion_applications WHERE order_id = $1 ORDER BY id ASC`,
    [orderId]
  )
  return rows
}
