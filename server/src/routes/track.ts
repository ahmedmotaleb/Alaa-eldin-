import { Router } from 'express'
import { getOrderByNumberForGuestToken } from '../services/orderService.js'

export const trackRouter = Router()

// تتبّع طلب زائر — لازم توكن التتبع الصحيح (?t=...)، رقم الطلب لوحده مش كفاية. الرد بنفس
// شكل GET /api/orders/:orderNumber العادي (مفيش أي بيانات إضافية أو داخلية تتكشف هنا).
trackRouter.get('/:orderNumber', async (req, res) => {
  const token = typeof req.query.t === 'string' ? req.query.t : ''
  const order = await getOrderByNumberForGuestToken(String(req.params.orderNumber), token)
  if (!order) {
    res.status(404).json({ error: 'order_not_found' })
    return
  }
  res.json({ order })
})
