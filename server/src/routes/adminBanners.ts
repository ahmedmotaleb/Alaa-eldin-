import { Router } from 'express'
import { db } from '../db.js'
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
  SELECT id, kicker, title, note, emoji, cta_label as ctaLabel, link, active, sort_order as sortOrder
  FROM banners
`

function serialize(row: BannerRow) {
  return { ...row, active: !!row.active }
}

adminBannersRouter.get('/', (_req, res) => {
  const rows = db.prepare(`${SELECT_BANNER} ORDER BY sort_order ASC, id ASC`).all() as BannerRow[]
  res.json({ banners: rows.map(serialize) })
})

adminBannersRouter.get('/:id', (req, res) => {
  const row = db.prepare(`${SELECT_BANNER} WHERE id = ?`).get(req.params.id) as BannerRow | undefined
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

adminBannersRouter.post('/', (req, res) => {
  const data = validateBody(req.body)
  if (!data) {
    res.status(400).json({ error: 'missing_fields' })
    return
  }

  const maxOrder = (db.prepare('SELECT COALESCE(MAX(sort_order), -1) as m FROM banners').get() as { m: number }).m

  const result = db.prepare(`
    INSERT INTO banners (kicker, title, note, emoji, cta_label, link, active, sort_order)
    VALUES (@kicker, @title, @note, @emoji, @ctaLabel, @link, @active, @sortOrder)
  `).run({ ...data, active: data.active ? 1 : 0, sortOrder: maxOrder + 1 })

  const row = db.prepare(`${SELECT_BANNER} WHERE id = ?`).get(result.lastInsertRowid) as BannerRow
  res.status(201).json({ banner: serialize(row) })
})

adminBannersRouter.patch('/:id', (req, res) => {
  const existing = db.prepare(`${SELECT_BANNER} WHERE id = ?`).get(req.params.id) as BannerRow | undefined
  if (!existing) {
    res.status(404).json({ error: 'banner_not_found' })
    return
  }

  const data = validateBody({ ...serialize(existing), ...(req.body ?? {}) })
  if (!data) {
    res.status(400).json({ error: 'missing_fields' })
    return
  }

  db.prepare(`
    UPDATE banners SET kicker=@kicker, title=@title, note=@note, emoji=@emoji, cta_label=@ctaLabel,
      link=@link, active=@active, sort_order=@sortOrder
    WHERE id=@id
  `).run({ id: req.params.id, ...data, active: data.active ? 1 : 0 })

  const row = db.prepare(`${SELECT_BANNER} WHERE id = ?`).get(req.params.id) as BannerRow
  res.json({ banner: serialize(row) })
})
