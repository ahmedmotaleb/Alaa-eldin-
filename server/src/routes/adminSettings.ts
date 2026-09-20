import { Router } from 'express'
import { pool } from '../db.js'
import { requireAdmin } from '../auth.js'
import { isValidEgyptianMobile } from '../phone.js'
import { recordAuditLog } from '../services/auditLogService.js'

export const adminSettingsRouter = Router()
adminSettingsRouter.use(requireAdmin)

const SELECT_SETTINGS = `
  SELECT name, whatsapp_number as "whatsappNumber", currency, minimum_order as "minimumOrder",
         free_shipping_threshold as "freeShippingThreshold", delivery_fee as "deliveryFee",
         show_todays_offers as "showTodaysOffers", show_best_sellers as "showBestSellers",
         cod_enabled as "codEnabled", show_exact_low_stock as "showExactLowStock",
         loyalty_points_per_egp as "loyaltyPointsPerEgp", referral_bonus_points as "referralBonusPoints",
         min_margin_percent as "minMarginPercent",
         loyalty_enabled as "loyaltyEnabled", loyalty_point_value_egp as "loyaltyPointValueEgp",
         loyalty_min_redeem_points as "loyaltyMinRedeemPoints", loyalty_max_redemption_percent as "loyaltyMaxRedemptionPercent",
         loyalty_min_order_for_redemption as "loyaltyMinOrderForRedemption",
         loyalty_expiry_enabled as "loyaltyExpiryEnabled", loyalty_expiry_days as "loyaltyExpiryDays",
         loyalty_expiry_warning_days as "loyaltyExpiryWarningDays",
         referral_enabled as "referralEnabled", referral_referred_bonus_points as "referralReferredBonusPoints",
         referral_min_qualifying_order as "referralMinQualifyingOrder"
  FROM store_settings WHERE id = 1
`

function serialize(row: Record<string, unknown>) {
  return {
    ...row,
    showTodaysOffers: !!row.showTodaysOffers,
    showBestSellers: !!row.showBestSellers,
    codEnabled: !!row.codEnabled,
    showExactLowStock: !!row.showExactLowStock,
    loyaltyPointsPerEgp: Number(row.loyaltyPointsPerEgp),
    referralBonusPoints: Number(row.referralBonusPoints),
    minMarginPercent: Number(row.minMarginPercent),
    loyaltyEnabled: !!row.loyaltyEnabled,
    loyaltyPointValueEgp: Number(row.loyaltyPointValueEgp),
    loyaltyMinRedeemPoints: Number(row.loyaltyMinRedeemPoints),
    loyaltyMaxRedemptionPercent: Number(row.loyaltyMaxRedemptionPercent),
    loyaltyMinOrderForRedemption: Number(row.loyaltyMinOrderForRedemption),
    loyaltyExpiryEnabled: !!row.loyaltyExpiryEnabled,
    loyaltyExpiryDays: Number(row.loyaltyExpiryDays),
    loyaltyExpiryWarningDays: Number(row.loyaltyExpiryWarningDays),
    referralEnabled: !!row.referralEnabled,
    referralReferredBonusPoints: Number(row.referralReferredBonusPoints),
    referralMinQualifyingOrder: Number(row.referralMinQualifyingOrder)
  }
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
    typeof b.codEnabled !== 'boolean' || typeof b.showExactLowStock !== 'boolean' ||
    typeof b.loyaltyPointsPerEgp !== 'number' || b.loyaltyPointsPerEgp < 0 ||
    typeof b.referralBonusPoints !== 'number' || !Number.isInteger(b.referralBonusPoints) || b.referralBonusPoints < 0 ||
    typeof b.minMarginPercent !== 'number' || b.minMarginPercent < 0 || b.minMarginPercent > 100 ||
    typeof b.loyaltyEnabled !== 'boolean' ||
    typeof b.loyaltyPointValueEgp !== 'number' || b.loyaltyPointValueEgp < 0 ||
    typeof b.loyaltyMinRedeemPoints !== 'number' || !Number.isInteger(b.loyaltyMinRedeemPoints) || b.loyaltyMinRedeemPoints < 0 ||
    typeof b.loyaltyMaxRedemptionPercent !== 'number' || b.loyaltyMaxRedemptionPercent < 0 || b.loyaltyMaxRedemptionPercent > 100 ||
    typeof b.loyaltyMinOrderForRedemption !== 'number' || b.loyaltyMinOrderForRedemption < 0 ||
    typeof b.loyaltyExpiryEnabled !== 'boolean' ||
    typeof b.loyaltyExpiryDays !== 'number' || !Number.isInteger(b.loyaltyExpiryDays) || b.loyaltyExpiryDays < 0 ||
    typeof b.loyaltyExpiryWarningDays !== 'number' || !Number.isInteger(b.loyaltyExpiryWarningDays) || b.loyaltyExpiryWarningDays < 0 ||
    typeof b.referralEnabled !== 'boolean' ||
    typeof b.referralReferredBonusPoints !== 'number' || !Number.isInteger(b.referralReferredBonusPoints) || b.referralReferredBonusPoints < 0 ||
    typeof b.referralMinQualifyingOrder !== 'number' || b.referralMinQualifyingOrder < 0
  ) {
    res.status(400).json({ error: 'missing_fields' })
    return
  }

  await pool.query(
    `UPDATE store_settings SET name=$1, whatsapp_number=$2, currency=$3,
       minimum_order=$4, free_shipping_threshold=$5, delivery_fee=$6,
       show_todays_offers=$7, show_best_sellers=$8, cod_enabled=$9, show_exact_low_stock=$10,
       loyalty_points_per_egp=$11, referral_bonus_points=$12, min_margin_percent=$13,
       loyalty_enabled=$14, loyalty_point_value_egp=$15, loyalty_min_redeem_points=$16,
       loyalty_max_redemption_percent=$17, loyalty_min_order_for_redemption=$18,
       loyalty_expiry_enabled=$19, loyalty_expiry_days=$20, loyalty_expiry_warning_days=$21,
       referral_enabled=$22, referral_referred_bonus_points=$23, referral_min_qualifying_order=$24
     WHERE id = 1`,
    [
      b.name, b.whatsappNumber, b.currency, b.minimumOrder, b.freeShippingThreshold, b.deliveryFee,
      b.showTodaysOffers ? 1 : 0, b.showBestSellers ? 1 : 0, b.codEnabled ? 1 : 0, b.showExactLowStock ? 1 : 0,
      b.loyaltyPointsPerEgp, b.referralBonusPoints, b.minMarginPercent,
      b.loyaltyEnabled ? 1 : 0, b.loyaltyPointValueEgp, b.loyaltyMinRedeemPoints,
      b.loyaltyMaxRedemptionPercent, b.loyaltyMinOrderForRedemption,
      b.loyaltyExpiryEnabled ? 1 : 0, b.loyaltyExpiryDays, b.loyaltyExpiryWarningDays,
      b.referralEnabled ? 1 : 0, b.referralReferredBonusPoints, b.referralMinQualifyingOrder
    ]
  )

  const { rows } = await pool.query<Record<string, unknown>>(SELECT_SETTINGS)
  const settings = serialize(rows[0])
  await recordAuditLog({
    adminUserId: req.user!.id,
    action: 'store_settings_updated',
    entityType: 'store_settings',
    entityId: '1',
    oldValues: existing,
    newValues: settings
  })
  res.json({ settings })
})
