// لوجينج مُهيكل واحد للمشروع كله (pino) — سطر JSON واحد لكل حدث في production، وصيغة
// مقروءة (pretty) في التطوير. القاعدة الصارمة: ممنوع تسجيل كلمات مرور/hashes/tokens/أسرار
// API/DATABASE_URL أبداً، وأرقام الهاتف لازم تتقنّع (010****5678) لو ظهرت في أي حدث.
import pino from 'pino'

const isProduction = process.env.NODE_ENV === 'production'
const isTest = process.env.NODE_ENV === 'test'

export const REDACT_PATHS = [
  'password', 'passwordHash', 'password_hash', 'token', 'sessionToken', 'session_token',
  'authCookie', 'cookie', 'resetToken', 'reset_token', 'apiKey', 'api_key', 'apiSecret',
  'api_secret', 'databaseUrl', 'DATABASE_URL', 'req.headers.cookie', 'req.headers.authorization'
]
export const REDACT_CENSOR = '[redacted]'

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (isTest ? 'silent' : 'info'),
  transport: isProduction || isTest
    ? undefined
    : { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } },
  redact: { paths: REDACT_PATHS, censor: REDACT_CENSOR }
})

// بيقنّع كل الأرقام ما عدا آخر 4 خانات: "01012345678" -> "010****5678"
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.length <= 6) return '*'.repeat(digits.length)
  return `${digits.slice(0, 3)}${'*'.repeat(digits.length - 7)}${digits.slice(-4)}`
}

type BusinessEvent =
  | 'server_started' | 'database_connected'
  | 'migration_started' | 'migration_completed' | 'migration_failed'
  | 'login_success' | 'login_failed' | 'logout'
  | 'order_created' | 'order_replayed_idempotency' | 'order_failed' | 'order_cancelled' | 'order_delivered'
  | 'stock_deducted' | 'stock_restored' | 'stock_insufficient'
  | 'discount_applied' | 'discount_rejected'
  | 'image_upload_success' | 'image_upload_failed' | 'image_deleted'
  | 'admin_product_created' | 'admin_product_updated' | 'admin_product_deleted_or_archived'
  | 'admin_stock_adjusted'
  | 'healthcheck_failed'
  | 'content_page_created' | 'content_page_updated' | 'content_page_status_changed'
  | 'checkout_validation_failed'
  | 'profile_updated'
  | 'address_created' | 'address_updated' | 'address_deleted'
  | 'favorite_added' | 'favorite_removed'
  | 'password_reset_email_skipped' | 'password_reset_email_failed'
  | 'catalog_search' | 'product_view' | 'delivery_zone_selected' | 'role_changed' | 'permission_role_changed'
  | 'two_factor_enabled' | 'two_factor_disabled' | 'two_factor_login_failed'
  | 'session_revoked' | 'sessions_logout_others'
  | 'integration_test_connection'
  | 'startup_config_summary' | 'startup_config_partial_warning'
  | 'substitution_proposed' | 'substitution_approved' | 'substitution_rejected'
  | 'back_in_stock_subscribed'
  | 'loyalty_redemption_rejected' | 'loyalty_points_redeemed' | 'loyalty_points_expired'
  | 'referral_qualified' | 'referral_rewarded'
  | 'captcha_verification_success' | 'captcha_verification_failed' | 'captcha_provider_error' | 'captcha_required'
  | 'support_ticket_created' | 'support_ticket_customer_reply' | 'support_ticket_admin_reply'
  | 'support_ticket_status_changed' | 'support_ticket_priority_changed' | 'support_ticket_assigned'
  | 'price_schedule_applied' | 'price_schedule_conflict'

export function logEvent(event: BusinessEvent, data: Record<string, unknown> = {}) {
  logger.info({ event, ...data })
}

export function logWarn(event: BusinessEvent, data: Record<string, unknown> = {}) {
  logger.warn({ event, ...data })
}

export function logError(event: BusinessEvent, data: Record<string, unknown> = {}) {
  logger.error({ event, ...data })
}
