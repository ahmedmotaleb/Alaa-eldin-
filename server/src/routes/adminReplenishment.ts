import { Router } from 'express'
import { requireAdmin } from '../auth.js'
import { getReplenishmentSuggestions } from '../services/replenishmentService.js'

export const adminReplenishmentRouter = Router()
adminReplenishmentRouter.use(requireAdmin)

const ALLOWED_TARGET_DAYS = new Set([7, 14, 30])

adminReplenishmentRouter.get('/', async (req, res) => {
  const targetDays = ALLOWED_TARGET_DAYS.has(Number(req.query.targetDays)) ? Number(req.query.targetDays) : 14
  const suggestions = await getReplenishmentSuggestions(targetDays)
  res.json({ suggestions, targetDays })
})
