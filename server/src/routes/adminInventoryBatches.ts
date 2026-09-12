import { Router } from 'express'
import { requireAdmin, requirePermission } from '../auth.js'
import { getExpiryDashboard } from '../services/inventoryBatchService.js'

export const adminInventoryBatchesRouter = Router()
adminInventoryBatchesRouter.use(requireAdmin)

adminInventoryBatchesRouter.get('/expiry', requirePermission('inventory.view'), async (_req, res) => {
  const dashboard = await getExpiryDashboard()
  res.json(dashboard)
})
