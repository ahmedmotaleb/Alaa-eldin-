import { Router } from 'express'
import { db } from '../db.js'

export const settingsRouter = Router()

const SELECT_SETTINGS = `
  SELECT name, whatsapp_number as whatsappNumber, currency, minimum_order as minimumOrder,
         free_shipping_threshold as freeShippingThreshold, delivery_fee as deliveryFee,
         show_todays_offers as showTodaysOffers, show_best_sellers as showBestSellers,
         cod_enabled as codEnabled
  FROM store_settings WHERE id = 1
`

settingsRouter.get('/settings', (_req, res) => {
  const row = db.prepare(SELECT_SETTINGS).get() as Record<string, unknown>
  res.json({ settings: { ...row, showTodaysOffers: !!row.showTodaysOffers, showBestSellers: !!row.showBestSellers, codEnabled: !!row.codEnabled } })
})
