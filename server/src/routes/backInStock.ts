import { Router } from 'express'
import { pool } from '../db.js'
import { requireAuth } from '../auth.js'
import { subscribeToBackInStock, unsubscribeFromBackInStock, isSubscribedToBackInStock } from '../services/backInStockService.js'
import { logEvent } from '../logger.js'

export const backInStockRouter = Router()
backInStockRouter.use(requireAuth)

function parseVariantId(req: import('express').Request): string | null {
  return typeof req.query.variantId === 'string' && req.query.variantId.trim() ? req.query.variantId.trim() : null
}

backInStockRouter.get('/:productId', async (req, res) => {
  const variantId = parseVariantId(req)
  res.json({ subscribed: await isSubscribedToBackInStock(req.user!.id, String(req.params.productId), variantId) })
})

backInStockRouter.post('/:productId', async (req, res) => {
  const productId = String(req.params.productId)
  const variantId = parseVariantId(req)
  const { rows } = await pool.query('SELECT 1 FROM products WHERE id = $1', [productId])
  if (!rows[0]) {
    res.status(404).json({ error: 'product_not_found' })
    return
  }
  if (variantId) {
    const { rows: variantRows } = await pool.query('SELECT 1 FROM product_variants WHERE id = $1 AND product_id = $2', [variantId, productId])
    if (!variantRows[0]) {
      res.status(400).json({ error: 'invalid_variant' })
      return
    }
  }
  await subscribeToBackInStock(req.user!.id, productId, variantId)
  logEvent('back_in_stock_subscribed', { userId: req.user!.id, productId, variantId: variantId ?? undefined })
  res.status(201).json({ subscribed: true })
})

backInStockRouter.delete('/:productId', async (req, res) => {
  await unsubscribeFromBackInStock(req.user!.id, String(req.params.productId), parseVariantId(req))
  res.status(204).end()
})
