import { Router } from 'express'
import { requirePermission } from '../auth.js'
import { createPriceSchedule, listPriceSchedules, cancelPriceSchedule, type PriceScheduleStatus } from '../services/pricingScheduleService.js'

export const adminPricingSchedulesRouter = Router()
adminPricingSchedulesRouter.use(requirePermission('products.pricing.bulk_update'))

const VALID_STATUSES = new Set<PriceScheduleStatus>(['pending', 'applied', 'cancelled', 'conflict'])

adminPricingSchedulesRouter.get('/', async (req, res) => {
  const productId = typeof req.query.productId === 'string' ? req.query.productId : undefined
  const statusRaw = typeof req.query.status === 'string' ? req.query.status : undefined
  const status = statusRaw && VALID_STATUSES.has(statusRaw as PriceScheduleStatus) ? (statusRaw as PriceScheduleStatus) : undefined
  const schedules = await listPriceSchedules({ productId, status })
  res.json({ schedules })
})

adminPricingSchedulesRouter.post('/', async (req, res) => {
  const b = req.body as Record<string, unknown>
  const productId = typeof b?.productId === 'string' && b.productId.trim() ? b.productId.trim() : null
  const variantId = typeof b?.variantId === 'string' && b.variantId.trim() ? b.variantId.trim() : null
  if ((productId === null) === (variantId === null)) {
    res.status(400).json({ error: 'missing_fields' })
    return
  }
  if (typeof b?.newPrice !== 'number' || b.newPrice <= 0) {
    res.status(400).json({ error: 'missing_fields' })
    return
  }
  const newOldPrice = typeof b?.newOldPrice === 'number' && b.newOldPrice > 0 ? b.newOldPrice : null
  if (typeof b?.startsAt !== 'string' || !b.startsAt.trim()) {
    res.status(400).json({ error: 'missing_fields' })
    return
  }

  const result = await createPriceSchedule(
    { productId, variantId, newPrice: b.newPrice, newOldPrice, startsAt: b.startsAt },
    req.user!.id
  )
  if (!result.ok) {
    res.status(400).json({ error: result.error })
    return
  }
  res.status(201).json({ schedule: result.schedule })
})

adminPricingSchedulesRouter.delete('/:id', async (req, res) => {
  const cancelled = await cancelPriceSchedule(req.params.id)
  if (!cancelled) {
    res.status(409).json({ error: 'not_cancellable' })
    return
  }
  res.status(204).end()
})
