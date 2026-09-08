import { Router } from 'express'
import { db } from '../db.js'
import { requireAdmin } from '../auth.js'

export const adminSettingsRouter = Router()
adminSettingsRouter.use(requireAdmin)

const SELECT_SETTINGS = `
  SELECT name, whatsapp_number as whatsappNumber, currency, minimum_order as minimumOrder,
         free_shipping_threshold as freeShippingThreshold, delivery_fee as deliveryFee,
         show_todays_offers as showTodaysOffers, show_best_sellers as showBestSellers,
         cod_enabled as codEnabled
  FROM store_settings WHERE id = 1
`

function serialize(row: Record<string, unknown>) {
  return { ...row, showTodaysOffers: !!row.showTodaysOffers, showBestSellers: !!row.showBestSellers, codEnabled: !!row.codEnabled }
}

adminSettingsRouter.get('/', (_req, res) => {
  const row = db.prepare(SELECT_SETTINGS).get() as Record<string, unknown>
  res.json({ settings: serialize(row) })
})

adminSettingsRouter.patch('/', (req, res) => {
  const existing = serialize(db.prepare(SELECT_SETTINGS).get() as Record<string, unknown>)
  const b = { ...existing, ...(req.body ?? {}) } as Record<string, unknown>

  if (
    typeof b.name !== 'string' || !b.name.trim() ||
    typeof b.whatsappNumber !== 'string' || !b.whatsappNumber.trim() ||
    typeof b.currency !== 'string' || !b.currency.trim() ||
    typeof b.minimumOrder !== 'number' || b.minimumOrder < 0 ||
    typeof b.freeShippingThreshold !== 'number' || b.freeShippingThreshold < 0 ||
    typeof b.deliveryFee !== 'number' || b.deliveryFee < 0 ||
    typeof b.showTodaysOffers !== 'boolean' || typeof b.showBestSellers !== 'boolean' ||
    typeof b.codEnabled !== 'boolean'
  ) {
    res.status(400).json({ error: 'missing_fields' })
    return
  }

  db.prepare(`
    UPDATE store_settings SET name=@name, whatsapp_number=@whatsappNumber, currency=@currency,
      minimum_order=@minimumOrder, free_shipping_threshold=@freeShippingThreshold, delivery_fee=@deliveryFee,
      show_todays_offers=@showTodaysOffers, show_best_sellers=@showBestSellers, cod_enabled=@codEnabled
    WHERE id = 1
  `).run({ ...b, showTodaysOffers: b.showTodaysOffers ? 1 : 0, showBestSellers: b.showBestSellers ? 1 : 0, codEnabled: b.codEnabled ? 1 : 0 })

  const row = db.prepare(SELECT_SETTINGS).get() as Record<string, unknown>
  res.json({ settings: serialize(row) })
})
