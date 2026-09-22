import crypto from 'node:crypto'
import type { PoolClient } from 'pg'
import { pool, withTransaction } from '../db.js'
import type { CheckoutInput, SubstitutionPreference } from '../checkoutValidation.js'
import { computeSubtotal, computeLineTotal, calculateDeliveryFee, computeTotal } from './pricingService.js'
import {
  findDiscountForUpdate, validateDiscountAgainstSubtotal, incrementDiscountUsageAtomic,
  computeEligibleSubtotal, computeEligibleQuantity, checkFirstOrderEligibility,
  countDiscountUsagesForCustomer, recordDiscountUsage, type DiscountCartItem
} from '../discounts.js'
import {
  lockProductsForOrder, validateItemAgainstProduct, deductStockForOrder,
  restoreStockForCancelledOrder
} from './inventoryService.js'
import { lockVariantForOrder, deductVariantStock, type LockedVariant } from './productVariantService.js'
import { fetchItemsForOrders, type OrderItemDTO } from '../orderItems.js'
import { canTransitionOrderStatus, type OrderStatus } from '../orderStatus.js'
import { getActiveDeliveryZoneFee, isActiveDeliverySlot, checkDeliverySlotCapacityForDate, isDeliveryDateOpen } from './deliveryService.js'
import { recordOrderStatusChange, listOrderStatusHistory, type OrderStatusHistoryEntry } from './orderStatusHistoryService.js'
import { lockAndValidateLoyaltyRedemption, commitLoyaltyRedemption, restoreRedeemedPointsForOrder, reverseEarnedPointsForOrder } from './loyaltyService.js'
import { listActivePromotions, computePromotionApplications, recordPromotionApplications, listPromotionApplicationsForOrder, type PromotionApplicationResult } from './promotionService.js'
import { sendOrderConfirmationWhatsApp } from './whatsappService.js'
import { logEvent, logWarn } from '../logger.js'

export class OrderError extends Error {
  status: number
  code: string
  details?: Record<string, unknown>
  constructor(status: number, code: string, details?: Record<string, unknown>) {
    super(code)
    this.status = status
    this.code = code
    this.details = details
  }
}

class IdempotencyRaceError extends Error {}

interface OrderRow {
  id: string
  orderNumber: string
  createdAt: string
  deliverySlot: string
  deliveryDate: string | null
  paymentMethod: string
  customerFullName: string
  customerMobile: string
  customerGovernorate: string
  customerAddress: string
  subtotal: number
  deliveryFee: number
  total: number
  status: string
  discountCode: string | null
  discountAmount: number
  promotionDiscountAmount: number
  loyaltyPointsRedeemed: number
  loyaltyDiscountAmount: number
  requestFingerprint: string | null
  guestTrackingToken: string | null
  deliveryInstructions: string
  substitutionPreference: string
}

export interface SerializedOrder {
  id: string
  orderNumber: string
  createdAt: string
  deliverySlot: string
  deliveryDate?: string
  paymentMethod: string
  customer: { fullName: string, mobile: string, governorate: string, address: string }
  items: OrderItemDTO[]
  subtotal: number
  deliveryFee: number
  total: number
  status: string
  discountCode?: string
  discountAmount: number
  promotionDiscountAmount: number
  // زي statusHistory تماماً — بس في المسارات اللي بتعرض تفاصيل الطلب الكاملة (serializeOrderRow)،
  // مش في قائمة الطلبات العادية (listOrdersForUser) عشان ما تحتاجش استعلام إضافي لكل صف.
  promotionApplications?: PromotionApplicationResult[]
  loyaltyPointsRedeemed: number
  loyaltyDiscountAmount: number
  // بيتحدد بس لو الطلب من غير تسجيل دخول (guest) — العميل المسجّل بيستخدم ownership العادي
  // بدل التوكن ده. راجع getOrderByNumberForGuestToken.
  guestTrackingToken?: string
  // بيتحدد بس في مسارات التتبع (getOrderByNumberForUser/getOrderByNumberForGuestToken) —
  // مش في كل استدعاء لـ serializeOrderRow، عشان قائمة الطلبات العادية ما تحتاجش التاريخ الكامل.
  statusHistory?: OrderStatusHistoryEntry[]
  deliveryInstructions?: string
  substitutionPreference: SubstitutionPreference
}

const SELECT_ORDER_FIELDS = `
  id, order_number as "orderNumber", created_at as "createdAt", delivery_slot as "deliverySlot", delivery_date as "deliveryDate", payment_method as "paymentMethod",
  customer_full_name as "customerFullName", customer_mobile as "customerMobile", customer_governorate as "customerGovernorate", customer_address as "customerAddress",
  subtotal, delivery_fee as "deliveryFee", total, status, discount_code as "discountCode", discount_amount as "discountAmount",
  promotion_discount_amount as "promotionDiscountAmount",
  loyalty_points_redeemed as "loyaltyPointsRedeemed", loyalty_discount_amount as "loyaltyDiscountAmount",
  request_fingerprint as "requestFingerprint", guest_tracking_token as "guestTrackingToken", delivery_instructions as "deliveryInstructions",
  substitution_preference as "substitutionPreference"
`

async function serializeOrderRow(row: OrderRow): Promise<SerializedOrder> {
  const itemsByOrder = await fetchItemsForOrders([row.id])
  const promotionApplications = row.promotionDiscountAmount > 0 ? await listPromotionApplicationsForOrder(row.id) : []
  return {
    id: row.id,
    orderNumber: row.orderNumber,
    createdAt: row.createdAt,
    deliverySlot: row.deliverySlot,
    deliveryDate: row.deliveryDate ?? undefined,
    paymentMethod: row.paymentMethod,
    customer: {
      fullName: row.customerFullName,
      mobile: row.customerMobile,
      governorate: row.customerGovernorate,
      address: row.customerAddress
    },
    items: itemsByOrder.get(row.id) ?? [],
    subtotal: row.subtotal,
    deliveryFee: row.deliveryFee,
    total: row.total,
    status: row.status,
    discountCode: row.discountCode ?? undefined,
    discountAmount: row.discountAmount,
    promotionDiscountAmount: row.promotionDiscountAmount,
    promotionApplications,
    loyaltyPointsRedeemed: row.loyaltyPointsRedeemed,
    loyaltyDiscountAmount: row.loyaltyDiscountAmount,
    guestTrackingToken: row.guestTrackingToken ?? undefined,
    deliveryInstructions: row.deliveryInstructions || undefined,
    substitutionPreference: row.substitutionPreference as SubstitutionPreference
  }
}

function computeFingerprint(userId: string | null, input: CheckoutInput): string {
  const normalized = JSON.stringify({
    userId,
    deliverySlot: input.deliverySlot,
    deliveryDate: input.deliveryDate,
    customer: input.customer,
    items: [...input.items].sort((a, b) => a.productId.localeCompare(b.productId)),
    discountCode: input.discountCode ?? null,
    loyaltyPointsRedeemed: input.loyaltyPointsRedeemed ?? 0
  })
  return crypto.createHash('sha256').update(normalized).digest('hex')
}

function isUniqueViolation(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { code?: string }).code === '23505'
}

async function findOrderByIdempotencyKey(idempotencyKey: string): Promise<OrderRow | undefined> {
  const { rows } = await pool.query<OrderRow>(`SELECT ${SELECT_ORDER_FIELDS} FROM orders WHERE idempotency_key = $1`, [idempotencyKey])
  return rows[0]
}

async function loadStoreSettingsForUpdate(client: PoolClient) {
  const { rows } = await client.query<{ minimumOrder: number, freeShippingThreshold: number, deliveryFee: number, codEnabled: number }>(`
    SELECT minimum_order as "minimumOrder", free_shipping_threshold as "freeShippingThreshold",
           delivery_fee as "deliveryFee", cod_enabled as "codEnabled"
    FROM store_settings WHERE id = 1
  `)
  const row = rows[0]
  return { minimumOrder: row.minimumOrder, freeShippingThreshold: row.freeShippingThreshold, deliveryFee: row.deliveryFee, codEnabled: !!row.codEnabled }
}

async function nextOrderNumber(client: PoolClient): Promise<string> {
  const { rows } = await client.query<{ n: string }>(`SELECT nextval('order_number_seq') as n`)
  return `ALA-${rows[0].n}`
}

export interface CreateOrderResult {
  order: SerializedOrder
  replay: boolean
}

// راجع migrations/... وdiscounts.ts/inventoryService.ts للتفاصيل. ترتيب العملية جوه المعاملة:
// إعدادات المتجر -> قفل الخصم (لو فيه) -> قفل المنتجات (بترتيب ثابت) -> تحقق كل صنف ->
// حساب الإجمالي الفرعي -> تحقق الحد الأدنى -> تحقق/حساب الخصم -> حساب التوصيل والإجمالي ->
// إدراج الطلب وعناصره -> خصم المخزون + تسجيل حركة 'sale' -> زيادة عداد استخدام الخصم ذرّياً.
export async function createOrder(input: CheckoutInput, userId: string | null, idempotencyKey: string | null): Promise<CreateOrderResult> {
  if (idempotencyKey) {
    const existing = await findOrderByIdempotencyKey(idempotencyKey)
    if (existing) {
      const fingerprint = computeFingerprint(userId, input)
      if (existing.requestFingerprint && existing.requestFingerprint !== fingerprint) {
        throw new OrderError(409, 'idempotency_conflict')
      }
      logEvent('order_replayed_idempotency', { orderId: existing.id, orderNumber: existing.orderNumber })
      return { order: await serializeOrderRow(existing), replay: true }
    }
  }

  const fingerprint = idempotencyKey ? computeFingerprint(userId, input) : null

  try {
    const orderId = await withTransaction(async client => {
      const settings = await loadStoreSettingsForUpdate(client)
      if (!settings.codEnabled) throw new OrderError(400, 'cod_disabled')

      // المحافظة والميعاد لازم يكونوا فعلاً موجودين ومفعّلين دلوقتي — مش مجرد نص غير فاضي
      // (اللي validateCheckoutInput بيتحقق منه بس كشكل). ده بيمنع طلب برسوم توصيل افتراضية
      // غلط لمحافظة مش متاحة، أو ميعاد اتشال/اتعطل من لوحة التحكم.
      const zoneDeliveryFee = await getActiveDeliveryZoneFee(client, input.customer.governorate)
      if (zoneDeliveryFee === null) throw new OrderError(400, 'delivery_zone_unavailable')
      logEvent('delivery_zone_selected', { governorate: input.customer.governorate, deliveryFee: zoneDeliveryFee })
      if (!(await isActiveDeliverySlot(client, input.deliverySlot))) throw new OrderError(400, 'invalid_delivery_slot')
      // تاريخ التوصيل: لازم يكون فعلاً يوم مفتوح للتوصيل (مش يوم أسبوع مقفول افتراضياً ولا
      // معطّل بتاريخه بالذات من الأدمن) وليه سعة متاحة لنفس الميعاد في نفس التاريخ ده تحديداً —
      // مش سعة "النهاردة" العامة زي التصميم القديم.
      if (!(await isDeliveryDateOpen(client, input.deliveryDate))) throw new OrderError(400, 'delivery_date_unavailable')
      if (!(await checkDeliverySlotCapacityForDate(client, input.deliverySlot, input.deliveryDate))) throw new OrderError(409, 'delivery_slot_full')

      const discount = input.discountCode ? await findDiscountForUpdate(client, input.discountCode) : undefined

      // المنتجات الأب دايماً بتتقفل (لازمة للفئة categoryId ولتأكيد إن المنتج نفسه لسه
      // موجود)، حتى لو الصنف بيشاور لمتغير — سعر/توفر/مخزون الصنف في الحالة دي بييجي من
      // المتغير نفسه، مش من المنتج الأب.
      const productIds = input.items.map(i => i.productId)
      const products = await lockProductsForOrder(client, productIds)

      const variantIds = input.items.map(i => i.variantId).filter((id): id is string => !!id)
      const variants = new Map<string, LockedVariant>()
      for (const variantId of new Set(variantIds)) {
        const variant = await lockVariantForOrder(client, variantId)
        if (variant) variants.set(variantId, variant)
      }

      for (const item of input.items) {
        if (item.variantId) {
          const variant = variants.get(item.variantId)
          if (variant && variant.productId !== item.productId) {
            throw new OrderError(400, 'invalid_items', { productId: item.productId })
          }
          const error = validateItemAgainstProduct(item.productId, item.quantity, variant)
          if (error) {
            if (error.code === 'insufficient_stock') {
              logWarn('stock_insufficient', { productId: error.productId, variantId: item.variantId, available: error.available, requested: error.requested })
            }
            throw new OrderError(error.code === 'insufficient_stock' ? 409 : 400, error.code, {
              productId: error.productId,
              ...(error.available !== undefined ? { available: error.available } : {}),
              ...(error.requested !== undefined ? { requested: error.requested } : {})
            })
          }
          continue
        }
        const error = validateItemAgainstProduct(item.productId, item.quantity, products.get(item.productId))
        if (error) {
          if (error.code === 'insufficient_stock') {
            logWarn('stock_insufficient', { productId: error.productId, available: error.available, requested: error.requested })
          }
          throw new OrderError(error.code === 'insufficient_stock' ? 409 : 400, error.code, {
            productId: error.productId,
            ...(error.available !== undefined ? { available: error.available } : {}),
            ...(error.requested !== undefined ? { requested: error.requested } : {})
          })
        }
      }

      const lineItems = input.items.map(item => {
        const product = products.get(item.productId)!
        const variant = item.variantId ? variants.get(item.variantId) : undefined
        return {
          productId: item.productId,
          variantId: item.variantId ?? null,
          variantName: variant?.name ?? null,
          categoryId: product.categoryId,
          name: variant ? `${product.name} - ${variant.name}` : product.name,
          unit: product.unit,
          unitPrice: variant ? variant.price : product.price,
          quantity: item.quantity,
          lineTotal: computeLineTotal(variant ? variant.price : product.price, item.quantity)
        }
      })

      const subtotal = computeSubtotal(lineItems)

      if (subtotal < settings.minimumOrder) {
        throw new OrderError(400, 'minimum_order_not_met', { minimumOrder: settings.minimumOrder, currentAmount: subtotal })
      }

      let discountAmount = 0
      let appliedDiscountCode: string | null = null
      let discountGrantsFreeDelivery = false
      if (input.discountCode) {
        const cartItems: DiscountCartItem[] = lineItems.map(li => ({
          productId: li.productId, categoryId: li.categoryId, quantity: li.quantity, unitPrice: li.unitPrice
        }))
        const eligibleSubtotal = discount ? computeEligibleSubtotal(discount, cartItems) : subtotal
        const eligibleQuantity = discount ? computeEligibleQuantity(discount, cartItems) : Infinity
        const evaluation = validateDiscountAgainstSubtotal(discount, subtotal, eligibleSubtotal, eligibleQuantity)
        if (!evaluation.ok) {
          logWarn('discount_rejected', { discountCode: input.discountCode, errorCode: evaluation.error })
          throw new OrderError(400, evaluation.error, {
            ...(evaluation.minOrder !== undefined ? { minOrder: evaluation.minOrder } : {}),
            ...(evaluation.minQuantity !== undefined ? { minQuantity: evaluation.minQuantity } : {})
          })
        }

        // "أول طلب" وحد "لكل عميل" محتاجين هوية العميل الفعلية (موبايل/حساب) اللي مش
        // متاحة وقت المعاينة العامة قبل الدفع — بيتحققوا هنا بس، وقت إنشاء الطلب الفعلي.
        if (evaluation.discount.firstOrderOnly && !(await checkFirstOrderEligibility(client, userId, input.customer.mobile))) {
          logWarn('discount_rejected', { discountCode: input.discountCode, errorCode: 'discount_first_order_only' })
          throw new OrderError(400, 'discount_first_order_only')
        }
        if (evaluation.discount.maxUsesPerCustomer !== null) {
          const usedByCustomer = await countDiscountUsagesForCustomer(client, evaluation.discount.code, userId, input.customer.mobile)
          if (usedByCustomer >= evaluation.discount.maxUsesPerCustomer) {
            logWarn('discount_rejected', { discountCode: input.discountCode, errorCode: 'discount_max_uses_per_customer' })
            throw new OrderError(400, 'discount_max_uses_per_customer')
          }
        }

        discountAmount = evaluation.amount
        appliedDiscountCode = evaluation.discount.code
        discountGrantsFreeDelivery = !!evaluation.discount.freeDelivery
        logEvent('discount_applied', { discountCode: appliedDiscountCode, discountAmount, freeDelivery: discountGrantsFreeDelivery })
      }

      // عروض BOGO/الباقات التلقائية — بتتحسب من محتوى السلة الفعلي نفسه (مش من كود بيكتبه
      // العميل)، فمستقلة تماماً عن كود الخصم فوق ومش بتتأثر بنطاقه (scope). لازم تتحسب هنا
      // (مصدر الحقيقة الوحيد وقت إنشاء الطلب الفعلي)، مش بس تتقرأ من قيمة جاية من الفرونت
      // إند، عشان العميل ميقدرش يزوّر مبلغ الخصم.
      const promotionCartItems = lineItems.map(li => ({
        productId: li.productId, categoryId: li.categoryId, quantity: li.quantity, unitPrice: li.unitPrice
      }))
      const activePromotions = await listActivePromotions()
      const promotionResult = computePromotionApplications(promotionCartItems, activePromotions)
      const promotionDiscountAmount = promotionResult.totalDiscount

      // استخدام نقاط الولاء (لو مطلوب) — لازم يتحقق منه هنا، بعد ما خصم الكوبون وخصم العروض
      // اتحددوا وقبل ما رسوم التوصيل تتحسب، بالظبط زي ترتيب الحساب المطلوب: الإجمالي الفرعي
      // -> الخصم -> العروض -> الولاء -> التوصيل -> الإجمالي النهائي. القفل والتحقق بيحصلوا هنا
      // جوه نفس المعاملة — لو اتنين طلبوا نفس اللحظة يستخدموا كل رصيد العميل، التاني هيلاقي
      // القفل مستني ويرفض برصيد محدّث فعلياً، مش نسخة قديمة (راجع lockAndValidateLoyaltyRedemption).
      const requestedLoyaltyPoints = input.loyaltyPointsRedeemed ?? 0
      const eligibleSubtotalForLoyalty = Math.max(0, subtotal - discountAmount - promotionDiscountAmount)
      const redemption = await lockAndValidateLoyaltyRedemption(client, userId, requestedLoyaltyPoints, eligibleSubtotalForLoyalty)
      if (!redemption.ok) {
        logWarn('loyalty_redemption_rejected', { errorCode: redemption.error, requestedLoyaltyPoints })
        throw new OrderError(redemption.error === 'loyalty_balance_changed' ? 409 : 400, redemption.error, redemption.details)
      }
      const loyaltyDiscountAmount = redemption.discountAmount

      const deliveryFee = discountGrantsFreeDelivery
        ? 0
        : calculateDeliveryFee(subtotal, { freeShippingThreshold: settings.freeShippingThreshold, deliveryFee: zoneDeliveryFee })
      const total = computeTotal(subtotal, discountAmount, deliveryFee, loyaltyDiscountAmount, promotionDiscountAmount)

      const id = crypto.randomUUID()
      const orderNumber = await nextOrderNumber(client)
      const createdAt = new Date().toISOString()
      // توكن تتبّع عشوائي عالي الإنتروبيا (192 بت) — بيتولّد بس لطلبات الزوار (من غير تسجيل
      // دخول)، وهو الطريقة الوحيدة الآمنة لفتح رابط تتبع الطلب ده تاني بعد الصفحة الأولى.
      const guestTrackingToken = userId ? null : crypto.randomBytes(24).toString('base64url')

      try {
        await client.query(
          `INSERT INTO orders (
             id, order_number, user_id, created_at, delivery_slot, delivery_date, payment_method,
             customer_full_name, customer_mobile, customer_governorate, customer_address,
             subtotal, delivery_fee, total, status, discount_code, discount_amount, promotion_discount_amount,
             loyalty_points_redeemed, loyalty_discount_amount,
             idempotency_key, request_fingerprint, guest_tracking_token, delivery_instructions, substitution_preference
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'placed',$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)`,
          [
            id, orderNumber, userId, createdAt, input.deliverySlot, input.deliveryDate, input.paymentMethod,
            input.customer.fullName, input.customer.mobile, input.customer.governorate, input.customer.address,
            subtotal, deliveryFee, total, appliedDiscountCode, discountAmount, promotionDiscountAmount,
            redemption.pointsToRedeem, loyaltyDiscountAmount,
            idempotencyKey, fingerprint, guestTrackingToken, input.deliveryInstructions ?? '', input.substitutionPreference
          ]
        )
      } catch (err) {
        if (isUniqueViolation(err)) throw new IdempotencyRaceError()
        throw err
      }

      for (const item of lineItems) {
        await client.query(
          `INSERT INTO order_items (order_id, product_id, name, unit, unit_price, quantity, line_total, variant_id, variant_name)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [id, item.productId, item.name, item.unit, item.unitPrice, item.quantity, item.lineTotal, item.variantId, item.variantName]
        )
      }

      if (promotionResult.applications.length > 0) await recordPromotionApplications(client, id, promotionResult.applications)

      await recordOrderStatusChange(client, { orderId: id, fromStatus: null, toStatus: 'placed', source: 'system' })

      for (const item of input.items) {
        if (item.variantId) {
          const variant = variants.get(item.variantId)!
          await deductVariantStock(client, variant, item.quantity, id)
          logEvent('stock_deducted', { orderId: id, productId: item.productId, variantId: item.variantId, quantity: item.quantity })
          continue
        }
        await deductStockForOrder(client, item.productId, item.quantity, id)
        logEvent('stock_deducted', { orderId: id, productId: item.productId, quantity: item.quantity })
      }

      if (appliedDiscountCode) {
        const incremented = await incrementDiscountUsageAtomic(client, appliedDiscountCode)
        if (!incremented) throw new OrderError(409, 'discount_max_uses')
        await recordDiscountUsage(client, appliedDiscountCode, id, userId, input.customer.mobile)
      }

      // آخر خطوة قبل الـ commit: تسجيل حركة استخدام النقاط السالبة + استهلاك الدفعات المقفولة
      // من التحقق فوق. لو أي حاجة فوق فشلت (مخزون، خصم...) الطلب كله بيترجع، فمفيش نقاط
      // اتخصمت من غير طلب فعلاً اتعمل.
      if (userId && redemption.pointsToRedeem > 0) {
        await commitLoyaltyRedemption(client, userId, id, redemption.pointsToRedeem)
      }

      return id
    })

    const { rows } = await pool.query<OrderRow>(`SELECT ${SELECT_ORDER_FIELDS} FROM orders WHERE id = $1`, [orderId])
    const order = await serializeOrderRow(rows[0])
    logEvent('order_created', { orderId: order.id, orderNumber: order.orderNumber, itemCount: order.items.length, total: order.total })

    // بعد الـ commit الفعلي بس (الطلب اتقرأ تاني من قاعدة البيانات فوق) — فشل واتساب هنا
    // (عدم إعداد، خطأ مزوّد، قالب مفقود) أبداً ما بيأثر على نجاح الطلب، لأن الدالة دي
    // مصمّمة عمداً عشان ما ترميش استثناء (راجع تعليقها في whatsappService.ts).
    await sendOrderConfirmationWhatsApp({
      orderId: order.id,
      orderNumber: order.orderNumber,
      customerName: order.customer.fullName,
      customerMobile: order.customer.mobile,
      customerAddress: `${order.customer.governorate} - ${order.customer.address}`,
      paymentMethod: order.paymentMethod,
      total: order.total,
      deliveryDate: order.deliveryDate ?? null,
      deliverySlotId: order.deliverySlot,
      guestTrackingToken: order.guestTrackingToken ?? null
    })
    return { order, replay: false }
  } catch (err) {
    if (err instanceof IdempotencyRaceError && idempotencyKey) {
      const existing = await findOrderByIdempotencyKey(idempotencyKey)
      if (existing) {
        logEvent('order_replayed_idempotency', { orderId: existing.id, orderNumber: existing.orderNumber })
        return { order: await serializeOrderRow(existing), replay: true }
      }
    }
    logWarn('order_failed', {
      errorCode: err instanceof OrderError ? err.code : 'unexpected_error',
      ...(err instanceof OrderError && err.details?.productId ? { productId: err.details.productId } : {})
    })
    throw err
  }
}

export async function getOrderByNumberForUser(orderNumber: string, userId: string): Promise<SerializedOrder | null> {
  const { rows } = await pool.query<OrderRow>(
    `SELECT ${SELECT_ORDER_FIELDS} FROM orders WHERE order_number = $1 AND user_id = $2`,
    [orderNumber, userId]
  )
  if (!rows[0]) return null
  const order = await serializeOrderRow(rows[0])
  order.statusHistory = await listOrderStatusHistory(order.id)
  return order
}

// تتبّع طلب زائر آمن: رقم الطلب لوحده مش كفاية أبداً — لازم التوكن الصحيح يتطابق حرفياً
// (مقارنة بزمن ثابت تمنع timing attack). طلب مرتبط بحساب (user_id مش NULL) ما بيترجعش من
// هنا خالص حتى لو حد لقط توكن قديم بطريقة ما — بيفضل يعتمد بس على تسجيل الدخول والملكية.
export async function getOrderByNumberForGuestToken(orderNumber: string, token: string): Promise<SerializedOrder | null> {
  if (!token) return null
  const { rows } = await pool.query<OrderRow>(
    `SELECT ${SELECT_ORDER_FIELDS} FROM orders WHERE order_number = $1 AND user_id IS NULL AND guest_tracking_token IS NOT NULL`,
    [orderNumber]
  )
  const row = rows[0]
  if (!row || !row.guestTrackingToken) return null

  const expected = Buffer.from(row.guestTrackingToken)
  const provided = Buffer.from(token)
  if (expected.length !== provided.length || !crypto.timingSafeEqual(expected, provided)) return null

  const order = await serializeOrderRow(row)
  order.statusHistory = await listOrderStatusHistory(order.id)
  return order
}

export interface Pagination {
  page: number
  limit: number
  total: number
  pages: number
}

export async function listOrdersForUser(userId: string, page: number, limit: number): Promise<{ orders: SerializedOrder[], pagination: Pagination }> {
  const offset = (page - 1) * limit
  const { rows: countRows } = await pool.query<{ n: string }>('SELECT COUNT(*) as n FROM orders WHERE user_id = $1', [userId])
  const total = Number(countRows[0].n)

  const { rows } = await pool.query<OrderRow>(
    `SELECT ${SELECT_ORDER_FIELDS} FROM orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  )

  const itemsByOrder = await fetchItemsForOrders(rows.map(r => r.id))
  const orders = rows.map(row => ({
    id: row.id,
    orderNumber: row.orderNumber,
    createdAt: row.createdAt,
    deliverySlot: row.deliverySlot,
    deliveryDate: row.deliveryDate ?? undefined,
    paymentMethod: row.paymentMethod,
    customer: {
      fullName: row.customerFullName,
      mobile: row.customerMobile,
      governorate: row.customerGovernorate,
      address: row.customerAddress
    },
    items: itemsByOrder.get(row.id) ?? [],
    subtotal: row.subtotal,
    deliveryFee: row.deliveryFee,
    total: row.total,
    status: row.status,
    discountCode: row.discountCode ?? undefined,
    discountAmount: row.discountAmount,
    promotionDiscountAmount: row.promotionDiscountAmount,
    loyaltyPointsRedeemed: row.loyaltyPointsRedeemed,
    loyaltyDiscountAmount: row.loyaltyDiscountAmount,
    deliveryInstructions: row.deliveryInstructions || undefined,
    substitutionPreference: row.substitutionPreference as SubstitutionPreference
  }))

  return { orders, pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) } }
}

// إلغاء طلب من لوحة التحكم: بيرجّع المخزون (idempotent، مش هيتكرر لو الطلب ملغى بالفعل)
// وبيتحقق إن الانتقال مسموح (مش هيسمح مثلاً بإلغاء طلب "تم التسليم" بالفعل).
export async function cancelOrder(orderId: string, changedByUserId: string | null = null): Promise<{ ok: true } | { ok: false, error: 'order_not_found' | 'invalid_status_transition' }> {
  return withTransaction(async client => {
    const { rows } = await client.query<{ status: OrderStatus }>('SELECT status FROM orders WHERE id = $1 FOR UPDATE', [orderId])
    const current = rows[0]
    if (!current) return { ok: false, error: 'order_not_found' }

    if (!canTransitionOrderStatus(current.status, 'cancelled')) {
      return { ok: false, error: 'invalid_status_transition' }
    }

    await client.query('UPDATE orders SET status = $1 WHERE id = $2', ['cancelled', orderId])
    await recordOrderStatusChange(client, { orderId, fromStatus: current.status, toStatus: 'cancelled', changedByUserId, source: 'admin' })
    const restoreResult = await restoreStockForCancelledOrder(client, orderId)
    // بيرجّع أي نقاط اتستخدمت في الطلب ده (سيناريو حقيقي: طلب استخدم نقاط قبل التسليم ثم
    // اتلغى). إلغاء اكتساب نقاط سبق منحها غير قابل للوصول فعلياً هنا (طلب "delivered" حالة
    // نهائية ما بترجعش لـ "cancelled" — راجع orderStatus.ts) لكن الاستدعاء آمن ومثالي عشان
    // يفضل صحيح لو آلة الحالات اتغيّرت مستقبلاً؛ المسار الحقيقي لإلغاء نقاط مكتسبة بعد
    // التسليم هو مرتجع/استرداد كامل — راجع customerReturnService.ts.
    await restoreRedeemedPointsForOrder(client, orderId)
    await reverseEarnedPointsForOrder(client, orderId)
    logEvent('order_cancelled', { orderId })
    if (restoreResult === 'restored') logEvent('stock_restored', { orderId })
    return { ok: true }
  })
}
