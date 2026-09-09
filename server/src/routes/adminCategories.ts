import { Router } from 'express'
import multer from 'multer'
import rateLimit from 'express-rate-limit'
import { pool } from '../db.js'
import { requireAdmin } from '../auth.js'
import { uploadImage, deleteImage as deleteRemoteImage, imageStorageConfigured } from '../services/imageStorageService.js'
import { isRealImage } from './adminProductImages.js'
import { recordAuditLog } from '../services/auditLogService.js'

export const adminCategoriesRouter = Router()
adminCategoriesRouter.use(requireAdmin)

interface CategoryRow {
  id: string
  name: string
  emoji: string
  tint: string
  imageUrl: string | null
}

const CATEGORY_SELECT = 'SELECT id, name, emoji, tint, image_url as "imageUrl" FROM categories ORDER BY sort_order'

adminCategoriesRouter.get('/', async (_req, res) => {
  const { rows: categories } = await pool.query<CategoryRow>(CATEGORY_SELECT)
  const { rows: counts } = await pool.query<{ categoryId: string, n: string }>('SELECT category_id as "categoryId", COUNT(*) as n FROM products GROUP BY category_id')
  const countMap = new Map(counts.map(c => [c.categoryId, Number(c.n)]))
  res.json({
    categories: categories.map(c => ({
      id: c.id, name: c.name, emoji: c.emoji, tint: c.tint,
      image: c.imageUrl ?? undefined,
      productCount: countMap.get(c.id) ?? 0
    }))
  })
})

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_SIZE_BYTES = 5 * 1024 * 1024
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SIZE_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, ALLOWED_MIME.has(file.mimetype))
})
const uploadRateLimit = rateLimit({ windowMs: 60 * 1000, limit: 15, standardHeaders: true, legacyHeaders: false })

// صورة القسم — واحدة بس (مش معرض) بترفع محل القديمة لو موجودة، ومفيش أي منتج لا يشترط
// وجودها؛ الإيموجي كاف تماماً لو الأدمن مش عايز يرفع صورة.
adminCategoriesRouter.post('/:id/image', uploadRateLimit, upload.single('image'), async (req, res) => {
  if (!imageStorageConfigured) {
    res.status(503).json({ error: 'image_storage_not_configured' })
    return
  }
  const file = req.file
  if (!file || !isRealImage(file.buffer, file.mimetype)) {
    res.status(400).json({ error: 'invalid_image' })
    return
  }
  const { rows } = await pool.query<{ imageStorageKey: string }>(
    'SELECT image_storage_key as "imageStorageKey" FROM categories WHERE id = $1',
    [req.params.id]
  )
  if (!rows[0]) {
    res.status(404).json({ error: 'category_not_found' })
    return
  }

  const uploaded = await uploadImage(file.buffer)
  await pool.query('UPDATE categories SET image_url = $1, image_storage_key = $2 WHERE id = $3', [uploaded.url, uploaded.storageKey, req.params.id])
  if (rows[0].imageStorageKey) await deleteRemoteImage(rows[0].imageStorageKey).catch(() => {})

  await recordAuditLog({
    adminUserId: req.user!.id,
    action: 'category_image_updated',
    entityType: 'category',
    entityId: String(req.params.id),
    newValues: { imageUrl: uploaded.url }
  })
  res.json({ image: uploaded.url })
})

adminCategoriesRouter.delete('/:id/image', async (req, res) => {
  const { rows } = await pool.query<{ imageStorageKey: string }>(
    'SELECT image_storage_key as "imageStorageKey" FROM categories WHERE id = $1',
    [req.params.id]
  )
  if (!rows[0]) {
    res.status(404).json({ error: 'category_not_found' })
    return
  }
  await pool.query(`UPDATE categories SET image_url = NULL, image_storage_key = '' WHERE id = $1`, [req.params.id])
  if (rows[0].imageStorageKey) await deleteRemoteImage(rows[0].imageStorageKey).catch(() => {})
  await recordAuditLog({
    adminUserId: req.user!.id,
    action: 'category_image_removed',
    entityType: 'category',
    entityId: String(req.params.id)
  })
  res.status(204).end()
})

adminCategoriesRouter.post('/', async (req, res) => {
  const { id, name, emoji, tint } = req.body ?? {}
  if (
    typeof id !== 'string' || !id.trim() ||
    typeof name !== 'string' || !name.trim() ||
    typeof emoji !== 'string' || !emoji.trim() ||
    typeof tint !== 'string' || !tint.trim()
  ) {
    res.status(400).json({ error: 'missing_fields' })
    return
  }

  const { rows: existingRows } = await pool.query('SELECT id FROM categories WHERE id = $1', [id])
  if (existingRows[0]) {
    res.status(409).json({ error: 'category_id_taken' })
    return
  }

  const { rows: maxRows } = await pool.query<{ m: number | null }>('SELECT MAX(sort_order) as m FROM categories')
  const maxOrder = maxRows[0].m ?? 0
  await pool.query(
    'INSERT INTO categories (id, name, emoji, tint, sort_order) VALUES ($1, $2, $3, $4, $5)',
    [id.trim(), name.trim(), emoji.trim(), tint.trim(), maxOrder + 1]
  )

  res.status(201).json({ category: { id: id.trim(), name: name.trim(), emoji: emoji.trim(), tint: tint.trim(), productCount: 0 } })
})
