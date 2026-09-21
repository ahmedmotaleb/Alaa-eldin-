import { Router } from 'express'
import { pool } from '../db.js'
import { setShortPublicCache } from '../publicCache.js'
import { turnstileSiteKey } from '../services/turnstileService.js'

export const settingsRouter = Router()

const SELECT_SETTINGS = `
  SELECT name, whatsapp_number as "whatsappNumber", currency, minimum_order as "minimumOrder",
         free_shipping_threshold as "freeShippingThreshold", delivery_fee as "deliveryFee",
         show_todays_offers as "showTodaysOffers", show_best_sellers as "showBestSellers",
         cod_enabled as "codEnabled", loyalty_points_per_egp as "loyaltyPointsPerEgp",
         loyalty_enabled as "loyaltyEnabled", loyalty_point_value_egp as "loyaltyPointValueEgp",
         loyalty_min_redeem_points as "loyaltyMinRedeemPoints", loyalty_max_redemption_percent as "loyaltyMaxRedemptionPercent",
         loyalty_min_order_for_redemption as "loyaltyMinOrderForRedemption",
         loyalty_expiry_enabled as "loyaltyExpiryEnabled", loyalty_expiry_days as "loyaltyExpiryDays",
         referral_enabled as "referralEnabled", referral_referred_bonus_points as "referralReferredBonusPoints",
         referral_min_qualifying_order as "referralMinQualifyingOrder"
  FROM store_settings WHERE id = 1
`

settingsRouter.get('/settings', async (_req, res) => {
  setShortPublicCache(res, 60)
  const { rows } = await pool.query<Record<string, unknown>>(SELECT_SETTINGS)
  const row = rows[0]
  res.json({
    // مفتاح الموقع العام بس (siteKey) — آمن للتعريض، ده تصميم Turnstile نفسه. null لو
    // Turnstile مش مُفعّل، عشان الواجهة الأمامية تتجاهل الـ widget بالكامل.
    captcha: {
      turnstileSiteKey
    },
    settings: {
      ...row,
      showTodaysOffers: !!row.showTodaysOffers, showBestSellers: !!row.showBestSellers, codEnabled: !!row.codEnabled,
      loyaltyPointsPerEgp: Number(row.loyaltyPointsPerEgp),
      loyaltyEnabled: !!row.loyaltyEnabled,
      loyaltyPointValueEgp: Number(row.loyaltyPointValueEgp),
      loyaltyMinRedeemPoints: Number(row.loyaltyMinRedeemPoints),
      loyaltyMaxRedemptionPercent: Number(row.loyaltyMaxRedemptionPercent),
      loyaltyMinOrderForRedemption: Number(row.loyaltyMinOrderForRedemption),
      loyaltyExpiryEnabled: !!row.loyaltyExpiryEnabled,
      loyaltyExpiryDays: Number(row.loyaltyExpiryDays),
      referralEnabled: !!row.referralEnabled,
      referralReferredBonusPoints: Number(row.referralReferredBonusPoints),
      referralMinQualifyingOrder: Number(row.referralMinQualifyingOrder)
    }
  })
})
