import { pool } from '../db.js'

export type BannerPlacement = 'hero' | 'popup'

export interface PublicBanner {
  id: number
  kicker: string
  title: string
  note: string
  emoji: string
  imageUrl?: string
  mobileImageUrl?: string
  altText: string
  ctaLabel: string
  link: string
  placement: BannerPlacement
}

interface BannerRow {
  id: number
  kicker: string
  title: string
  note: string
  emoji: string
  imageUrl: string | null
  mobileImageUrl: string | null
  altText: string
  ctaLabel: string
  link: string
  placement: BannerPlacement
}

// بيرجّع بس البانرات المفعّلة واللي جوه فترة جدولتها الحالية (لو محدّدة) — بانر لسه ما جاش
// وقته أو خلص وقته ما يتشافش للعميل حتى لو "active" لسه مفعّل يدوياً. بيرجّع كل الأماكن
// (hero + popup) في طلب واحد — الواجهة هي اللي بتفلتر حسب placement، عشان ما نعملش طلب
// شبكة إضافي منفصل بس عشان بانر البوب-أب.
export async function listPublicBanners(): Promise<PublicBanner[]> {
  const { rows } = await pool.query<BannerRow>(
    `SELECT id, kicker, title, note, emoji, image_url as "imageUrl", mobile_image_url as "mobileImageUrl",
            alt_text as "altText", cta_label as "ctaLabel", link, placement
     FROM banners
     WHERE active = 1
       AND (starts_at IS NULL OR starts_at <= now())
       AND (ends_at IS NULL OR ends_at >= now())
     ORDER BY sort_order ASC, id ASC`
  )
  return rows.map(r => ({
    id: r.id, kicker: r.kicker, title: r.title, note: r.note, emoji: r.emoji,
    imageUrl: r.imageUrl ?? undefined, mobileImageUrl: r.mobileImageUrl ?? undefined,
    altText: r.altText, ctaLabel: r.ctaLabel, link: r.link, placement: r.placement
  }))
}
