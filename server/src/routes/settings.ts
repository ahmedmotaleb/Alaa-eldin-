import { Router } from 'express'
import { pool } from '../db.js'
import { setShortPublicCache } from '../publicCache.js'

export const settingsRouter = Router()

const SELECT_SETTINGS = `
  SELECT name, whatsapp_number as "whatsappNumber", currency, minimum_order as "minimumOrder",
         free_shipping_threshold as "freeShippingThreshold", delivery_fee as "deliveryFee",
         show_todays_offers as "showTodaysOffers", show_best_sellers as "showBestSellers",
         cod_enabled as "codEnabled"
  FROM store_settings WHERE id = 1
`

settingsRouter.get('/settings', async (_req, res) => {
  setShortPublicCache(res, 60)
  const { rows } = await pool.query<Record<string, unknown>>(SELECT_SETTINGS)
  const row = rows[0]
  res.json({ settings: { ...row, showTodaysOffers: !!row.showTodaysOffers, showBestSellers: !!row.showBestSellers, codEnabled: !!row.codEnabled } })
})
