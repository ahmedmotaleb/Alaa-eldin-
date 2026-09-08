import { Router } from 'express'
import { pool } from '../db.js'
import { requireAdmin } from '../auth.js'

export const adminBannersRouter = Router()
adminBannersRouter.use(requireAdmin)

interface BannerRow {
  id: number
  kicker: string
  title: string
  note: string
  emoji: string
  ctaLabel: string
  link: string
  active: number
  sortOrder: number
}

const SELECT_BANNER = `
  SELECT id, kicker, title, note, emoji, cta_label as "ctaLabel", link, active, sort_order as "sortOrder"
  FROM banners
`

function serialize(row: BannerRow) {
  return { ...row, active: !!row.active }
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
    typeof b?.emoji !== 'string' || !b.emoji.trim() ||
    typeof b?.ctaLabel !== 'string' || !b.ctaLabel.trim() ||
    typeof b?.link !== 'string' || !b.link.trim() ||
    typeof b?.active !== 'boolean'
  ) return null

  return {
    kicker: typeof b.kicker === 'string' ? b.kicker.trim() : '',
    title: b.title.trim(),
    note: typeof b.note === 'string' ? b.note.trim() : '',
    emoji: b.emoji.trim(),
    ctaLabel: b.ctaLabel.trim(),
    link: b.link.trim(),
    active: b.active as boolean,
    sortOrder: typeof b.sortOrder === 'number' ? b.sortOrder : 0
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
    `INSERT INTO banners (kicker, title, note, emoji, cta_label, link, active, sort_order, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [data.kicker, data.title, data.note, data.emoji, data.ctaLabel, data.link, data.active ? 1 : 0, maxOrder + 1, new Date().toISOString()]
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
    `UPDATE banners SET kicker=$1, title=$2, note=$3, emoji=$4, cta_label=$5,
       link=$6, active=$7, sort_order=$8
     WHERE id=$9`,
    [data.kicker, data.title, data.note, data.emoji, data.ctaLabel, data.link, data.active ? 1 : 0, data.sortOrder, req.params.id]
  )

  const { rows } = await pool.query<BannerRow>(`${SELECT_BANNER} WHERE id = $1`, [req.params.id])
  res.json({ banner: serialize(rows[0]) })
})
