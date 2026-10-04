// اختبارات HTTP حقيقية لرفع/استبدال صورة البانر (POST/DELETE /api/admin/banners/:id/image)
// تحت Cloudinary "مُفعّل فعلياً" — نفس أسلوب adminCategoriesImages.test.ts بالظبط. بيغطّي
// المتغيّرين (desktop/mobile) اللي بيتخزّنوا في عمودين منفصلين، كل واحد له رفع/استبدال/حذف
// مستقل تماماً عن التاني.
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

process.env.CLOUDINARY_CLOUD_NAME = 'test-cloud'
process.env.CLOUDINARY_API_KEY = 'test-key'
process.env.CLOUDINARY_API_SECRET = 'test-secret'

const uploadStreamMock = vi.fn()
const destroyMock = vi.fn().mockResolvedValue({})

vi.mock('cloudinary', () => ({
  v2: {
    config: vi.fn(),
    uploader: { upload_stream: uploadStreamMock, destroy: destroyMock },
    api: { ping: vi.fn() }
  }
}))

const { app } = await import('../app.js')
const { pool } = await import('../db.js')

function mockUploadSuccess(publicId: string) {
  uploadStreamMock.mockImplementation((_options: unknown, callback: (err: unknown, res: unknown) => void) => {
    queueMicrotask(() => callback(null, { secure_url: `https://res.cloudinary.com/test-cloud/image/upload/${publicId}.webp`, public_id: publicId }))
    return { end: () => {} }
  })
}

const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])

const PREFIX = 'abnrimg-'
const STRONG_PASSWORD = 'CorrectHorse9'
let bannerId: number

function uniqueEmail(label: string): string {
  return `${PREFIX}${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`
}

async function adminAgent(): Promise<ReturnType<typeof request.agent>> {
  const agent = request.agent(app)
  const res = await agent.post('/api/auth/register').send({ email: uniqueEmail('admin'), password: STRONG_PASSWORD, fullName: 'مدير اختبار' })
  expect(res.status).toBe(201)
  await pool.query('UPDATE users SET is_admin = 1, role = $2, role_id = NULL WHERE id = $1', [res.body.user.id, 'admin'])
  return agent
}

async function resetFixtures() {
  await pool.query(`DELETE FROM banners WHERE title = 'بانر اختبار الصور'`)
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO banners (kicker, title, note, emoji, alt_text, cta_label, link, active, sort_order, created_at, placement)
     VALUES ('', 'بانر اختبار الصور', '', '🧪', '', 'تسوق', '/', 1, 0, now(), 'hero') RETURNING id`
  )
  bannerId = rows[0].id
}

beforeEach(async () => {
  vi.clearAllMocks()
  destroyMock.mockResolvedValue({})
  await resetFixtures()
})

afterAll(async () => {
  await pool.query(`DELETE FROM banners WHERE title = 'بانر اختبار الصور'`)
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${PREFIX}%`])
  await pool.end()
})

describe('POST /api/admin/banners/:id/image (desktop)', () => {
  it('replacing the desktop image updates the DB to the new URL and deletes the old Cloudinary asset', async () => {
    mockUploadSuccess('bnr-old-key')
    const agent = await adminAgent()
    const first = await agent.post(`/api/admin/banners/${bannerId}/image`).attach('image', JPEG_BYTES, { filename: 'old.jpg', contentType: 'image/jpeg' })
    expect(first.status).toBe(200)
    expect(destroyMock).not.toHaveBeenCalled()

    mockUploadSuccess('bnr-new-key')
    const second = await agent.post(`/api/admin/banners/${bannerId}/image`).attach('image', JPEG_BYTES, { filename: 'new.jpg', contentType: 'image/jpeg' })
    expect(second.status).toBe(200)
    expect(second.body.image).toContain('bnr-new-key')

    const { rows } = await pool.query<{ imageUrl: string }>('SELECT image_url as "imageUrl" FROM banners WHERE id = $1', [bannerId])
    expect(rows[0].imageUrl).toContain('bnr-new-key')
    expect(rows[0].imageUrl).not.toContain('bnr-old-key')
    expect(destroyMock).toHaveBeenCalledWith('bnr-old-key', { resource_type: 'image' })
  })

  it('cleans up the new orphan asset and keeps the old image when the DB update fails after upload', async () => {
    mockUploadSuccess('bnr-kept-key')
    const agent = await adminAgent()
    await agent.post(`/api/admin/banners/${bannerId}/image`).attach('image', JPEG_BYTES, { filename: 'kept.jpg', contentType: 'image/jpeg' })

    mockUploadSuccess('bnr-orphan-key')
    const realQuery = pool.query.bind(pool)
    const querySpy = vi.spyOn(pool, 'query').mockImplementation((text: unknown, params?: unknown) => {
      if (typeof text === 'string' && text.includes('UPDATE banners SET image_url')) {
        return Promise.reject(new Error('simulated db failure'))
      }
      return realQuery(text as never, params as never)
    })

    const res = await agent.post(`/api/admin/banners/${bannerId}/image`).attach('image', JPEG_BYTES, { filename: 'orphan.jpg', contentType: 'image/jpeg' })
    expect(res.status).toBe(500)
    querySpy.mockRestore()

    expect(destroyMock).toHaveBeenCalledWith('bnr-orphan-key', { resource_type: 'image' })

    const { rows } = await pool.query<{ imageUrl: string }>('SELECT image_url as "imageUrl" FROM banners WHERE id = $1', [bannerId])
    expect(rows[0].imageUrl).toContain('bnr-kept-key')
  })

  it('returns banner_not_found for a non-existent banner', async () => {
    mockUploadSuccess('irrelevant')
    const agent = await adminAgent()
    const res = await agent.post('/api/admin/banners/999999/image').attach('image', JPEG_BYTES, { filename: 'photo.jpg', contentType: 'image/jpeg' })
    expect(res.status).toBe(404)
    expect(res.body.error).toBe('banner_not_found')
  })
})

describe('POST /api/admin/banners/:id/image?variant=mobile', () => {
  it('replacing the mobile image only touches mobile_image_url, leaving the desktop image untouched', async () => {
    mockUploadSuccess('bnr-desktop-key')
    const agent = await adminAgent()
    await agent.post(`/api/admin/banners/${bannerId}/image`).attach('image', JPEG_BYTES, { filename: 'desktop.jpg', contentType: 'image/jpeg' })

    mockUploadSuccess('bnr-mobile-old-key')
    await agent.post(`/api/admin/banners/${bannerId}/image?variant=mobile`).attach('image', JPEG_BYTES, { filename: 'mobile-old.jpg', contentType: 'image/jpeg' })

    mockUploadSuccess('bnr-mobile-new-key')
    const res = await agent.post(`/api/admin/banners/${bannerId}/image?variant=mobile`).attach('image', JPEG_BYTES, { filename: 'mobile-new.jpg', contentType: 'image/jpeg' })
    expect(res.status).toBe(200)
    expect(destroyMock).toHaveBeenCalledWith('bnr-mobile-old-key', { resource_type: 'image' })
    expect(destroyMock).not.toHaveBeenCalledWith('bnr-desktop-key', expect.anything())

    const { rows } = await pool.query<{ imageUrl: string, mobileImageUrl: string }>(
      'SELECT image_url as "imageUrl", mobile_image_url as "mobileImageUrl" FROM banners WHERE id = $1', [bannerId]
    )
    expect(rows[0].imageUrl).toContain('bnr-desktop-key')
    expect(rows[0].mobileImageUrl).toContain('bnr-mobile-new-key')
  })
})

describe('DELETE /api/admin/banners/:id/image', () => {
  it('clears the DB column and deletes the remote asset', async () => {
    mockUploadSuccess('bnr-to-delete-key')
    const agent = await adminAgent()
    await agent.post(`/api/admin/banners/${bannerId}/image`).attach('image', JPEG_BYTES, { filename: 'photo.jpg', contentType: 'image/jpeg' })

    const res = await agent.delete(`/api/admin/banners/${bannerId}/image`)
    expect(res.status).toBe(204)
    expect(destroyMock).toHaveBeenCalledWith('bnr-to-delete-key', { resource_type: 'image' })

    const { rows } = await pool.query<{ imageUrl: string | null }>('SELECT image_url as "imageUrl" FROM banners WHERE id = $1', [bannerId])
    expect(rows[0].imageUrl).toBeNull()
  })
})
