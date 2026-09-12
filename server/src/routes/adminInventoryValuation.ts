import { Router } from 'express'
import { requireAdmin } from '../auth.js'
import { getInventoryValuation } from '../services/inventoryValuationService.js'

export const adminInventoryValuationRouter = Router()
adminInventoryValuationRouter.use(requireAdmin)

adminInventoryValuationRouter.get('/', async (_req, res) => {
  const valuation = await getInventoryValuation()
  res.json(valuation)
})
