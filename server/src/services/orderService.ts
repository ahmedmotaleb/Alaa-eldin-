import crypto from 'node:crypto'
import type { PoolClient } from 'pg'
import { pool, withTransaction } from '../db.js'
import type { CheckoutInput } from '../checkoutValidation.js'
import { computeSubtotal, computeLineTotal, calculateDeliveryFee, computeTotal } from './pricingService.js'
import { findDiscountForUpdate, validateDiscountAgainstSubtotal, incrementDiscountUsageAtomic } from '../discounts.js'
import {
  lockProductsForOrder, validateItemAgainstProduct, deductStockForOrder,
  restoreStockForCancelledOrder
} from './inventoryService.js'
import { fetchItemsForOrders, type OrderItemDTO } from '../orderItems.js'
import { canTransitionOrderStatus, type OrderStatus } from '../orderStatus.js'
import { getActiveDeliveryZoneFee, isActiveDeliverySlot, checkDeliverySlotCapacity } from './deliveryService.js'
import { recordOrderStatusChange, listOrderStatusHistory, type OrderStatusHistoryEntry } from './orderStatusHistoryService.js'
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
  requestFingerprint: string | null
  guestTrackingToken: string | null
}

export interface SerializedOrder {
  id: string
  orderNumber: string
  createdAt: string
  deliverySlot: string
  paymentMethod: string
  customer: { fullName: string, mobile: string, governorate: string, address: string }
  items: OrderItemDTO[]
  subtotal: number
  deliveryFee: number
  total: number
  status: string
  discountCode?: string
  discountAmount: number
  // بيتحدد بس لو الطلب من غير تسجيل دخول (guest) — العميل المسجّل بيستخدم ownership العادي
  // بدل التوكن ده. راجع getOrderByNumberForGuestToken.
  guestTrackingToken?: string
  // بيتحدد بس في مسارات التتبع (getOrderByNumberForUser/getOrderByNumberForGuestToken) —
  // مش في كل استدعاء لـ serializeOrderRow، عشان قائمة الطلبات العادية ما تحتاجش التاريخ الكامل.
  statusHistory?: OrderStatusHistoryEntry[]
}

const SELECT_ORDER_FIELDS = `
  id, order_number as "orderNumber", created_at as "createdAt", delivery_slot as "deliverySlot", payment_method as "paymentMethod",
  customer_full_name as "customerFullName", customer_mobile as "customerMobile", customer_governorate as "customerGovernorate", customer_address as "customerAddress",
  subtotal, delivery_fee as "deliveryFee", total, status, discount_code as "discountCode", discount_amount as "discountAmount",
  request_fingerprint as "requestFingerprint", guest_tracking_token as "guestTrackingToken"
`

async function serializeOrderRow(row: OrderRow): Promise<SerializedOrder> {
  const itemsByOrder = await fetchItemsForOrders([row.id])
  return {
    id: row.id,
    orderNumber: row.orderNumber,
    createdAt: row.createdAt,
    deliverySlot: row.deliverySlot,
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
    guestTrackingToken: row.guestTrackingToken ?? undefined
  }
}

function computeFingerprint(userId: string | null, input: CheckoutInput): string {
  const normalized = JSON.stringify({
    userId,
    deliverySlot: input.deliverySlot,
    customer: input.customer,
    items: [...input.items].sort((a, b) => a.productId.localeCompare(b.productId)),
    discountCode: input.discountCode ?? null
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
      if (!(await checkDeliverySlotCapacity(client, input.deliverySlot))) throw new OrderError(409, 'delivery_slot_full')

      const discount = input.discountCode ? await findDiscountForUpdate(client, input.discountCode) : undefined

      const productIds = input.items.map(i => i.productId)
      const products = await lockProductsForOrder(client, productIds)

      for (const item of input.items) {
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
        return {
          productId: item.productId,
          name: product.name,
          unit: product.unit,
          unitPrice: product.price,
          quantity: item.quantity,
          lineTotal: computeLineTotal(product.price, item.quantity)
        }
      })

      const subtotal = computeSubtotal(lineItems)

      if (subtotal < settings.minimumOrder) {
        throw new OrderError(400, 'minimum_order_not_met', { minimumOrder: settings.minimumOrder, currentAmount: subtotal })
      }

      let discountAmount = 0
      let appliedDiscountCode: string | null = null
      if (input.discountCode) {
        const evaluation = validateDiscountAgainstSubtotal(discount, subtotal)
        if (!evaluation.ok) {
          logWarn('discount_rejected', { discountCode: input.discountCode, errorCode: evaluation.error })
          throw new OrderError(400, evaluation.error, evaluation.minOrder !== undefined ? { minOrder: evaluation.minOrder } : undefined)
        }
        discountAmount = evaluation.amount
        appliedDiscountCode = evaluation.discount.code
        logEvent('discount_applied', { discountCode: appliedDiscountCode, discountAmount })
      }

      const deliveryFee = calculateDeliveryFee(subtotal, { freeShippingThreshold: settings.freeShippingThreshold, deliveryFee: zoneDeliveryFee })
      const total = computeTotal(subtotal, discountAmount, deliveryFee)

      const id = crypto.randomUUID()
      const orderNumber = await nextOrderNumber(client)
      const createdAt = new Date().toISOString()
      // توكن تتبّع عشوائي عالي الإنتروبيا (192 بت) — بيتولّد بس لطلبات الزوار (من غير تسجيل
      // دخول)، وهو الطريقة الوحيدة الآمنة لفتح رابط تتبع الطلب ده تاني بعد الصفحة الأولى.
      const guestTrackingToken = userId ? null : crypto.randomBytes(24).toString('base64url')

      try {
        await client.query(
          `INSERT INTO orders (
             id, order_number, user_id, created_at, delivery_slot, payment_method,
             customer_full_name, customer_mobile, customer_governorate, customer_address,
             subtotal, delivery_fee, total, status, discount_code, discount_amount,
             idempotency_key, request_fingerprint, guest_tracking_token
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'placed',$14,$15,$16,$17,$18)`,
          [
            id, orderNumber, userId, createdAt, input.deliverySlot, input.paymentMethod,
            input.customer.fullName, input.customer.mobile, input.customer.governorate, input.customer.address,
            subtotal, deliveryFee, total, appliedDiscountCode, discountAmount,
            idempotencyKey, fingerprint, guestTrackingToken
          ]
        )
      } catch (err) {
        if (isUniqueViolation(err)) throw new IdempotencyRaceError()
        throw err
      }

      for (const item of lineItems) {
        await client.query(
          'INSERT INTO order_items (order_id, product_id, name, unit, unit_price, quantity, line_total) VALUES ($1,$2,$3,$4,$5,$6,$7)',
          [id, item.productId, item.name, item.unit, item.unitPrice, item.quantity, item.lineTotal]
        )
      }

      await recordOrderStatusChange(client, { orderId: id, fromStatus: null, toStatus: 'placed', source: 'system' })

      for (const item of input.items) {
        await deductStockForOrder(client, item.productId, item.quantity, id)
        logEvent('stock_deducted', { orderId: id, productId: item.productId, quantity: item.quantity })
      }

      if (appliedDiscountCode) {
        const incremented = await incrementDiscountUsageAtomic(client, appliedDiscountCode)
        if (!incremented) throw new OrderError(409, 'discount_max_uses')
      }

      return id
    })

    const { rows } = await pool.query<OrderRow>(`SELECT ${SELECT_ORDER_FIELDS} FROM orders WHERE id = $1`, [orderId])
    const order = await serializeOrderRow(rows[0])
    logEvent('order_created', { orderId: order.id, orderNumber: order.orderNumber, itemCount: order.items.length, total: order.total })
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
    discountAmount: row.discountAmount
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
    logEvent('order_cancelled', { orderId })
    if (restoreResult === 'restored') logEvent('stock_restored', { orderId })
    return { ok: true }
  })
}
