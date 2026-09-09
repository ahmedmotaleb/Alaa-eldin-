import { Router } from 'express'
import multer from 'multer'
import rateLimit from 'express-rate-limit'
import { pool } from '../db.js'
import { requireAdmin } from '../auth.js'
import { uploadImage, deleteImage as deleteRemoteImage, imageStorageConfigured } from '../services/imageStorageService.js'
import { isRealImage } from './adminProductImages.js'
import { recordAuditLog } from '../services/auditLogService.js'

export const adminBannersRouter = Router()
adminBannersRouter.use(requireAdmin)

interface BannerRow {
  id: number
  kicker: string
  title: string
  note: string
  emoji: string
  imageUrl: string | null
  imageStorageKey: string
  mobileImageUrl: string | null
  mobileImageStorageKey: string
  altText: string
  ctaLabel: string
  link: string
  active: number
  sortOrder: number
  startsAt: string | null
  endsAt: string | null
}

const SELECT_BANNER = `
  SELECT id, kicker, title, note, emoji, image_url as "imageUrl", image_storage_key as "imageStorageKey",
         mobile_image_url as "mobileImageUrl", mobile_image_storage_key as "mobileImageStorageKey",
         alt_text as "altText", cta_label as "ctaLabel", link, active, sort_order as "sortOrder",
         starts_at as "startsAt", ends_at as "endsAt"
  FROM banners
`

function serialize(row: BannerRow) {
  return {
    id: row.id, kicker: row.kicker, title: row.title, note: row.note, emoji: row.emoji,
    imageUrl: row.imageUrl ?? undefined, mobileImageUrl: row.mobileImageUrl ?? undefined,
    altText: row.altText, ctaLabel: row.ctaLabel, link: row.link, active: !!row.active,
    sortOrder: row.sortOrder, startsAt: row.startsAt ?? undefined, endsAt: row.endsAt ?? undefined
  }
}

adminBannersRouter.get('/', async (_req, res) => {
  const { rows } = await pool.query<BannerRow>(`${SELECT_BANNER} ORDER BY sort_order ASC, id ASC`)
  res.json({ banners: rows.map(serialize) })
})

adminBannersRouter.get('/:id', async (req, res) => {
  const { rows } = await pool.query<BannerRow>(`${SELECT_BANNER} WHERE id = $1`, [req.params.id])
  const row = rows[0]
  if (!row) {
    res.status(404).json({ error: 'banner_not_found' })
    return
  }
  res.json({ banner: serialize(row) })
})

function validateBody(body: unknown) {
  const b = body as Record<string, unknown>
  if (
    typeof b?.title !== 'string' || !b.title.trim() ||
    typeof b?.ctaLabel !== 'string' || !b.ctaLabel.trim() ||
    typeof b?.link !== 'string' || !b.link.trim() ||
    typeof b?.active !== 'boolean' ||
    (b.startsAt !== undefined && b.startsAt !== null && typeof b.startsAt !== 'string') ||
    (b.endsAt !== undefined && b.endsAt !== null && typeof b.endsAt !== 'string')
  ) return null

  return {
    kicker: typeof b.kicker === 'string' ? b.kicker.trim() : '',
    title: b.title.trim(),
    note: typeof b.note === 'string' ? b.note.trim() : '',
    // الإيموجي بقى اختياري — احتياط للعرض بس لو مفيش صورة مرفوعة أصلاً.
    emoji: typeof b.emoji === 'string' ? b.emoji.trim() : '',
    altText: typeof b.altText === 'string' ? b.altText.trim() : '',
    ctaLabel: b.ctaLabel.trim(),
    link: b.link.trim(),
    active: b.active as boolean,
    sortOrder: typeof b.sortOrder === 'number' ? b.sortOrder : 0,
    startsAt: typeof b.startsAt === 'string' && b.startsAt ? b.startsAt : null,
    endsAt: typeof b.endsAt === 'string' && b.endsAt ? b.endsAt : null
  }
}

adminBannersRouter.post('/', async (req, res) => {
  const data = validateBody(req.body)
  if (!data) {
    res.status(400).json({ error: 'missing_fields' })
    return
  }

  const { rows: maxRows } = await pool.query<{ m: number }>('SELECT COALESCE(MAX(sort_order), -1) as m FROM banners')
  const maxOrder = maxRows[0].m

  const { rows: insertedRows } = await pool.query<{ id: number }>(
    `INSERT INTO banners (kicker, title, note, emoji, alt_text, cta_label, link, active, sort_order, starts_at, ends_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
    [data.kicker, data.title, data.note, data.emoji, data.altText, data.ctaLabel, data.link, data.active ? 1 : 0, maxOrder + 1, data.startsAt, data.endsAt, new Date().toISOString()]
  )

  const { rows } = await pool.query<BannerRow>(`${SELECT_BANNER} WHERE id = $1`, [insertedRows[0].id])
  res.status(201).json({ banner: serialize(rows[0]) })
})

adminBannersRouter.patch('/:id', async (req, res) => {
  const { rows: existingRows } = await pool.query<BannerRow>(`${SELECT_BANNER} WHERE id = $1`, [req.params.id])
  const existing = existingRows[0]
  if (!existing) {
    res.status(404).json({ error: 'banner_not_found' })
    return
  }

  const data = validateBody({ ...serialize(existing), ...(req.body ?? {}) })
  if (!data) {
    res.status(400).json({ error: 'missing_fields' })
    return
  }

  await pool.query(
    `UPDATE banners SET kicker=$1, title=$2, note=$3, emoji=$4, alt_text=$5, cta_label=$6,
       link=$7, active=$8, sort_order=$9, starts_at=$10, ends_at=$11
     WHERE id=$12`,
    [data.kicker, data.title, data.note, data.emoji, data.altText, data.ctaLabel, data.link, data.active ? 1 : 0, data.sortOrder, data.startsAt, data.endsAt, req.params.id]
  )

  const { rows } = await pool.query<BannerRow>(`${SELECT_BANNER} WHERE id = $1`, [req.params.id])
  res.json({ banner: serialize(rows[0]) })
})

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_SIZE_BYTES = 5 * 1024 * 1024
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SIZE_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, ALLOWED_MIME.has(file.mimetype))
})
const uploadRateLimit = rateLimit({ windowMs: 60 * 1000, limit: 15, standardHeaders: true, legacyHeaders: false })

// variant='mobile' يرفع صورة مخصصة للموبايل (اختيارية)، وإلا الصورة الرئيسية (desktop).
adminBannersRouter.post('/:id/image', uploadRateLimit, upload.single('image'), async (req, res) => {
  if (!imageStorageConfigured) {
    res.status(503).json({ error: 'image_storage_not_configured' })
    return
  }
  const file = req.file
  if (!file || !isRealImage(file.buffer, file.mimetype)) {
    res.status(400).json({ error: 'invalid_image' })
    return
  }
  const isMobile = req.query.variant === 'mobile'
  const { rows } = await pool.query<BannerRow>(`${SELECT_BANNER} WHERE id = $1`, [req.params.id])
  if (!rows[0]) {
    res.status(404).json({ error: 'banner_not_found' })
    return
  }

  const uploaded = await uploadImage(file.buffer)
  if (isMobile) {
    await pool.query('UPDATE banners SET mobile_image_url = $1, mobile_image_storage_key = $2 WHERE id = $3', [uploaded.url, uploaded.storageKey, req.params.id])
    if (rows[0].mobileImageStorageKey) await deleteRemoteImage(rows[0].mobileImageStorageKey).catch(() => {})
  } else {
    await pool.query('UPDATE banners SET image_url = $1, image_storage_key = $2 WHERE id = $3', [uploaded.url, uploaded.storageKey, req.params.id])
    if (rows[0].imageStorageKey) await deleteRemoteImage(rows[0].imageStorageKey).catch(() => {})
  }

  await recordAuditLog({
    adminUserId: req.user!.id,
    action: 'banner_image_updated',
    entityType: 'banner',
    entityId: String(req.params.id),
    newValues: { variant: isMobile ? 'mobile' : 'desktop' }
  })
  res.json({ image: uploaded.url })
})

adminBannersRouter.delete('/:id/image', async (req, res) => {
  const isMobile = req.query.variant === 'mobile'
  const { rows } = await pool.query<BannerRow>(`${SELECT_BANNER} WHERE id = $1`, [req.params.id])
  if (!rows[0]) {
    res.status(404).json({ error: 'banner_not_found' })
    return
  }
  if (isMobile) {
    await pool.query(`UPDATE banners SET mobile_image_url = NULL, mobile_image_storage_key = '' WHERE id = $1`, [req.params.id])
    if (rows[0].mobileImageStorageKey) await deleteRemoteImage(rows[0].mobileImageStorageKey).catch(() => {})
  } else {
    await pool.query(`UPDATE banners SET image_url = NULL, image_storage_key = '' WHERE id = $1`, [req.params.id])
    if (rows[0].imageStorageKey) await deleteRemoteImage(rows[0].imageStorageKey).catch(() => {})
  }
  await recordAuditLog({
    adminUserId: req.user!.id,
    action: 'banner_image_removed',
    entityType: 'banner',
    entityId: String(req.params.id),
    newValues: { variant: isMobile ? 'mobile' : 'desktop' }
  })
  res.status(204).end()
})
