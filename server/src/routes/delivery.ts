import { Router } from 'express'
import { listActiveDeliveryZones, listActiveDeliverySlotsWithAvailability } from '../services/deliveryService.js'

export const deliveryRouter = Router()

deliveryRouter.get('/zones', async (_req, res) => {
  const zones = await listActiveDeliveryZones()
  res.json({ zones: zones.map(z => ({ governorate: z.governorate, deliveryFee: z.deliveryFee })) })
})

deliveryRouter.get('/slots', async (_req, res) => {
  const slots = await listActiveDeliverySlotsWithAvailability()
  res.json({ slots: slots.map(s => ({ id: s.id, label: s.label, note: s.note, available: s.available })) })
})
