import { Router } from 'express'
import { evaluateDiscount } from '../discounts.js'

export const discountsRouter = Router()

discountsRouter.post('/discounts/validate', (req, res) => {
  const { code, subtotal } = req.body ?? {}
  if (typeof code !== 'string' || !code.trim() || typeof subtotal !== 'number' || subtotal < 0) {
    res.status(400).json({ error: 'missing_fields' })
    return
  }

  const result = evaluateDiscount(code, subtotal)
  if (!result.ok) {
    res.status(result.error === 'discount_not_found' ? 404 : 400).json({ error: result.error, minOrder: result.minOrder })
    return
  }

  res.json({ discount: { code: result.discount.code, type: result.discount.type, value: result.discount.value, amount: result.amount } })
})
