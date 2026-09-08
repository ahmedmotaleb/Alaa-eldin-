import { Router } from 'express'
import { db } from '../db.js'

export const bannersRouter = Router()

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

bannersRouter.get('/banners', (_req, res) => {
  const rows = db.prepare(`${SELECT_BANNER} WHERE active = 1 ORDER BY sort_order ASC, id ASC`).all() as BannerRow[]
  res.json({ banners: rows.map(r => ({ ...r, active: !!r.active })) })
})
