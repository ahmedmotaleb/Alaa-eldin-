import { Router } from 'express'
import { requireAdmin } from '../auth.js'
import { getAlerts } from '../services/alertsService.js'

export const adminAlertsRouter = Router()
adminAlertsRouter.use(requireAdmin)

adminAlertsRouter.get('/', async (_req, res) => {
  const alerts = await getAlerts()
  res.json({ alerts, count: alerts.reduce((sum, a) => sum + a.count, 0) })
})
