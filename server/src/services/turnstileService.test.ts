// اختبار وحدة كامل على turnstileService — بيغطي كل الحالات المطلوبة صراحة: توكن ناقص،
// تحقق ناجح، توكن غير صالح (بيغطي كمان توكن منتهي/مُعاد استخدامه، لأن Cloudflare بترجعهم
// كلهم بنفس success:false)، تايم آوت المزوّد، خطأ شبكة، رد غير مفهوم من المزوّد.
// مفيش أي اتصال حقيقي بـ Cloudflare هنا أبداً — fetch نفسها بتتقلّد (mock) بالكامل.
//
// turnstileConfigured/turnstileSiteKey بيتحسبوا مرة واحدة وقت تحميل الموديول (مش لكل نداء)،
// فأي اختبار محتاج قيمة بيئة مختلفة لازم يضبط process.env الأول، بعدين vi.resetModules()،
// بعدين import ديناميكي جديد — نفس الأسلوب المتّبع في config.test.ts وhttpSecurityProduction.test.ts.
import { afterEach, describe, expect, it, vi } from 'vitest'

const ORIGINAL_SITE_KEY = process.env.TURNSTILE_SITE_KEY
const ORIGINAL_SECRET_KEY = process.env.TURNSTILE_SECRET_KEY

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.resetModules()
  if (ORIGINAL_SITE_KEY === undefined) delete process.env.TURNSTILE_SITE_KEY
  else process.env.TURNSTILE_SITE_KEY = ORIGINAL_SITE_KEY
  if (ORIGINAL_SECRET_KEY === undefined) delete process.env.TURNSTILE_SECRET_KEY
  else process.env.TURNSTILE_SECRET_KEY = ORIGINAL_SECRET_KEY
})

async function loadConfigured() {
  process.env.TURNSTILE_SITE_KEY = 'test-site-key'
  process.env.TURNSTILE_SECRET_KEY = 'test-secret-key'
  vi.resetModules()
  return import('./turnstileService.js')
}

async function loadUnconfigured() {
  delete process.env.TURNSTILE_SITE_KEY
  delete process.env.TURNSTILE_SECRET_KEY
  vi.resetModules()
  return import('./turnstileService.js')
}

describe('turnstileService — not configured', () => {
  it('reports not configured, exposes a null site key, and rejects verification without any network call', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { turnstileConfigured, turnstileSiteKey, verifyTurnstileToken } = await loadUnconfigured()

    expect(turnstileConfigured).toBe(false)
    expect(turnstileSiteKey).toBeNull()

    const result = await verifyTurnstileToken('any-token')
    expect(result).toEqual({ ok: false, reason: 'not_configured' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('turnstileService — configured', () => {
  it('exposes the public site key but never the secret key', async () => {
    const { turnstileConfigured, turnstileSiteKey } = await loadConfigured()
    expect(turnstileConfigured).toBe(true)
    expect(turnstileSiteKey).toBe('test-site-key')
    expect(turnstileSiteKey).not.toBe('test-secret-key')
  })

  it('rejects a missing token without contacting Cloudflare', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { verifyTurnstileToken } = await loadConfigured()

    expect(await verifyTurnstileToken(undefined)).toEqual({ ok: false, reason: 'missing_token' })
    expect(await verifyTurnstileToken(null)).toEqual({ ok: false, reason: 'missing_token' })
    expect(await verifyTurnstileToken('   ')).toEqual({ ok: false, reason: 'missing_token' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('accepts a token Cloudflare reports as valid, sending the secret (never the site key) to Cloudflare', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) })
    vi.stubGlobal('fetch', fetchMock)
    const { verifyTurnstileToken } = await loadConfigured()

    const result = await verifyTurnstileToken('valid-token', '1.2.3.4', 'req-1')
    expect(result).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify')
    expect(options.method).toBe('POST')
    const body = options.body as URLSearchParams
    expect(body.get('secret')).toBe('test-secret-key')
    expect(body.get('response')).toBe('valid-token')
    expect(body.get('remoteip')).toBe('1.2.3.4')
  })

  it('rejects a token Cloudflare reports as invalid (also covers expired and replayed tokens)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: false, 'error-codes': ['timeout-or-duplicate'] })
    })
    vi.stubGlobal('fetch', fetchMock)
    const { verifyTurnstileToken } = await loadConfigured()

    const result = await verifyTurnstileToken('replayed-or-expired-token')
    expect(result).toEqual({ ok: false, reason: 'invalid_token' })
  })

  it('fails closed on a provider network error', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'))
    vi.stubGlobal('fetch', fetchMock)
    const { verifyTurnstileToken } = await loadConfigured()

    const result = await verifyTurnstileToken('any-token')
    expect(result).toEqual({ ok: false, reason: 'provider_error' })
  })

  it('fails closed once the verification request exceeds the timeout', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn().mockImplementation((_url: string, options: RequestInit) =>
      new Promise((_resolve, reject) => {
        options.signal!.addEventListener('abort', () => {
          const err = new Error('This operation was aborted')
          err.name = 'AbortError'
          reject(err)
        })
      })
    )
    vi.stubGlobal('fetch', fetchMock)
    const { verifyTurnstileToken } = await loadConfigured()

    const resultPromise = verifyTurnstileToken('any-token')
    await vi.advanceTimersByTimeAsync(5000)
    const result = await resultPromise
    expect(result).toEqual({ ok: false, reason: 'provider_error' })
  })

  it('fails closed on a non-2xx HTTP response from the provider', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)
    const { verifyTurnstileToken } = await loadConfigured()

    const result = await verifyTurnstileToken('any-token')
    expect(result).toEqual({ ok: false, reason: 'provider_error' })
  })

  it('fails closed on a response body that cannot be parsed as JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => { throw new Error('invalid json') } })
    vi.stubGlobal('fetch', fetchMock)
    const { verifyTurnstileToken } = await loadConfigured()

    const result = await verifyTurnstileToken('any-token')
    expect(result).toEqual({ ok: false, reason: 'provider_error' })
  })

  it('fails closed on a well-formed JSON response missing the expected success field', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ unexpected: 'shape' }) })
    vi.stubGlobal('fetch', fetchMock)
    const { verifyTurnstileToken } = await loadConfigured()

    const result = await verifyTurnstileToken('any-token')
    expect(result).toEqual({ ok: false, reason: 'provider_error' })
  })
})
