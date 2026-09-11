import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { getOrderByNumberForGuestToken } from '../services/orderService.js'

export const trackRouter = Router()

// صفحة التتبع بتعمل polling كل 15 ثانية طول ما فاتحها الزائر (TrackingPage.tsx) — يعني
// ~4 طلبات/دقيقة من استخدام عادي واحد بس. الحد هنا (120 كل 15 دقيقة، أي ~8/دقيقة) بيدّي
// هامش كافي لتاب واحد أو اتنين مفتوحين، وبرضه بيحد من محاولات تخمين توكن آلية بكميات كبيرة
// — التوكن نفسه (192 بت عشوائي) هو خط الدفاع الحقيقي، ده مجرد طبقة تكلفة إضافية.
const trackRateLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 120, standardHeaders: true, legacyHeaders: false })

// تتبّع طلب زائر — لازم توكن التتبع الصحيح (?t=...)، رقم الطلب لوحده مش كفاية. الرد بنفس
// شكل GET /api/orders/:orderNumber العادي (مفيش أي بيانات إضافية أو داخلية تتكشف هنا).
trackRouter.get('/:orderNumber', trackRateLimit, async (req, res) => {
  const token = typeof req.query.t === 'string' ? req.query.t : ''
  const order = await getOrderByNumberForGuestToken(String(req.params.orderNumber), token)
  if (!order) {
    res.status(404).json({ error: 'order_not_found' })
    return
  }
  res.json({ order })
})
