import { Router } from 'express'
import { evaluateDiscount, type DiscountCartItem } from '../discounts.js'

export const discountsRouter = Router()

// معاينة بس — مبلغ الخصم النهائي الحقيقي دايماً بيتحسب من جديد جوه orderService.createOrder
// وقت إنشاء الطلب الفعلي (نفس مبدأ السلة نفسها). items هنا اختيارية ولو مبعوتة بتخلي
// المعاينة دقيقة لخصم مقيّد بفئة/منتج بدل افتراض إن السلة كلها مؤهّلة.
function parseCartItems(raw: unknown): DiscountCartItem[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((item): item is DiscountCartItem =>
    item && typeof item === 'object' &&
    typeof item.productId === 'string' &&
    typeof item.categoryId === 'string' &&
    typeof item.quantity === 'number' &&
    typeof item.unitPrice === 'number'
  )
}

discountsRouter.post('/discounts/validate', async (req, res) => {
  const { code, subtotal, items } = req.body ?? {}
  if (typeof code !== 'string' || !code.trim() || typeof subtotal !== 'number' || subtotal < 0) {
    res.status(400).json({ error: 'missing_fields' })
    return
  }

  const result = await evaluateDiscount(code, subtotal, parseCartItems(items))
  if (!result.ok) {
    res.status(result.error === 'discount_not_found' ? 404 : 400).json({ error: result.error, minOrder: result.minOrder, minQuantity: result.minQuantity })
    return
  }

  res.json({
    discount: {
      code: result.discount.code, type: result.discount.type, value: result.discount.value,
      amount: result.amount, freeDelivery: !!result.discount.freeDelivery
    }
  })
})
