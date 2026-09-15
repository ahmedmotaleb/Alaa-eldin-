import { Router } from 'express'
import { requireAdmin, requirePermission } from '../auth.js'
import { getInventoryValuation, type CostBasis } from '../services/inventoryValuationService.js'

export const adminInventoryValuationRouter = Router()
adminInventoryValuationRouter.use(requireAdmin)

adminInventoryValuationRouter.get('/', requirePermission('products.cost_view'), async (req, res) => {
  const costBasis: CostBasis = req.query.costBasis === 'weighted_average' ? 'weighted_average' : 'latest_cost'
  const valuation = await getInventoryValuation(costBasis)
  res.json(valuation)
})
