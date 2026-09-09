import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { pool } from '../db.js'
import { listPublicBanners } from './bannerService.js'

async function resetFixtures() {
  await pool.query('DELETE FROM banners')
}

beforeEach(async () => {
  await resetFixtures()
})

afterAll(async () => {
  await pool.end()
})

async function insertBanner(overrides: {
  title: string
  active?: boolean
  startsAt?: string | null
  endsAt?: string | null
  sortOrder?: number
}) {
  await pool.query(
    `INSERT INTO banners (kicker, title, note, emoji, cta_label, link, active, sort_order, starts_at, ends_at, created_at)
     VALUES ('', $1, '', '🛍️', 'تسوق', '/', $2, $3, $4, $5, now())`,
    [
      overrides.title,
      overrides.active === false ? 0 : 1,
      overrides.sortOrder ?? 0,
      overrides.startsAt ?? null,
      overrides.endsAt ?? null
    ]
  )
}

describe('listPublicBanners', () => {
  it('returns an active banner with no schedule set', async () => {
    await insertBanner({ title: 'بدون جدولة' })
    const banners = await listPublicBanners()
    expect(banners.map(b => b.title)).toEqual(['بدون جدولة'])
  })

  it('never returns an inactive banner regardless of schedule', async () => {
    await insertBanner({ title: 'مخفي', active: false })
    expect(await listPublicBanners()).toHaveLength(0)
  })

  it('hides a banner whose schedule has not started yet', async () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    await insertBanner({ title: 'لسه ما جاش وقته', startsAt: future })
    expect(await listPublicBanners()).toHaveLength(0)
  })

  it('hides a banner whose schedule has already ended', async () => {
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    await insertBanner({ title: 'خلص وقته', endsAt: past })
    expect(await listPublicBanners()).toHaveLength(0)
  })

  it('shows a banner currently inside its scheduled window', async () => {
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    await insertBanner({ title: 'جاري العرض دلوقتي', startsAt: past, endsAt: future })
    const banners = await listPublicBanners()
    expect(banners.map(b => b.title)).toEqual(['جاري العرض دلوقتي'])
  })

  it('orders by sort_order', async () => {
    await insertBanner({ title: 'الثاني', sortOrder: 2 })
    await insertBanner({ title: 'الأول', sortOrder: 1 })
    const banners = await listPublicBanners()
    expect(banners.map(b => b.title)).toEqual(['الأول', 'الثاني'])
  })
})
