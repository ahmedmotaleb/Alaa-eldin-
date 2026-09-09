import { Router } from 'express'
import { requireAuth } from '../auth.js'
import { listFrequentlyPurchased } from '../services/frequentlyPurchasedService.js'

export const frequentlyPurchasedRouter = Router()
frequentlyPurchasedRouter.use(requireAuth)

frequentlyPurchasedRouter.get('/', async (req, res) => {
  const products = await listFrequentlyPurchased(req.user!.id)
  res.json({ products })
})
