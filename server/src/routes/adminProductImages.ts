import { Router } from 'express'
import multer from 'multer'
import rateLimit from 'express-rate-limit'
import crypto from 'node:crypto'
import { pool } from '../db.js'
import { requireAdmin } from '../auth.js'
import { uploadImage, deleteImage as deleteRemoteImage, imageStorageConfigured } from '../services/imageStorageService.js'
import {
  listProductImages, addProductImage, setPrimaryProductImage, updateProductImageAlt,
  reorderProductImages, getProductImage, deleteProductImage
} from '../services/productImageService.js'
import { recordAuditLog } from '../services/auditLogService.js'
import { logEvent, logWarn } from '../logger.js'

export const adminProductImagesRouter = Router()
adminProductImagesRouter.use(requireAdmin)

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_SIZE_BYTES = 5 * 1024 * 1024

// ما بيثقش في الـ mimetype اللي المتصفح مبعتها لوحدها — بيتأكد كمان من magic bytes الحقيقية
// للملف عشان يمنع ملف متنكر (مثلاً .exe بامتداد/mimetype صورة مزيّف).
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff])
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47])
const WEBP_RIFF = Buffer.from('RIFF')
const WEBP_TAG = Buffer.from('WEBP')

export function isRealImage(buffer: Buffer, mimetype: string): boolean {
  if (buffer.length < 12) return false
  if (mimetype === 'image/jpeg') return buffer.subarray(0, 3).equals(JPEG_MAGIC)
  if (mimetype === 'image/png') return buffer.subarray(0, 4).equals(PNG_MAGIC)
  if (mimetype === 'image/webp') return buffer.subarray(0, 4).equals(WEBP_RIFF) && buffer.subarray(8, 12).equals(WEBP_TAG)
  return false
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SIZE_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    cb(null, ALLOWED_MIME.has(file.mimetype))
  }
})

// لا تتداخل مع سير عمل الإدارة العادي — ١٥ رفعة كل دقيقة كافية بالزيادة لأي جلسة تعديل منتج
// حقيقية، وبتمنع في نفس الوقت إساءة استخدام endpoint الرفع.
const uploadRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 15,
  standardHeaders: true,
  legacyHeaders: false
})

function serialize(row: { id: string, productId: string, imageUrl: string, altText: string, sortOrder: number, isPrimary: boolean }) {
  return row
}

async function getProductName(productId: string): Promise<string | null> {
  const { rows } = await pool.query<{ name: string }>('SELECT name FROM products WHERE id = $1', [productId])
  return rows[0]?.name ?? null
}

adminProductImagesRouter.get('/:productId/images', async (req, res) => {
  const images = await listProductImages(String(req.params.productId))
  res.json({ images: images.map(serialize) })
})

adminProductImagesRouter.post('/:productId/images', uploadRateLimit, upload.single('image'), async (req, res) => {
  const productId = String(req.params.productId)
  const productName = await getProductName(productId)
  if (!productName) {
    res.status(404).json({ error: 'product_not_found' })
    return
  }
  if (!imageStorageConfigured) {
    logWarn('image_upload_failed', { productId, reason: 'storage_not_configured' })
    res.status(503).json({ error: 'image_storage_not_configured' })
    return
  }
  const file = req.file
  if (!file) {
    res.status(400).json({ error: 'no_file_or_invalid_type' })
    return
  }
  if (!isRealImage(file.buffer, file.mimetype)) {
    logWarn('image_upload_failed', { productId, reason: 'invalid_file_signature' })
    res.status(400).json({ error: 'invalid_file' })
    return
  }

  try {
    const uploaded = await uploadImage(file.buffer)
    const id = 'img' + crypto.randomBytes(6).toString('hex')
    const altText = typeof req.body?.altText === 'string' && req.body.altText.trim()
      ? req.body.altText.trim()
      : `صورة منتج ${productName}`

    const image = await addProductImage({ id, productId, imageUrl: uploaded.url, storageKey: uploaded.storageKey, altText })

    logEvent('image_upload_success', { productId, imageId: id })
    await recordAuditLog({
      adminUserId: req.user!.id,
      action: 'product_image_added',
      entityType: 'product',
      entityId: productId,
      newValues: { imageId: id }
    })

    res.status(201).json({ image: serialize(image) })
  } catch {
    logWarn('image_upload_failed', { productId, reason: 'upload_error' })
    res.status(502).json({ error: 'upload_failed' })
  }
})

adminProductImagesRouter.patch('/:productId/images/:imageId', async (req, res) => {
  const productId = String(req.params.productId)
  const imageId = String(req.params.imageId)
  const existing = await getProductImage(productId, imageId)
  if (!existing) {
    res.status(404).json({ error: 'image_not_found' })
    return
  }

  const body = req.body as Record<string, unknown>
  const setPrimary = body?.isPrimary === true
  const altText = typeof body?.altText === 'string' ? body.altText.trim() : undefined

  if (setPrimary) await setPrimaryProductImage(productId, imageId)
  if (altText !== undefined) await updateProductImageAlt(imageId, altText)

  if (setPrimary) {
    await recordAuditLog({
      adminUserId: req.user!.id,
      action: 'primary_image_changed',
      entityType: 'product',
      entityId: productId,
      newValues: { imageId }
    })
  }

  const updated = await getProductImage(productId, imageId)
  res.json({ image: serialize(updated!) })
})

adminProductImagesRouter.put('/:productId/images/reorder', async (req, res) => {
  const productId = String(req.params.productId)
  const order = (req.body as { order?: unknown })?.order
  if (!Array.isArray(order) || !order.every(id => typeof id === 'string')) {
    res.status(400).json({ error: 'invalid_order' })
    return
  }

  const images = await reorderProductImages(productId, order)
  res.json({ images: images.map(serialize) })
})

adminProductImagesRouter.delete('/:productId/images/:imageId', async (req, res) => {
  const productId = String(req.params.productId)
  const imageId = String(req.params.imageId)
  const existing = await getProductImage(productId, imageId)
  if (!existing) {
    res.status(404).json({ error: 'image_not_found' })
    return
  }

  await deleteProductImage(productId, imageId, existing)

  try {
    await deleteRemoteImage(existing.storageKey)
  } catch {
    // الحذف من قاعدة البيانات نجح بالفعل — فشل حذف النسخة عند المزوّد الخارجي مش لازم
    // يفشّل الطلب كله؛ بيفضل ملف يتيم عند المزوّد لكن العلاقة في قاعدة بياناتنا اتشالت بأمان.
  }

  logEvent('image_deleted', { productId, imageId })
  await recordAuditLog({
    adminUserId: req.user!.id,
    action: 'product_image_removed',
    entityType: 'product',
    entityId: productId,
    oldValues: { imageId }
  })

  res.status(204).end()
})
