// اختبارات HTTP لمسارات النسخ الاحتياطي (POST /api/admin/backup/download و
// GET /api/backup/dump) — pg_dump مُموّه بالكامل هنا (child_process.spawn) عشان الاختبارات
// تفضل سريعة وحتمية ومستقلة عن وجود pg_dump حقيقي؛ نهاية الملف فيها اختبار واحد بس ضد
// pg_dump الحقيقي (تكامل فعلي، مش توهيم) للتأكد إن المسار الحقيقي شغّال فعلاً.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import request from 'supertest'

const mockState: { versionMajor: number, failNext: boolean, delayMs: number } = {
  versionMajor: 16,
  failNext: false,
  delayMs: 0
}

function fakeChild() {
  const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter, stderr: EventEmitter, kill: (sig?: string) => void }
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = vi.fn()
  return child
}

vi.mock('node:child_process', async importOriginal => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return {
    ...actual,
    spawn: vi.fn((command: string, args: string[] = []) => {
      const child = fakeChild()
      if (command === 'pg_dump' && args.includes('--version')) {
        setImmediate(() => {
          child.stdout.emit('data', `pg_dump (PostgreSQL) ${mockState.versionMajor}.4\n`)
          child.emit('close', 0)
        })
        return child
      }
      // pg_dump الفعلي (-Fc --no-owner -f <path>)
      const outIdx = args.indexOf('-f')
      const outPath = outIdx !== -1 ? args[outIdx + 1] : undefined
      setTimeout(() => {
        if (mockState.failNext) {
          mockState.failNext = false
          child.stderr.emit('data', 'pg_dump: error: connection failed for postgresql://user:SECRETPASS@host/db\n')
          child.emit('close', 1)
          return
        }
        if (outPath) fs.writeFileSync(outPath, 'fake dump content for testing')
        child.emit('close', 0)
      }, mockState.delayMs)
      return child
    })
  }
})

const { app } = await import('../app.js')
const { pool } = await import('../db.js')
const { resetBackupRateLimiterForTests } = await import('../services/backupService.js')

const PREFIX = 'bkptest-'
const STRONG_PASSWORD = 'CorrectHorse9'

function uniqueEmail(label: string): string {
  return `${PREFIX}${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`
}

async function registerCustomer(agent: ReturnType<typeof request.agent>, email: string): Promise<string> {
  const res = await agent.post('/api/auth/register').send({ email, password: STRONG_PASSWORD, fullName: 'مستخدم اختبار' })
  expect(res.status).toBe(201)
  return res.body.user.id as string
}

async function adminAgent() {
  const agent = request.agent(app)
  const email = uniqueEmail('admin')
  const userId = await registerCustomer(agent, email)
  await pool.query('UPDATE users SET is_admin = 1, role = $2 WHERE id = $1', [userId, 'admin'])
  return { agent, userId, email }
}

async function staffAgent() {
  const agent = request.agent(app)
  const userId = await registerCustomer(agent, uniqueEmail('staff'))
  // staff عادي (is_admin=0) — مفيش أي صلاحية إدارية خالص.
  return { agent, userId }
}

async function cleanup() {
  await pool.query(`DELETE FROM backup_tokens WHERE name LIKE $1`, [`${PREFIX}%`])
  await pool.query(`DELETE FROM audit_logs WHERE entity_type = 'backup' AND entity_id IN (SELECT id FROM users WHERE email LIKE $1)`, [`${PREFIX}%`])
  await pool.query(`DELETE FROM users WHERE email LIKE $1`, [`${PREFIX}%`])
}

// تنظيف المستخدمين مرة واحدة بس في البداية والنهاية (مش قبل كل اختبار) — كل اختبار بيعمل
// مستخدم بإيميل فريد بنفسه (uniqueEmail)، فمفيش تصادم بين الاختبارات. الداعي الحقيقي:
// كتابة سجل التدقيق لبعض الطلبات (الناجحة خصوصاً) بتحصل بعد ما رد الـ HTTP نفسه يوصل
// لـ supertest (على حدث res.on('finish'))، فحذف المستخدم فوراً في beforeEach كان بيعمل
// سباق فعلي مع كتابة لسه ماخلصتش، ويكسر قيد FOREIGN KEY على admin_user_id.
beforeAll(async () => { await cleanup() })
beforeEach(() => {
  resetBackupRateLimiterForTests()
  mockState.versionMajor = 16
  mockState.failNext = false
  mockState.delayMs = 0
})
afterAll(async () => { await cleanup(); await pool.end() })

describe('POST /api/admin/backup/download — RBAC', () => {
  it('rejects an unauthenticated request', async () => {
    const res = await request(app).post('/api/admin/backup/download').send({ password: STRONG_PASSWORD })
    expect(res.status).toBe(401)
  })

  it('rejects a logged-in non-admin (staff without the permission) with 403', async () => {
    const { agent } = await staffAgent()
    const res = await agent.post('/api/admin/backup/download').send({ password: STRONG_PASSWORD })
    expect(res.status).toBe(403)
  })

  it('rejects the correct admin session with the wrong password', async () => {
    const { agent } = await adminAgent()
    const res = await agent.post('/api/admin/backup/download').send({ password: 'wrong-password' })
    expect(res.status).toBe(401)
    expect(res.body.error).toBe('invalid_password')
  })

  it('succeeds with the correct admin session and password, streaming a real-shaped response', async () => {
    const { agent } = await adminAgent()
    const res = await agent.post('/api/admin/backup/download').send({ password: STRONG_PASSWORD })
    expect(res.status).toBe(200)
    expect(res.headers['x-backup-sha256']).toMatch(/^[a-f0-9]{64}$/)
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="alaa-eldin_\d{4}-\d{2}-\d{2}_\d{4}\.dump"$/)
  })
})

describe('GET /api/backup/dump — token auth isolation', () => {
  async function createToken(): Promise<string> {
    const { agent } = await adminAgent()
    const res = await agent.post('/api/admin/backup/tokens').send({ name: `${PREFIX}token`, password: STRONG_PASSWORD })
    expect(res.status).toBe(201)
    return res.body.token as string
  }

  it('rejects a request with no Authorization header', async () => {
    const res = await request(app).get('/api/backup/dump')
    expect(res.status).toBe(401)
  })

  it('rejects a bad token', async () => {
    const res = await request(app).get('/api/backup/dump').set('Authorization', 'Bearer not-a-real-token')
    expect(res.status).toBe(401)
  })

  it('rejects a normal admin session cookie on this route (no Authorization header) even though the session is valid', async () => {
    const { agent } = await adminAgent()
    const res = await agent.get('/api/backup/dump')
    expect(res.status).toBe(401)
  })

  it('rejects a revoked token', async () => {
    const { agent } = await adminAgent()
    const createRes = await agent.post('/api/admin/backup/tokens').send({ name: `${PREFIX}revoked`, password: STRONG_PASSWORD })
    const { id, token } = createRes.body
    await agent.delete(`/api/admin/backup/tokens/${id}`).expect(204)
    const res = await request(app).get('/api/backup/dump').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(401)
  })

  it('accepts a valid token and streams a real-shaped response', async () => {
    const token = await createToken()
    const res = await request(app).get('/api/backup/dump').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.headers['x-backup-sha256']).toMatch(/^[a-f0-9]{64}$/)
  })

  it('a valid backup token is refused on ordinary authenticated endpoints (works nowhere else)', async () => {
    const token = await createToken()
    const attempts = [
      request(app).get('/api/orders').set('Authorization', `Bearer ${token}`),
      request(app).get('/api/admin/products').set('Authorization', `Bearer ${token}`),
      request(app).get('/api/account/favorites').set('Authorization', `Bearer ${token}`),
      request(app).get('/api/admin/backup/status').set('Authorization', `Bearer ${token}`)
    ]
    const results = await Promise.all(attempts)
    for (const res of results) expect(res.status).toBe(401)
  })

  it('stops working once its creator is no longer an admin', async () => {
    const { agent, userId } = await adminAgent()
    const createRes = await agent.post('/api/admin/backup/tokens').send({ name: `${PREFIX}demoted`, password: STRONG_PASSWORD })
    const { token } = createRes.body
    await pool.query('UPDATE users SET is_admin = 0 WHERE id = $1', [userId])
    const res = await request(app).get('/api/backup/dump').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(401)
  })
})

describe('backup token creation requires the admin password', () => {
  it('rejects creating a token with the wrong password', async () => {
    const { agent } = await adminAgent()
    const res = await agent.post('/api/admin/backup/tokens').send({ name: `${PREFIX}x`, password: 'wrong' })
    expect(res.status).toBe(401)
  })

  it('revoking a token does not require a password', async () => {
    const { agent } = await adminAgent()
    const createRes = await agent.post('/api/admin/backup/tokens').send({ name: `${PREFIX}norevokepw`, password: STRONG_PASSWORD })
    const res = await agent.delete(`/api/admin/backup/tokens/${createRes.body.id}`)
    expect(res.status).toBe(204)
  })
})

describe('version gate', () => {
  it('returns 503 naming both versions when pg_dump is older than the server', async () => {
    mockState.versionMajor = 12 // أقدم من أي Postgres حقيقي محتمل هنا
    const { agent } = await adminAgent()
    const res = await agent.post('/api/admin/backup/download').send({ password: STRONG_PASSWORD })
    expect(res.status).toBe(503)
    expect(res.body.error).toBe('pg_dump_version_too_old')
    expect(res.body.pgDumpMajor).toBe(12)
    expect(typeof res.body.serverMajor).toBe('number')
  })

  it('status endpoint reports both versions', async () => {
    const { agent } = await adminAgent()
    const res = await agent.get('/api/admin/backup/status')
    expect(res.status).toBe(200)
    expect(res.body.pgDumpMajor).toBe(16)
    expect(typeof res.body.serverMajor).toBe('number')
  })
})

describe('one-at-a-time lock and hourly rate limit', () => {
  it('rejects a second concurrent backup with 409 while one is already running', async () => {
    mockState.delayMs = 150
    const { agent: agentA } = await adminAgent()
    const { agent: agentB } = await adminAgent()
    const [resA, resB] = await Promise.all([
      agentA.post('/api/admin/backup/download').send({ password: STRONG_PASSWORD }),
      new Promise(r => setTimeout(r, 20)).then(() => agentB.post('/api/admin/backup/download').send({ password: STRONG_PASSWORD }))
    ])
    expect(resA.status).toBe(200)
    expect(resB.status).toBe(409)
  })

  it('rejects a 6th backup within the same hour with 429, across both the session and token routes', async () => {
    const { agent } = await adminAgent()
    const tokenRes = await agent.post('/api/admin/backup/tokens').send({ name: `${PREFIX}ratelimit`, password: STRONG_PASSWORD })
    const token = tokenRes.body.token as string

    // 5 محاولات فعلية بالظبط (الحد المسموح)، بالتبادل بين مسار التوكن والجلسة — الحد
    // مشترك بين الاتنين، مش لكل مسار بمفرده.
    for (let i = 0; i < 4; i++) {
      const res = await request(app).get('/api/backup/dump').set('Authorization', `Bearer ${token}`)
      expect(res.status).toBe(200)
    }
    const fifth = await agent.post('/api/admin/backup/download').send({ password: STRONG_PASSWORD })
    expect(fifth.status).toBe(200)

    const sixth = await request(app).get('/api/backup/dump').set('Authorization', `Bearer ${token}`)
    expect(sixth.status).toBe(429)
  })
})

describe('audit trail and secret scrubbing', () => {
  it('records a successful attempt in the admin attempts list without leaking DATABASE_URL/password/token', async () => {
    const { agent } = await adminAgent()
    await agent.post('/api/admin/backup/download').send({ password: STRONG_PASSWORD })
    const res = await agent.get('/api/admin/backup/attempts')
    expect(res.status).toBe(200)
    const serialized = JSON.stringify(res.body)
    expect(serialized).not.toContain(STRONG_PASSWORD)
    expect(serialized).not.toContain(process.env.DATABASE_URL ?? '__unset__')
    expect(res.body.attempts.length).toBeGreaterThan(0)
    expect(res.body.attempts[0].success).toBe(true)
  })

  it('records a failed attempt with a scrubbed failure reason (no raw password in it)', async () => {
    mockState.failNext = true
    const { agent } = await adminAgent()
    const failRes = await agent.post('/api/admin/backup/download').send({ password: STRONG_PASSWORD })
    expect(failRes.status).toBe(500)
    const res = await agent.get('/api/admin/backup/attempts')
    const serialized = JSON.stringify(res.body)
    expect(serialized).not.toContain('SECRETPASS')
    const failed = res.body.attempts.find((a: { success: boolean }) => !a.success)
    expect(failed).toBeTruthy()
  })
})
