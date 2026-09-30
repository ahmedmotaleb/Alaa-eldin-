import { Router } from 'express'
import { pool } from '../db.js'
import { publicOrigin } from '../publicUrl.js'
import { logEvent } from '../logger.js'

// نفس مصدر الحقيقة المستخدم في رابط استعادة كلمة المرور (auth.ts) والوسوم الاجتماعية —
// لو صاحب المتجر ربط دومين مخصص لاحقاً، تغيير PUBLIC_APP_URL بس كفاية عشان sitemap.xml
// وrobots.txt يشاورا على الدومين الصح تلقائياً، من غير أي تعديل كود.
const PUBLIC_APP_URL = publicOrigin()

export const seoRouter = Router()

// Digital Asset Links لتطبيق أندرويد TWA — بيربط دومين الإنتاج بشهادة توقيع الـ APK
// الحقيقية، عشان Android يفتح الرابط كـ TWA بملء الشاشة (بدون شريط عنوان Chrome) بدل ما
// يعامله كموقع عادي. لازم يرجع 200 + JSON خام (مش صفحة HTML) بدون أي auth. القيم هنا
// حقيقية — بصمة SHA-256 الفعلية لمفتاح التوقيع الإنتاجي، مش placeholder.
const ANDROID_PACKAGE_ID = 'com.alaaeldin.supermarket'
const ANDROID_SHA256_CERT_FINGERPRINT =
  '19:F7:52:0F:00:1E:7F:29:D9:F1:35:CC:11:C1:09:42:F8:75:3D:DC:30:16:13:EA:EA:A7:D3:07:18:70:C6:6A'

seoRouter.get('/.well-known/assetlinks.json', (_req, res) => {
  res
    .type('application/json')
    .set('Cache-Control', 'public, max-age=3600')
    .send(JSON.stringify([
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: ANDROID_PACKAGE_ID,
          sha256_cert_fingerprints: [ANDROID_SHA256_CERT_FINGERPRINT]
        }
      }
    ]))
})

// تتبع تنزيل APK — بسيط ومعزول عمداً: حدث واحد ثابت بدون أي بيانات من العميل (مفيش
// حاجة تتقرأ من body)، عشان الـ endpoint ده ميبقاش نقطة استغلال عامة لتسجيل أي حدث
// عشوائي. مفيش body parser مسجّل قبل seoRouter أصلاً (نفس ترتيب robots.txt/sitemap.xml)،
// وده مقصود هنا برضه — مش محتاجين نقرأ أي محتوى من الطلب.
seoRouter.post('/api/analytics/apk-download', (_req, res) => {
  logEvent('android_apk_download', {})
  res.status(204).end()
})

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
