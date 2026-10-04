// اختبارات HTTP حقيقية لرفع/استبدال صورة القسم (POST/DELETE /api/admin/categories/:id/image)
// تحت Cloudinary "مُفعّل فعلياً" — نفس أسلوب adminProductImagesConfigured.test.ts بالظبط
// (vi.mock('cloudinary')، مفيش أي اتصال حقيقي بأي مزوّد تخزين هنا).
//
// التركيز هنا على سلسلة "الاستبدال" نفسها: رفع صورة جديدة -> تحديث القاعدة بالقيمة الجديدة
// فوراً -> حذف الصورة القديمة من Cloudinary بعد نجاح كل ما سبق، وعلى حماية حالة فشل تحديث
// القاعدة بعد رفع ناجح (لازم الملف البعيد اليتيم يتحذف، والصورة القديمة تفضل كما هي).
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

const PREFIX = 'acatimg-'
const STRONG_PASSWORD = 'CorrectHorse9'
const CATEGORY_ID = `${PREFIX}cat`

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
  await pool.query('DELETE FROM categories WHERE id = $1', [CATEGORY_ID])
  await pool.query(
    `INSERT INTO categories (id, name, emoji, tint, sort_order) VALUES ($1, 'فئة اختبار الصور', '🧪', '#fff', 1)`,
    [CATEGORY_ID]
  )
}

beforeEach(async () => {
  vi.clearAllMocks()
  destroyMock.mockResolvedValue({})
  await resetFixtures()
})

afterAll(async () => {
  await pool.query('DELETE FROM categories WHERE id = $1', [CATEGORY_ID])
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${PREFIX}%`])
  await pool.end()
})

describe('POST /api/admin/categories/:id/image', () => {
  it('uploads a first image and stores its URL', async () => {
    mockUploadSuccess('cat-first-key')
    const agent = await adminAgent()
    const res = await agent.post(`/api/admin/categories/${CATEGORY_ID}/image`).attach('image', JPEG_BYTES, { filename: 'photo.jpg', contentType: 'image/jpeg' })
    expect(res.status).toBe(200)
    expect(res.body.image).toContain('cat-first-key')

    const { rows } = await pool.query<{ imageUrl: string }>('SELECT image_url as "imageUrl" FROM categories WHERE id = $1', [CATEGORY_ID])
    expect(rows[0].imageUrl).toContain('cat-first-key')
  })

  // جوهر البلاغ: استبدال صورة قسم مرفوعة فعلاً لازم يحدّث القاعدة بالرابط الجديد فوراً
  // (مش يفضل الرابط القديم أبداً)، ويمسح الأصل القديم من Cloudinary بعد نجاح كل خطوة سابقة.
  it('replacing an existing image updates the DB to the new URL and deletes the old Cloudinary asset', async () => {
    mockUploadSuccess('cat-old-key')
    const agent = await adminAgent()
    const first = await agent.post(`/api/admin/categories/${CATEGORY_ID}/image`).attach('image', JPEG_BYTES, { filename: 'old.jpg', contentType: 'image/jpeg' })
    expect(first.status).toBe(200)
    expect(destroyMock).not.toHaveBeenCalled()

    mockUploadSuccess('cat-new-key')
    const second = await agent.post(`/api/admin/categories/${CATEGORY_ID}/image`).attach('image', JPEG_BYTES, { filename: 'new.jpg', contentType: 'image/jpeg' })
    expect(second.status).toBe(200)
    expect(second.body.image).toContain('cat-new-key')
    expect(second.body.image).not.toContain('cat-old-key')

    const { rows } = await pool.query<{ imageUrl: string }>('SELECT image_url as "imageUrl" FROM categories WHERE id = $1', [CATEGORY_ID])
    expect(rows[0].imageUrl).toContain('cat-new-key')
    expect(rows[0].imageUrl).not.toContain('cat-old-key')
    expect(destroyMock).toHaveBeenCalledWith('cat-old-key', { resource_type: 'image' })
  })

  // لو نجح الرفع لـ Cloudinary بس فشل تحديث القاعدة بعده — الملف الجديد يتيم ولازم يتمسح،
  // والصورة القديمة (لو موجودة) تفضل هي المعتمدة من غير أي تغيير.
  it('cleans up the new orphan asset and keeps the old image when the DB update fails after upload', async () => {
    mockUploadSuccess('cat-kept-key')
    const agent = await adminAgent()
    const first = await agent.post(`/api/admin/categories/${CATEGORY_ID}/image`).attach('image', JPEG_BYTES, { filename: 'kept.jpg', contentType: 'image/jpeg' })
    expect(first.status).toBe(200)

    mockUploadSuccess('cat-orphan-key')
    const realQuery = pool.query.bind(pool)
    const querySpy = vi.spyOn(pool, 'query').mockImplementation((text: unknown, params?: unknown) => {
      if (typeof text === 'string' && text.includes('UPDATE categories SET image_url')) {
        return Promise.reject(new Error('simulated db failure'))
      }
      return realQuery(text as never, params as never)
    })

    const res = await agent.post(`/api/admin/categories/${CATEGORY_ID}/image`).attach('image', JPEG_BYTES, { filename: 'orphan.jpg', contentType: 'image/jpeg' })
    expect(res.status).toBe(500)
    querySpy.mockRestore()

    expect(destroyMock).toHaveBeenCalledWith('cat-orphan-key', { resource_type: 'image' })
    expect(destroyMock).not.toHaveBeenCalledWith('cat-kept-key', expect.anything())

    const { rows } = await pool.query<{ imageUrl: string }>('SELECT image_url as "imageUrl" FROM categories WHERE id = $1', [CATEGORY_ID])
    expect(rows[0].imageUrl).toContain('cat-kept-key')
  })

  it('returns category_not_found for a non-existent category', async () => {
    mockUploadSuccess('irrelevant')
    const agent = await adminAgent()
    const res = await agent.post('/api/admin/categories/does-not-exist/image').attach('image', JPEG_BYTES, { filename: 'photo.jpg', contentType: 'image/jpeg' })
    expect(res.status).toBe(404)
    expect(res.body.error).toBe('category_not_found')
  })
})

describe('DELETE /api/admin/categories/:id/image', () => {
  it('clears the DB column and deletes the remote asset', async () => {
    mockUploadSuccess('cat-to-delete-key')
    const agent = await adminAgent()
    await agent.post(`/api/admin/categories/${CATEGORY_ID}/image`).attach('image', JPEG_BYTES, { filename: 'photo.jpg', contentType: 'image/jpeg' })

    const res = await agent.delete(`/api/admin/categories/${CATEGORY_ID}/image`)
    expect(res.status).toBe(204)
    expect(destroyMock).toHaveBeenCalledWith('cat-to-delete-key', { resource_type: 'image' })

    const { rows } = await pool.query<{ imageUrl: string | null }>('SELECT image_url as "imageUrl" FROM categories WHERE id = $1', [CATEGORY_ID])
    expect(rows[0].imageUrl).toBeNull()
  })
})
