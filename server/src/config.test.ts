import { afterEach, describe, expect, it, vi } from 'vitest'

const logEvent = vi.fn()
const logWarn = vi.fn()
vi.mock('./logger.js', () => ({ logEvent: (...args: unknown[]) => logEvent(...args), logWarn: (...args: unknown[]) => logWarn(...args) }))

const ENV_VARS = [
  'CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET',
  'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_ORDER_CONFIRMATION_TEMPLATE',
  'WHATSAPP_WEBHOOK_VERIFY_TOKEN', 'WHATSAPP_APP_SECRET',
  'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY',
  'RESEND_API_KEY',
  'TURNSTILE_SITE_KEY', 'TURNSTILE_SECRET_KEY'
]

afterEach(() => {
  for (const name of ENV_VARS) delete process.env[name]
  vi.clearAllMocks()
})

describe('logStartupConfigSummary', () => {
  it('reports every integration as not configured when no vars are set', async () => {
    const { logStartupConfigSummary } = await import('./config.js')
    logStartupConfigSummary()
    expect(logEvent).toHaveBeenCalledWith('startup_config_summary', {
      configured: [],
      notConfigured: ['cloudinary', 'whatsapp', 'whatsapp_order_confirmation', 'whatsapp_delivery_webhook', 'web_push', 'email', 'turnstile']
    })
    expect(logWarn).not.toHaveBeenCalled()
  })

  it('reports an integration as configured only when all of its required vars are set', async () => {
    process.env.RESEND_API_KEY = 'test-key'
    const { logStartupConfigSummary } = await import('./config.js')
    logStartupConfigSummary()
    expect(logEvent).toHaveBeenCalledWith('startup_config_summary', {
      configured: ['email'],
      notConfigured: ['cloudinary', 'whatsapp', 'whatsapp_order_confirmation', 'whatsapp_delivery_webhook', 'web_push', 'turnstile']
    })
  })

  it('warns about a partially-configured integration and still reports it as not configured', async () => {
    process.env.CLOUDINARY_CLOUD_NAME = 'demo'
    process.env.CLOUDINARY_API_KEY = 'demo-key'
    // CLOUDINARY_API_SECRET intentionally left unset.
    const { logStartupConfigSummary } = await import('./config.js')
    logStartupConfigSummary()
    expect(logWarn).toHaveBeenCalledWith('startup_config_partial_warning', {
      integration: 'cloudinary',
      missingVars: ['CLOUDINARY_API_SECRET']
    })
    expect(logEvent).toHaveBeenCalledWith('startup_config_summary', {
      configured: [],
      notConfigured: ['cloudinary', 'whatsapp', 'whatsapp_order_confirmation', 'whatsapp_delivery_webhook', 'web_push', 'email', 'turnstile']
    })
  })

  // مثال دقيق على متطلبات المهمة: التوكن ورقم الهاتف متضبطين (واتساب نفسه شغال للإرسال
  // اليدوي) لكن اسم قالب تأكيد الطلب المعتمد من Meta لسه ناقص — لازم يترجع "غير مكتمل"
  // (whatsapp_order_confirmation في notConfigured) مع تحذير واضح، مش "مكتمل بالكامل".
  it('reports whatsapp_order_confirmation as partial when the template name is missing', async () => {
    process.env.WHATSAPP_ACCESS_TOKEN = 'test-token'
    process.env.WHATSAPP_PHONE_NUMBER_ID = 'test-phone-id'
    const { logStartupConfigSummary } = await import('./config.js')
    logStartupConfigSummary()
    expect(logWarn).toHaveBeenCalledWith('startup_config_partial_warning', {
      integration: 'whatsapp_order_confirmation',
      missingVars: ['WHATSAPP_ORDER_CONFIRMATION_TEMPLATE']
    })
    expect(logEvent).toHaveBeenCalledWith('startup_config_summary', {
      configured: ['whatsapp'],
      notConfigured: ['cloudinary', 'whatsapp_order_confirmation', 'whatsapp_delivery_webhook', 'web_push', 'email', 'turnstile']
    })
  })

  it('reports whatsapp_order_confirmation as configured once all three variables are set', async () => {
    process.env.WHATSAPP_ACCESS_TOKEN = 'test-token'
    process.env.WHATSAPP_PHONE_NUMBER_ID = 'test-phone-id'
    process.env.WHATSAPP_ORDER_CONFIRMATION_TEMPLATE = 'order_confirmation_ar'
    const { logStartupConfigSummary } = await import('./config.js')
    logStartupConfigSummary()
    expect(logEvent).toHaveBeenCalledWith('startup_config_summary', {
      configured: ['whatsapp', 'whatsapp_order_confirmation'],
      notConfigured: ['cloudinary', 'whatsapp_delivery_webhook', 'web_push', 'email', 'turnstile']
    })
    expect(logWarn).not.toHaveBeenCalled()
  })
})
