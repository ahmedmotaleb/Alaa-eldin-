import type { ApiSettings } from '../utils/api'

// قيم احتياطية فقط لحد ما يوصل رد /api/settings — كل الصفحات اللي بتستخدم getSettings()
// محمية خلف CatalogGate اللي بيستنى تحميل الكتالوج والإعدادات معاً قبل ما يعرض أي صفحة.
const DEFAULT_SETTINGS: ApiSettings = {
  name: 'علاء الدين',
  whatsappNumber: '01000000000',
  currency: 'ج.م',
  minimumOrder: 100,
  freeShippingThreshold: 500,
  deliveryFee: 30,
  showTodaysOffers: true,
  showBestSellers: true,
  codEnabled: true,
  loyaltyPointsPerEgp: 0.1,
  loyaltyEnabled: false,
  loyaltyPointValueEgp: 0,
  loyaltyMinRedeemPoints: 0,
  loyaltyMaxRedemptionPercent: 0,
  loyaltyMinOrderForRedemption: 0,
  loyaltyExpiryEnabled: false,
  loyaltyExpiryDays: 0,
  referralEnabled: false,
  referralReferredBonusPoints: 0,
  referralMinQualifyingOrder: 0
}

let current: ApiSettings = DEFAULT_SETTINGS
// null = Turnstile مش مُفعّل (أو لسه ما وصلش رد /api/settings) — أي مكوّن بيعرض الـ widget
// لازم يتجاهله بالكامل في الحالة دي، مش يحاول يعرض widget بمفتاح فاضي.
let currentCaptchaSiteKey: string | null = null

export function getSettings() {
  return current
}

export function setSettings(settings: ApiSettings) {
  current = settings
}

export function getCaptchaSiteKey() {
  return currentCaptchaSiteKey
}

export function setCaptchaSiteKey(siteKey: string | null) {
  currentCaptchaSiteKey = siteKey
}
