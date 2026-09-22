import { Router } from 'express'
import { computePromotionsForCart, type PromotionCartItem } from '../services/promotionService.js'

export const promotionsRouter = Router()

// معاينة بس — مبلغ الخصم النهائي الحقيقي دايماً بيتحسب من جديد جوه orderService.createOrder
// وقت إنشاء الطلب الفعلي (نفس مبدأ معاينة كود الخصم في discounts.ts). الرد هنا مقصود يبقى
// بسيط (اسم العرض + مبلغ الخصم بس) من غير أي تفاصيل تكوين داخلية (نوع العرض، شروطه، حدوده) —
// عشان ميبقاش فيه أي معلومة تساعد حد يفهم منطق العرض الداخلي أو يتلاعب بيه.
function parseCartItems(raw: unknown): PromotionCartItem[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((item): item is PromotionCartItem =>
    item && typeof item === 'object' &&
    typeof item.productId === 'string' &&
    typeof item.categoryId === 'string' &&
    typeof item.quantity === 'number' && item.quantity > 0 &&
    typeof item.unitPrice === 'number' && item.unitPrice >= 0
  )
}

promotionsRouter.post('/promotions/preview', async (req, res) => {
  const items = parseCartItems((req.body as Record<string, unknown> | undefined)?.items)
  if (items.length === 0) {
    res.json({ promotions: [], totalDiscount: 0 })
    return
  }
  const result = await computePromotionsForCart(items)
  res.json({
    promotions: result.applications.map(a => ({ name: a.name, discountAmount: a.discountAmount })),
    totalDiscount: result.totalDiscount
  })
})
