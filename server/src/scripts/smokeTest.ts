// اختبار دخان (smoke test) بعد كل نشر — بيتحقق من إن أهم المسارات شغالة فعلاً على السيرفر
// الحي، من غير ما يعدّل أي بيانات حقيقية. يُشغَّل يدوياً بعد النشر، أو من الـ CI ضد بيئة
// staging لو اتضافت مستقبلاً. مش بديل عن اختبارات vitest — بيتحقق من endpoints حقيقية عبر
// HTTP فعلي، مش من الكود مباشرة.
export {}

const BASE_URL = process.env.SMOKE_TEST_URL ?? 'http://localhost:8787'

interface Check {
  name: string
  run: () => Promise<void>
}

async function expectStatus(path: string, expected: number, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${BASE_URL}${path}`, init)
  if (res.status !== expected) {
    throw new Error(`${path}: expected status ${expected}, got ${res.status}`)
  }
  return res
}

const checks: Check[] = [
  {
    name: 'GET /health returns 200 with status ok',
    run: async () => {
      const res = await expectStatus('/health', 200)
      const body = await res.json() as { status?: string }
      if (body.status !== 'ok') throw new Error(`unexpected /health body: ${JSON.stringify(body)}`)
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
    name: 'GET /api/settings returns 200',
    run: async () => {
      await expectStatus('/api/settings', 200)
    }
  }
]

let failures = 0
for (const check of checks) {
  try {
    await check.run()
    console.log(`✓ ${check.name}`)
  } catch (err) {
    failures++
    console.error(`✗ ${check.name}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

if (failures > 0) {
  console.error(`\n${failures}/${checks.length} smoke test(s) failed against ${BASE_URL}`)
  process.exit(1)
}
console.log(`\nAll ${checks.length} smoke tests passed against ${BASE_URL}`)
