import { Router } from 'express'
import { requireAdmin, requirePermission } from '../auth.js'
import { getInventoryValuation } from '../services/inventoryValuationService.js'

export const adminInventoryValuationRouter = Router()
adminInventoryValuationRouter.use(requireAdmin)

adminInventoryValuationRouter.get('/', requirePermission('products.cost_view'), async (_req, res) => {
  const valuation = await getInventoryValuation()
  res.json(valuation)
})
