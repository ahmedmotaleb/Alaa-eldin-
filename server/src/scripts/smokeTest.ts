// اختبار دخان (smoke test) بعد كل نشر — بيتحقق من إن أهم المسارات شغالة فعلاً على السيرفر
// الحي، من غير ما يعدّل أي بيانات حقيقية. يُشغَّل يدوياً بعد النشر، أو من الـ CI ضد بيئة
// staging لو اتضافت مستقبلاً. مش بديل عن اختبارات vitest — بيتحقق من endpoints حقيقية عبر
// HTTP فعلي، مش من الكود مباشرة.
//
// الفحوصات المصادَق عليها (قسم "authenticated smoke") اختيارية تماماً — بتتفعّل بس لو
// SMOKE_TEST_CUSTOMER_EMAIL/PASSWORD أو SMOKE_TEST_ADMIN_EMAIL/PASSWORD متضبوطين، وهي
// بيانات اختبار مخصصة (لازم تتعمل يدوياً على بيئة الإنتاج، مش حساب عميل حقيقي) — أبداً
// من غير ما تتحط في الكود أو تتكتب هنا. من غير الإعداد ده، الفحوصات دي بتتسجّل كـ
// "SKIPPED" صراحة، مش بتفشل ومش بتتجاهل بصمت.
export {}

const BASE_URL = process.env.SMOKE_TEST_URL ?? 'http://localhost:8787'
const CUSTOMER_EMAIL = process.env.SMOKE_TEST_CUSTOMER_EMAIL
const CUSTOMER_PASSWORD = process.env.SMOKE_TEST_CUSTOMER_PASSWORD
const ADMIN_EMAIL = process.env.SMOKE_TEST_ADMIN_EMAIL
const ADMIN_PASSWORD = process.env.SMOKE_TEST_ADMIN_PASSWORD

interface Check {
  name: string
  run: () => Promise<void>
  skipReason?: () => string | null
}

async function expectStatus(path: string, expected: number, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${BASE_URL}${path}`, init)
  if (res.status !== expected) {
    throw new Error(`${path}: expected status ${expected}, got ${res.status}`)
  }
  return res
}

// بيسحب أول Set-Cookie فعلي من رد تسجيل الدخول عشان يُستخدم في نداءات مصادَق عليها تالية —
// fetch مش زي المتصفح، مش بيحتفظ بالكوكيز تلقائياً بين نداءات منفصلة.
function extractSessionCookie(res: Response): string | null {
  const raw = res.headers.get('set-cookie')
  if (!raw) return null
  return raw.split(';')[0]
}

async function login(email: string, password: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  })
  if (res.status !== 200) throw new Error(`login for ${email}: expected status 200, got ${res.status}`)
  const cookie = extractSessionCookie(res)
  if (!cookie) throw new Error(`login for ${email}: no session cookie in response`)
  return cookie
}

const SENSITIVE_PATHS = ['/.env', '/.git/config', '/server/', '/backup/', '/logs/']

const checks: Check[] = [
  {
    name: 'GET /health returns 200 with status ok (no database details exposed)',
    run: async () => {
      const res = await expectStatus('/health', 200)
      const body = await res.json() as Record<string, unknown>
      if (body.status !== 'ok') throw new Error(`unexpected /health body: ${JSON.stringify(body)}`)
      const bodyText = JSON.stringify(body).toLowerCase()
      for (const forbidden of ['password', 'database_url', 'connectionstring']) {
        if (bodyText.includes(forbidden)) throw new Error(`/health body leaks sensitive detail: ${forbidden}`)
      }
    }
  },
  {
    name: 'GET / (homepage) returns 200 HTML',
    run: async () => {
      const res = await expectStatus('/', 200)
      const contentType = res.headers.get('content-type') ?? ''
      if (!contentType.includes('text/html')) throw new Error(`unexpected homepage content-type: ${contentType}`)
      const body = await res.text()
      if (!/<!doctype html>/i.test(body)) throw new Error('homepage response does not look like an HTML document')
    }
  },
  {
    name: 'GET /admin/login (Admin login page) returns 200 HTML',
    run: async () => {
      const res = await expectStatus('/admin/login', 200)
      const contentType = res.headers.get('content-type') ?? ''
      if (!contentType.includes('text/html')) throw new Error(`unexpected /admin/login content-type: ${contentType}`)
    }
  },
  {
    name: 'GET /api/products returns 200 with a products array',
    run: async () => {
      const res = await expectStatus('/api/products', 200)
      const body = await res.json() as { products?: unknown }
      if (!Array.isArray(body.products)) throw new Error(`unexpected /api/products body: ${JSON.stringify(body)}`)
    }
  },
  {
    name: 'GET /api/settings returns 200 (public settings only, no captcha secret)',
    run: async () => {
      const res = await expectStatus('/api/settings', 200)
      const body = await res.json() as Record<string, unknown>
      if (JSON.stringify(body).toLowerCase().includes('secret')) {
        throw new Error('/api/settings response unexpectedly mentions a secret')
      }
    }
  },
  {
    name: 'GET /api/auth/me without a session returns 401',
    run: async () => {
      await expectStatus('/api/auth/me', 401)
    }
  },
  {
    name: 'POST /api/auth/login with bad credentials returns 401',
    run: async () => {
      await expectStatus('/api/auth/login', 401, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'no-such-user@example.com', password: 'wrong-password' })
      })
    }
  },
  {
    name: 'GET /api/admin/security-status without a session returns 401 (unauthorized Admin API rejected)',
    run: async () => {
      await expectStatus('/api/admin/security-status', 401)
    }
  },
  {
    name: 'Security headers (Helmet) are present on API responses',
    run: async () => {
      const res = await fetch(`${BASE_URL}/api/products`)
      const missing = ['x-content-type-options', 'x-frame-options', 'strict-transport-security', 'content-security-policy']
        .filter(header => !res.headers.get(header))
      if (missing.length > 0) throw new Error(`missing security header(s): ${missing.join(', ')}`)
    }
  },
  {
    name: 'Production URL uses HTTPS',
    run: async () => {
      if (!BASE_URL.startsWith('https://')) {
        throw new Error(`SMOKE_TEST_URL is not HTTPS: ${BASE_URL} — this check only confirms the URL scheme, not certificate validity`)
      }
    }
  },
  ...SENSITIVE_PATHS.map((p): Check => ({
    name: `GET ${p} returns 404 (not the SPA shell, no info leak)`,
    run: async () => {
      const res = await fetch(`${BASE_URL}${p}`)
      if (res.status !== 404) throw new Error(`${p}: expected status 404, got ${res.status}`)
      const body = await res.text()
      if (/<!doctype html>/i.test(body)) throw new Error(`${p}: returned the SPA shell instead of a generic 404`)
    }
  })),
  {
    name: 'AUTHENTICATED: customer login + account + rewards + order history',
    skipReason: () => (CUSTOMER_EMAIL && CUSTOMER_PASSWORD ? null : 'no SMOKE_TEST_CUSTOMER_EMAIL/PASSWORD configured'),
    run: async () => {
      const cookie = await login(CUSTOMER_EMAIL!, CUSTOMER_PASSWORD!)
      const headers = { Cookie: cookie }
      const me = await fetch(`${BASE_URL}/api/auth/me`, { headers })
      if (me.status !== 200) throw new Error(`/api/auth/me: expected status 200, got ${me.status}`)
      const rewards = await fetch(`${BASE_URL}/api/loyalty`, { headers })
      if (rewards.status !== 200) throw new Error(`/api/loyalty: expected status 200, got ${rewards.status}`)
      const orders = await fetch(`${BASE_URL}/api/orders`, { headers })
      if (orders.status !== 200) throw new Error(`/api/orders: expected status 200, got ${orders.status}`)
    }
  },
  {
    name: 'AUTHENTICATED: Admin login + dashboard security-status API',
    skipReason: () => (ADMIN_EMAIL && ADMIN_PASSWORD ? null : 'no SMOKE_TEST_ADMIN_EMAIL/PASSWORD configured'),
    run: async () => {
      const cookie = await login(ADMIN_EMAIL!, ADMIN_PASSWORD!)
      const headers = { Cookie: cookie }
      const status = await fetch(`${BASE_URL}/api/admin/security-status`, { headers })
      if (status.status !== 200) throw new Error(`/api/admin/security-status: expected status 200, got ${status.status}`)
      const body = await status.json() as Record<string, unknown>
      if (JSON.stringify(body).toLowerCase().includes('secret')) {
        throw new Error('/api/admin/security-status response unexpectedly mentions a secret')
      }
    }
  }
]

let failures = 0
let skipped = 0
for (const check of checks) {
  const reason = check.skipReason?.()
  if (reason) {
    skipped++
    console.log(`○ ${check.name}: SKIPPED — ${reason}`)
    continue
  }
  try {
    await check.run()
    console.log(`✓ ${check.name}`)
  } catch (err) {
    failures++
    console.error(`✗ ${check.name}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

const ran = checks.length - skipped
console.log(`\n${ran - failures}/${ran} smoke test(s) passed against ${BASE_URL} (${skipped} skipped)`)
if (failures > 0) {
  console.error(`${failures} smoke test(s) FAILED`)
  process.exit(1)
}
