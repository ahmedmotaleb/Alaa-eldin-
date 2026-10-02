// اختبارات HTTP حقيقية لرفع صور المنتجات (POST /api/admin/products/:id/images) تحت Cloudinary
// "مُفعّل فعلياً" (CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET مضبوطين وقت تحميل الموديول — نفس
// أسلوب httpSecurityProduction.test.ts: env var بيتحط قبل أول "await import('../app.js')" عشان
// imageStorageConfigured جوه imageStorageService.ts يتقيّم صح وقت التحميل). upload_stream نفسه
// بيتقلّد بالكامل (vi.mock('cloudinary'))، مفيش أي اتصال حقيقي بأي مزوّد تخزين هنا.
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

process.env.CLOUDINARY_CLOUD_NAME = 'test-cloud'
process.env.CLOUDINARY_API_KEY = 'test-key'
process.env.CLOUDINARY_API_SECRET = 'test-secret'

const uploadStreamMock = vi.fn()
const destroyMock = vi.fn().mockResolvedValue({})
const pingMock = vi.fn()

vi.mock('cloudinary', () => ({
  v2: {
    config: vi.fn(),
    uploader: { upload_stream: uploadStreamMock, destroy: destroyMock },
    api: { ping: pingMock }
  }
}))

const { app } = await import('../app.js')
const { pool } = await import('../db.js')
const productImageService = await import('../services/productImageService.js')
const { checkImageStorageConnection } = await import('../services/imageStorageService.js')

function mockUploadSuccess(publicId = 'mock-public-id') {
  uploadStreamMock.mockImplementation((_options: unknown, callback: (err: unknown, res: unknown) => void) => {
    queueMicrotask(() => callback(null, { secure_url: `https://res.cloudinary.com/test-cloud/image/upload/${publicId}.webp`, public_id: publicId }))
    return { end: () => {} }
  })
}

function mockUploadFailure(httpCode: number, message: string) {
  uploadStreamMock.mockImplementation((_options: unknown, callback: (err: unknown, res: unknown) => void) => {
    queueMicrotask(() => callback({ http_code: httpCode, message, name: 'Error' }, undefined))
    return { end: () => {} }
  })
}

const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const FAKE_SCRIPT = Buffer.from('#!/bin/bash\necho hi\n')
const HEIC_BYTES = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftyp'), Buffer.from('heic'), Buffer.from([0, 0, 0, 0])])

const PREFIX = 'aimgcfg-'
const STRONG_PASSWORD = 'CorrectHorse9'
const CATEGORY_ID = `${PREFIX}cat`
const PRODUCT_ID = `${PREFIX}prod`

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
  await pool.query('DELETE FROM product_images')
  await pool.query('DELETE FROM products WHERE id = $1', [PRODUCT_ID])
  await pool.query('DELETE FROM categories WHERE id = $1', [CATEGORY_ID])
  await pool.query(
    `INSERT INTO categories (id, name, emoji, tint, sort_order) VALUES ($1, 'فئة اختبار الرفع', '🧪', '#fff', 1)`,
    [CATEGORY_ID]
  )
  await pool.query(
    `INSERT INTO products (id, slug, category_id, name, description, price, cost, unit, emoji, available, stock, created_at)
     VALUES ($1, 'aimgcfg-product', $2, 'منتج اختبار رفع الصور', 'وصف', 10, 5, 'وحدة', '🧪', 1, 50, now())`,
    [PRODUCT_ID, CATEGORY_ID]
  )
}

beforeEach(async () => {
  vi.clearAllMocks()
  destroyMock.mockResolvedValue({})
  await resetFixtures()
})

afterAll(async () => {
  await pool.query('DELETE FROM product_images')
  await pool.query('DELETE FROM products WHERE id = $1', [PRODUCT_ID])
  await pool.query('DELETE FROM categories WHERE id = $1', [CATEGORY_ID])
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${PREFIX}%`])
  await pool.end()
})

describe('POST /api/admin/products/:id/images (Cloudinary configured, upload mocked)', () => {
  it('uploads a valid JPEG and inserts it into the database', async () => {
    mockUploadSuccess('jpeg-key')
    const agent = await adminAgent()
    const res = await agent.post(`/api/admin/products/${PRODUCT_ID}/images`).attach('image', JPEG_BYTES, { filename: 'photo.jpg', contentType: 'image/jpeg' })
    expect(res.status).toBe(201)
    expect(res.body.image.imageUrl).toContain('jpeg-key')
    expect(res.body.image.isPrimary).toBe(true)
  })

  it('uploads a valid PNG successfully', async () => {
    mockUploadSuccess('png-key')
    const agent = await adminAgent()
    const res = await agent.post(`/api/admin/products/${PRODUCT_ID}/images`).attach('image', PNG_BYTES, { filename: 'photo.png', contentType: 'image/png' })
    expect(res.status).toBe(201)
  })

  it('uploads a JPEG sent with the non-standard "image/jpg" mimetype (Android quirk)', async () => {
    mockUploadSuccess('android-jpg-key')
    const agent = await adminAgent()
    const res = await agent.post(`/api/admin/products/${PRODUCT_ID}/images`).attach('image', JPEG_BYTES, { filename: 'photo.jpg', contentType: 'image/jpg' })
    expect(res.status).toBe(201)
  })

  it('rejects a fake file with a spoofed image signature', async () => {
    const agent = await adminAgent()
    const res = await agent.post(`/api/admin/products/${PRODUCT_ID}/images`).attach('image', FAKE_SCRIPT, { filename: 'photo.jpg', contentType: 'image/jpeg' })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('invalid_file')
    expect(uploadStreamMock).not.toHaveBeenCalled()
  })

  it('rejects a HEIC file with a specific, distinguishable error code', async () => {
    const agent = await adminAgent()
    const res = await agent.post(`/api/admin/products/${PRODUCT_ID}/images`).attach('image', HEIC_BYTES, { filename: 'photo.heic', contentType: 'image/heic' })
    expect(res.status).toBe(415)
    expect(res.body.error).toBe('heic_not_supported')
    expect(uploadStreamMock).not.toHaveBeenCalled()
  })

  it('rejects a file over 5MB with a deterministic code', async () => {
    const bigFile = Buffer.concat([JPEG_BYTES, Buffer.alloc(5 * 1024 * 1024)])
    const agent = await adminAgent()
    const res = await agent.post(`/api/admin/products/${PRODUCT_ID}/images`).attach('image', bigFile, { filename: 'big.jpg', contentType: 'image/jpeg' })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('file_too_large')
  })

  it('rejects an unsupported file type deterministically', async () => {
    const agent = await adminAgent()
    const res = await agent.post(`/api/admin/products/${PRODUCT_ID}/images`).attach('image', Buffer.from('%PDF-1.4'), { filename: 'doc.pdf', contentType: 'application/pdf' })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('no_file_or_invalid_type')
  })

  it('returns product_not_found for a non-existent product', async () => {
    const agent = await adminAgent()
    const res = await agent.post('/api/admin/products/does-not-exist/images').attach('image', JPEG_BYTES, { filename: 'photo.jpg', contentType: 'image/jpeg' })
    expect(res.status).toBe(404)
    expect(res.body.error).toBe('product_not_found')
  })

  it('maps a real Cloudinary provider failure to upload_failed without throwing', async () => {
    mockUploadFailure(500, 'Internal error')
    const agent = await adminAgent()
    const res = await agent.post(`/api/admin/products/${PRODUCT_ID}/images`).attach('image', JPEG_BYTES, { filename: 'photo.jpg', contentType: 'image/jpeg' })
    expect(res.status).toBe(502)
    expect(res.body.error).toBe('upload_failed')
  })

  it('maps an invalid-credentials Cloudinary response (401) to upload_failed too, never leaking the reason to the client', async () => {
    mockUploadFailure(401, 'Invalid Signature abc123secret')
    const agent = await adminAgent()
    const res = await agent.post(`/api/admin/products/${PRODUCT_ID}/images`).attach('image', JPEG_BYTES, { filename: 'photo.jpg', contentType: 'image/jpeg' })
    expect(res.status).toBe(502)
    expect(res.body.error).toBe('upload_failed')
    expect(JSON.stringify(res.body)).not.toContain('secret')
  })

  it('cleans up the remote Cloudinary asset when the DB insert fails after a successful upload', async () => {
    mockUploadSuccess('orphan-cleanup-key')
    const addSpy = vi.spyOn(productImageService, 'addProductImage').mockRejectedValueOnce(new Error('simulated db failure'))
    const agent = await adminAgent()
    const res = await agent.post(`/api/admin/products/${PRODUCT_ID}/images`).attach('image', JPEG_BYTES, { filename: 'photo.jpg', contentType: 'image/jpeg' })
    expect(res.status).toBe(502)
    expect(res.body.error).toBe('upload_failed')
    expect(destroyMock).toHaveBeenCalledWith('orphan-cleanup-key', { resource_type: 'image' })
    addSpy.mockRestore()
  })

  it('rejects a malformed/too-many-files multipart request deterministically (LIMIT_UNEXPECTED_FILE)', async () => {
    const agent = await adminAgent()
    const res = await agent.post(`/api/admin/products/${PRODUCT_ID}/images`)
      .attach('image', JPEG_BYTES, { filename: 'one.jpg', contentType: 'image/jpeg' })
      .attach('image', JPEG_BYTES, { filename: 'two.jpg', contentType: 'image/jpeg' })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('too_many_files')
  })
})

describe('checkImageStorageConnection (real ping call mocked)', () => {
  it('reports "connected" when Cloudinary ping succeeds', async () => {
    pingMock.mockResolvedValue({ status: 'ok' })
    expect(await checkImageStorageConnection()).toBe('connected')
  })

  it('reports "credentials_invalid" when Cloudinary rejects with a 401', async () => {
    pingMock.mockRejectedValue({ http_code: 401, message: 'Invalid Signature' })
    expect(await checkImageStorageConnection()).toBe('credentials_invalid')
  })

  it('reports "provider_unreachable" for a network-level failure (no http_code)', async () => {
    pingMock.mockRejectedValue(new Error('ENOTFOUND'))
    expect(await checkImageStorageConnection()).toBe('provider_unreachable')
  })
})

describe('GET /api/admin/integrations — cloudinary connection status', () => {
  it('includes configured/connected/status for cloudinary, derived from a real ping call', async () => {
    pingMock.mockResolvedValue({ status: 'ok' })
    const agent = await adminAgent()
    const res = await agent.get('/api/admin/integrations')
    expect(res.status).toBe(200)
    expect(res.body.cloudinary).toEqual({ configured: true, connected: true, status: 'connected' })
  })

  it('reflects credentials_invalid without ever exposing the underlying Cloudinary message', async () => {
    pingMock.mockRejectedValue({ http_code: 401, message: 'Invalid Signature topsecret' })
    const agent = await adminAgent()
    const res = await agent.get('/api/admin/integrations')
    expect(res.body.cloudinary).toEqual({ configured: true, connected: false, status: 'credentials_invalid' })
    expect(JSON.stringify(res.body)).not.toContain('topsecret')
  })
})
