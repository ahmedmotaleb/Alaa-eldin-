import { Router } from 'express'
import { pool } from '../db.js'
import { requireAuth } from '../auth.js'
import { subscribeToBackInStock, unsubscribeFromBackInStock, isSubscribedToBackInStock } from '../services/backInStockService.js'
import { logEvent } from '../logger.js'

export const backInStockRouter = Router()
backInStockRouter.use(requireAuth)

backInStockRouter.get('/:productId', async (req, res) => {
  res.json({ subscribed: await isSubscribedToBackInStock(req.user!.id, String(req.params.productId)) })
})

backInStockRouter.post('/:productId', async (req, res) => {
  const productId = String(req.params.productId)
  const { rows } = await pool.query('SELECT 1 FROM products WHERE id = $1', [productId])
  if (!rows[0]) {
    res.status(404).json({ error: 'product_not_found' })
    return
  }
  await subscribeToBackInStock(req.user!.id, productId)
  logEvent('back_in_stock_subscribed', { userId: req.user!.id, productId })
  res.status(201).json({ subscribed: true })
})

backInStockRouter.delete('/:productId', async (req, res) => {
  await unsubscribeFromBackInStock(req.user!.id, String(req.params.productId))
  res.status(204).end()
})
