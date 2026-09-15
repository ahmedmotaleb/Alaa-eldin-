import { afterEach, describe, expect, it, vi } from 'vitest'

const logEvent = vi.fn()
const logWarn = vi.fn()
vi.mock('./logger.js', () => ({ logEvent: (...args: unknown[]) => logEvent(...args), logWarn: (...args: unknown[]) => logWarn(...args) }))

const ENV_VARS = [
  'CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET',
  'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID',
  'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY',
  'RESEND_API_KEY'
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
      notConfigured: ['cloudinary', 'whatsapp', 'web_push', 'email']
    })
    expect(logWarn).not.toHaveBeenCalled()
  })

  it('reports an integration as configured only when all of its required vars are set', async () => {
    process.env.RESEND_API_KEY = 'test-key'
    const { logStartupConfigSummary } = await import('./config.js')
    logStartupConfigSummary()
    expect(logEvent).toHaveBeenCalledWith('startup_config_summary', {
      configured: ['email'],
      notConfigured: ['cloudinary', 'whatsapp', 'web_push']
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
      notConfigured: ['cloudinary', 'whatsapp', 'web_push', 'email']
    })
  })
})
