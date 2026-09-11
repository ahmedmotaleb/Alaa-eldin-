import { Router } from 'express'
import { pool } from '../db.js'
import { publicOrigin } from '../publicUrl.js'

// نفس مصدر الحقيقة المستخدم في رابط استعادة كلمة المرور (auth.ts) والوسوم الاجتماعية —
// لو صاحب المتجر ربط دومين مخصص لاحقاً، تغيير PUBLIC_APP_URL بس كفاية عشان sitemap.xml
// وrobots.txt يشاورا على الدومين الصح تلقائياً، من غير أي تعديل كود.
const PUBLIC_APP_URL = publicOrigin()

export const seoRouter = Router()

seoRouter.get('/robots.txt', (_req, res) => {
  res.type('text/plain').send([
    'User-agent: *',
    'Disallow: /admin',
    'Disallow: /api',
    'Disallow: /onboarding',
    'Disallow: /cart',
    'Disallow: /checkout',
    'Disallow: /confirmation',
    'Disallow: /track',
    'Disallow: /orders',
    'Disallow: /account',
    'Disallow: /login',
    'Disallow: /register',
    'Disallow: /forgot-password',
    'Disallow: /reset-password',
    '',
    `Sitemap: ${PUBLIC_APP_URL}/sitemap.xml`
  ].join('\n'))
})

function escapeXml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function urlEntry(loc: string, lastmod?: string) {
  return `  <url>\n    <loc>${escapeXml(loc)}</loc>${lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : ''}\n  </url>`
}

seoRouter.get('/sitemap.xml', async (_req, res) => {
  const [{ rows: categories }, { rows: products }, { rows: pages }] = await Promise.all([
    pool.query<{ id: string }>('SELECT id FROM categories ORDER BY sort_order'),
    pool.query<{ slug: string }>('SELECT slug FROM products WHERE available = 1 ORDER BY slug'),
    pool.query<{ slug: string, updatedAt: string }>(
      "SELECT slug, updated_at as \"updatedAt\" FROM content_pages WHERE active = 1 ORDER BY slug"
    )
  ])

  const staticPaths = ['/', '/categories', '/offers', '/best-sellers']
  const entries = [
    ...staticPaths.map(p => urlEntry(`${PUBLIC_APP_URL}${p}`)),
    ...categories.map(c => urlEntry(`${PUBLIC_APP_URL}/category/${c.id}`)),
    ...products.map(p => urlEntry(`${PUBLIC_APP_URL}/product/${p.slug}`)),
    ...pages.map(p => urlEntry(`${PUBLIC_APP_URL}/${p.slug}`, new Date(p.updatedAt).toISOString()))
  ]

  res
    .type('application/xml')
    .set('Cache-Control', 'public, max-age=3600')
    .send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join('\n')}\n</urlset>\n`)
})
