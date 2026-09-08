import { Router } from 'express'
import { pool } from '../db.js'
import { requireAdmin } from '../auth.js'
import { isValidEgyptianMobile } from '../phone.js'

export const adminSettingsRouter = Router()
adminSettingsRouter.use(requireAdmin)

const SELECT_SETTINGS = `
  SELECT name, whatsapp_number as "whatsappNumber", currency, minimum_order as "minimumOrder",
         free_shipping_threshold as "freeShippingThreshold", delivery_fee as "deliveryFee",
         show_todays_offers as "showTodaysOffers", show_best_sellers as "showBestSellers",
         cod_enabled as "codEnabled"
  FROM store_settings WHERE id = 1
`

function serialize(row: Record<string, unknown>) {
  return { ...row, showTodaysOffers: !!row.showTodaysOffers, showBestSellers: !!row.showBestSellers, codEnabled: !!row.codEnabled }
}

adminSettingsRouter.get('/', async (_req, res) => {
  const { rows } = await pool.query<Record<string, unknown>>(SELECT_SETTINGS)
  res.json({ settings: serialize(rows[0]) })
})

adminSettingsRouter.patch('/', async (req, res) => {
  const { rows: existingRows } = await pool.query<Record<string, unknown>>(SELECT_SETTINGS)
  const existing = serialize(existingRows[0])
  const b = { ...existing, ...(req.body ?? {}) } as Record<string, unknown>

  if (
    typeof b.name !== 'string' || !b.name.trim() ||
    typeof b.whatsappNumber !== 'string' || !isValidEgyptianMobile(b.whatsappNumber.trim()) ||
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

  await pool.query(
    `UPDATE store_settings SET name=$1, whatsapp_number=$2, currency=$3,
       minimum_order=$4, free_shipping_threshold=$5, delivery_fee=$6,
       show_todays_offers=$7, show_best_sellers=$8, cod_enabled=$9
     WHERE id = 1`,
    [
      b.name, b.whatsappNumber, b.currency, b.minimumOrder, b.freeShippingThreshold, b.deliveryFee,
      b.showTodaysOffers ? 1 : 0, b.showBestSellers ? 1 : 0, b.codEnabled ? 1 : 0
    ]
  )

  const { rows } = await pool.query<Record<string, unknown>>(SELECT_SETTINGS)
  res.json({ settings: serialize(rows[0]) })
})
