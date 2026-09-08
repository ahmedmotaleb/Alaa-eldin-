import { Router } from 'express'
import { requireAuth } from '../auth.js'
import { validateCheckoutInput } from '../checkoutValidation.js'
import { createOrder, getOrderByNumberForUser, listOrdersForUser, OrderError } from '../services/orderService.js'

export const ordersRouter = Router()

function parsePagination(query: Record<string, unknown>) {
  const page = Math.max(1, Number(query.page) || 1)
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20))
  return { page, limit }
}

ordersRouter.get('/', requireAuth, async (req, res) => {
  const { page, limit } = parsePagination(req.query as Record<string, unknown>)
  const { orders, pagination } = await listOrdersForUser(req.user!.id, page, limit)
  res.json({ orders, pagination })
})

ordersRouter.get('/:orderNumber', requireAuth, async (req, res) => {
  const order = await getOrderByNumberForUser(String(req.params.orderNumber), req.user!.id)
  if (!order) {
    res.status(404).json({ error: 'order_not_found' })
    return
  }
  res.json({ order })
})

// الطلب بدون تسجيل دخول مسموح (زائر) — لو فيه جلسة صالحة، الطلب يترتبط بالحساب تلقائياً؛
// لو لأ، user_id بيتسجّل NULL. مفيش أي طريقة تانية للزائر يرجع يشوف طلبه غير صفحة التأكيد
// مباشرة بعد الإنشاء (اللي بتستخدم الرد ده نفسه) — عشان مفيش endpoint عام يسمح بمعرفة تفاصيل
// طلب حد تاني لو حد لقط رقم الطلب.
//
// كل حسابات الفلوس (سعر الوحدة، الإجمالي الفرعي، الخصم، رسوم التوصيل، الإجمالي النهائي)
// بتتحسب من السيرفر فقط داخل orderService.createOrder — أي قيمة فلوس يبعتها العميل في
// الطلب بتتجاهل تماماً، ومفيش أي حقل زيها في شكل الطلب المتوقع أصلاً (items لازم تبقى
// {productId, quantity} بس).
ordersRouter.post('/', async (req, res) => {
  const validation = validateCheckoutInput(req.body)
  if (!validation.ok) {
    res.status(400).json({ error: validation.error })
    return
  }

  const idempotencyKeyHeader = req.get('Idempotency-Key')
  const idempotencyKey = typeof idempotencyKeyHeader === 'string' && idempotencyKeyHeader.trim() ? idempotencyKeyHeader.trim() : null

  try {
    const { order, replay } = await createOrder(validation.data, req.user?.id ?? null, idempotencyKey)
    res.status(replay ? 200 : 201).json({ order })
  } catch (err) {
    if (err instanceof OrderError) {
      res.status(err.status).json({ error: err.code, ...(err.details ?? {}) })
      return
    }
    throw err
  }
})
