// أداة تشغيل لمرة واحدة (يدوياً، مش cron) لملء صور حقيقية لمنتجات الكتالوج من المواقع
// الرسمية للماركات فقط — لا صور من موردين/منافسين (كارفور، سبينيز...) ولا صور ستوك، عشان
// حقوق النشر. لازم تتشغّل في بيئة عندها اتصال إنترنت حقيقي + مفاتيح Cloudinary حقيقية
// (Railway production، أو جهازك مع DATABASE_URL/CLOUDINARY_* بتوع production) — مش من
// sandbox التطوير، لأنه محجوب الخروج للإنترنت ومفيهوش مفاتيح Cloudinary.
//
// الاستخدام:
//   npm run products:populate-images:dev           # تشغيل حقيقي (بيرفع ويحفظ)
//   npm run products:populate-images:dev -- --dry-run   # بس يعرض اللي هيعمله من غير رفع فعلي
//
// كل صف في PRODUCT_IMAGE_SOURCES جاي من بحث ويب يدوي (مش تلقائي 100%) — مفيش ضمان إن
// الصفحة لسه موجودة أو إن الصورة المستخرجة هي بالظبط نفس العبوة/الحجم المكتوب في المنتج.
// الحقل confidence بيوضح مستوى الثقة، وبعد التشغيل لازم تتراجع الصور يدوياً من لوحة الإدارة
// قبل ما تعتبر المهمة خلصت فعلاً — خصوصاً اللي confidence فيها 'low'.
import { pool } from './db.js'
import { uploadImage, imageStorageConfigured } from './services/imageStorageService.js'
import { addProductImage, listProductImages } from './services/productImageService.js'
import { isRealImage, ALLOWED_IMAGE_MIME, MAX_IMAGE_SIZE_BYTES } from './imageValidation.js'
import crypto from 'node:crypto'

type Confidence = 'high' | 'close' | 'low'

interface ImageSource {
  productId: string
  pageUrl: string
  source: string
  confidence: Confidence
  note: string
}

// منتجات اتستبعدت عمداً — مفيش مصدر رسمي حقيقي ليها (خضار/فاكهة بلدي، مخبز عام، أو
// الماركة الحقيقية بتاعتها مش بتصنّع نفس الصنف ده أصلاً). راجع التقرير المرفق لتفاصيل كل سبب.
const SKIPPED_NO_SOURCE: Record<string, string> = {
  p01: 'منتج طازج عام (بلدي) — مفيش جهة تصنيع/موقع رسمي لمنتج زراعي عام',
  p02: 'منتج طازج عام (بلدي) — مفيش جهة تصنيع/موقع رسمي لمنتج زراعي عام',
  p03: 'منتج طازج عام (بلدي) — مفيش جهة تصنيع/موقع رسمي لمنتج زراعي عام',
  p04: 'منتج طازج عام (بلدي) — مفيش جهة تصنيع/موقع رسمي لمنتج زراعي عام',
  p05: 'منتج طازج عام (بلدي) — مفيش جهة تصنيع/موقع رسمي لمنتج زراعي عام',
  p06: 'منتج طازج عام (بلدي) — مفيش جهة تصنيع/موقع رسمي لمنتج زراعي عام',
  p10: 'دومتي (الماركة المسجلة) معندهاش خط جبنة شيدر شرائح في الكتالوج الرسمي — بس جبنة شيدر دهن',
  p12: 'مفيش صفحة منتج رسمية لـ"الوطنية" بيض في مصر — الموقع الوحيد اللي ظهر بنفس الاسم تابع لشركة سعودية مختلفة',
  p15: 'الملكة (مكرونة) تابعة لمجموعة Savola بس مفيهاش موقع/صفحة منتج رسمية مستقلة، غير صفحات موزّعين',
  p17: 'مفيش موقع رسمي معروف لمنتج فول معلب باسم "الدلتا" — شركة الدلتا للسكر مالهاش علاقة بيه',
  p18: 'مفيش موقع رسمي معروف لمنتج عدس باسم "الدلتا" — شركة الدلتا للسكر مالهاش علاقة بيه',
  p19: 'المخبز اسم عام مش جهة تصنيع فعلية — مفيش موقع رسمي',
  p22: 'المخبز اسم عام مش جهة تصنيع فعلية — مفيش موقع رسمي',
  p23: 'المخبز اسم عام مش جهة تصنيع فعلية — مفيش موقع رسمي',
  p26: 'العروسة ماركة شاي فقط (elarosatea.com) — مفيش دليل على خط عصائر بنفس الاسم',
  p27: 'العروسة ماركة شاي فقط (elarosatea.com) — مفيش دليل على خط عصائر بنفس الاسم',
  p29: 'مفيش موقع رسمي موحّد لقهوة "الأمير" ظهر في البحث',
  p30: '"المصرية للمشروبات" اسم عام جداً — مفيش شركة محددة اتعرفت بنفس الاسم',
  p31: 'برسيل (Persil/Henkel) ماركة غسيل ملابس بس — مفيش خط سائل غسيل أطباق بنفس الاسم',
  p32: 'فيري (Fairy/P&G) ماركة غسيل أطباق بس — مفيش خط منظف أرضيات بنفس الاسم',
  p34: 'فاين ماركة حقيقية لكن مفيش موقع رسمي (fine.com.eg أو مشابه) اتأكد وصوله في البحث',
  p35: 'فاين معروفة بالمناديل/الورق — مفيش دليل على خط أكياس قمامة بنفس الاسم'
}

const PRODUCT_IMAGE_SOURCES: ImageSource[] = [
  { productId: 'p07', pageUrl: 'https://www.juhayna.com/brands/tba-edge-pack-1-liter/', source: 'juhayna.com', confidence: 'close', note: 'صفحة منتج لبن كامل الدسم 1 لتر' },
  { productId: 'p08', pageUrl: 'https://www.juhayna.com/brands-category/juhayna-yogurt/', source: 'juhayna.com', confidence: 'low', note: 'صفحة تصنيف زبادي عامة، مش SKU محدد' },
  { productId: 'p09', pageUrl: 'https://www.domty.org/en/products/plastic-tubs/natural-feta-cheese', source: 'domty.org', confidence: 'close', note: 'بيتباع عند دومتي باسم Natural Feta Cheese' },
  { productId: 'p11', pageUrl: 'https://www.almarai.com/en/brands/almarai/cheeses-and-foods/butter/unsalted-natural-butter', source: 'almarai.com', confidence: 'close', note: 'فيه نسخة مملحة وغير مملحة — ده الغير مملح' },
  { productId: 'p13', pageUrl: 'https://eldoha.com/product-ar.html', source: 'eldoha.com', confidence: 'low', note: 'صفحة منتجات عامة للشركة' },
  { productId: 'p14', pageUrl: 'https://deltasugar.com/', source: 'deltasugar.com', confidence: 'low', note: 'الصفحة الرئيسية بس — مفيش صفحة منتج محددة اتأكدت' },
  { productId: 'p16', pageUrl: 'https://www.armagroupeg.com/our_brands/crystal/', source: 'armagroupeg.com', confidence: 'low', note: 'صفحة الماركة عند الشركة الأم' },
  { productId: 'p20', pageUrl: 'https://shop.richbake.com/', source: 'richbake.com', confidence: 'low', note: 'متجر الشركة — مفيش رابط SKU توست أبيض محدد' },
  { productId: 'p21', pageUrl: 'https://shop.richbake.com/', source: 'richbake.com', confidence: 'low', note: 'متجر الشركة — مفيش رابط SKU توست حبوب كاملة محدد' },
  { productId: 'p24', pageUrl: 'https://edita.com.eg/our-brands/', source: 'edita.com.eg', confidence: 'low', note: 'صفحة ماركات Edita الأم — تودو واحدة منها' },
  { productId: 'p25', pageUrl: 'https://www.hayat.com/ar-eg/', source: 'hayat.com', confidence: 'low', note: 'الصفحة الرئيسية لشركة حياة' },
  { productId: 'p28', pageUrl: 'https://elarosatea.com/', source: 'elarosatea.com', confidence: 'close', note: 'العروسة شاي فقط — الصفحة الرئيسية غالباً بتعرض نفس المنتج' },
  { productId: 'p33', pageUrl: 'https://www.ariel-egypt.com/ar-eg', source: 'ariel-egypt.com', confidence: 'low', note: 'الموقع الإقليمي — ما اتفحصش إمكانية الوصول فعلياً' },
  { productId: 'p36', pageUrl: 'https://www.cloroxegypt.com/ar/products/clorox-bleach/', source: 'cloroxegypt.com', confidence: 'high', note: 'صفحة منتج مطابقة تماماً: مبيض كلوركس' }
]

const DRY_RUN = process.argv.includes('--dry-run')

interface Result {
  productId: string
  name: string
  status: 'uploaded' | 'would_upload' | 'skipped_no_source' | 'skipped_has_image' | 'skipped_no_image_found' | 'skipped_invalid_image' | 'skipped_too_large' | 'failed'
  detail: string
}

function extractImageUrl(html: string, pageUrl: string): string | null {
  const metaPatterns = [
    /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i
  ]
  for (const pattern of metaPatterns) {
    const match = html.match(pattern)
    if (match?.[1]) {
      try {
        return new URL(match[1], pageUrl).toString()
      } catch {
        continue
      }
    }
  }
  const imgMatch = html.match(/<img[^>]+src=["']([^"']+\.(?:jpg|jpeg|png|webp))["']/i)
  if (imgMatch?.[1]) {
    try {
      return new URL(imgMatch[1], pageUrl).toString()
    } catch {
      return null
    }
  }
  return null
}

function mimeFromContentType(contentType: string | null): string | null {
  if (!contentType) return null
  const base = contentType.split(';')[0].trim().toLowerCase()
  return ALLOWED_IMAGE_MIME.has(base) ? base : null
}

async function processProduct(src: ImageSource, productName: string): Promise<Result> {
  const pageRes = await fetch(src.pageUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AlaaEldinCatalogBot/1.0)' } })
  if (!pageRes.ok) {
    return { productId: src.productId, name: productName, status: 'failed', detail: `page fetch failed (${pageRes.status})` }
  }
  const html = await pageRes.text()
  const imageUrl = extractImageUrl(html, src.pageUrl)
  if (!imageUrl) {
    return { productId: src.productId, name: productName, status: 'skipped_no_image_found', detail: 'لم يتم العثور على صورة في الصفحة' }
  }

  const imgRes = await fetch(imageUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AlaaEldinCatalogBot/1.0)' } })
  if (!imgRes.ok) {
    return { productId: src.productId, name: productName, status: 'failed', detail: `image fetch failed (${imgRes.status}) — ${imageUrl}` }
  }
  const arrayBuffer = await imgRes.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)

  if (buffer.length > MAX_IMAGE_SIZE_BYTES) {
    return { productId: src.productId, name: productName, status: 'skipped_too_large', detail: `${imageUrl} (${buffer.length} bytes)` }
  }

  const declaredMime = mimeFromContentType(imgRes.headers.get('content-type'))
  const candidateMimes = declaredMime ? [declaredMime] : ['image/jpeg', 'image/png', 'image/webp']
  const confirmedMime = candidateMimes.find(m => isRealImage(buffer, m))
  if (!confirmedMime) {
    return { productId: src.productId, name: productName, status: 'skipped_invalid_image', detail: `${imageUrl} did not pass image signature check` }
  }

  if (DRY_RUN) {
    return { productId: src.productId, name: productName, status: 'would_upload', detail: `${imageUrl} (${confirmedMime}, ${buffer.length} bytes, confidence=${src.confidence}, source=${src.source})` }
  }

  const uploaded = await uploadImage(buffer)
  const id = 'img' + crypto.randomBytes(6).toString('hex')
  await addProductImage({
    id,
    productId: src.productId,
    imageUrl: uploaded.url,
    storageKey: uploaded.storageKey,
    altText: `صورة منتج ${productName}`
  })
  return { productId: src.productId, name: productName, status: 'uploaded', detail: `${src.source} -> ${uploaded.url} (confidence=${src.confidence})` }
}

async function main() {
  if (!DRY_RUN && !imageStorageConfigured) {
    console.error('image_storage_not_configured: CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET غير موجودة في البيئة دي — شغّل الأداة في بيئة فيها المفاتيح الحقيقية (Railway production)، أو استخدم --dry-run للمعاينة بس.')
    process.exitCode = 1
    return
  }

  const { rows: products } = await pool.query<{ id: string, name: string }>('SELECT id, name FROM products ORDER BY id')
  const nameById = new Map(products.map(p => [p.id, p.name]))

  const results: Result[] = []

  for (const [productId, reason] of Object.entries(SKIPPED_NO_SOURCE)) {
    results.push({ productId, name: nameById.get(productId) ?? productId, status: 'skipped_no_source', detail: reason })
  }

  for (const src of PRODUCT_IMAGE_SOURCES) {
    const productName = nameById.get(src.productId)
    if (!productName) {
      results.push({ productId: src.productId, name: src.productId, status: 'failed', detail: 'product_not_found_in_db' })
      continue
    }
    const existing = await listProductImages(src.productId)
    if (existing.length > 0 && !DRY_RUN) {
      results.push({ productId: src.productId, name: productName, status: 'skipped_has_image', detail: `already has ${existing.length} image(s)` })
      continue
    }
    try {
      results.push(await processProduct(src, productName))
    } catch (err) {
      results.push({ productId: src.productId, name: productName, status: 'failed', detail: (err as Error).message })
    }
  }

  results.sort((a, b) => a.productId.localeCompare(b.productId))
  console.log(`\n${DRY_RUN ? '[DRY RUN] ' : ''}Product image population report\n${'='.repeat(60)}`)
  for (const r of results) {
    console.log(`${r.productId}\t${r.status}\t${r.name}\t${r.detail}`)
  }
  const uploaded = results.filter(r => r.status === 'uploaded').length
  const wouldUpload = results.filter(r => r.status === 'would_upload').length
  console.log(`\nTotal: ${results.length} | uploaded: ${uploaded} | would_upload: ${wouldUpload} | other: ${results.length - uploaded - wouldUpload}`)
  if (!DRY_RUN) {
    console.log('\nReview every uploaded image in the admin product image manager before trusting it — especially any entry logged with confidence=low or confidence=close.')
  }
}

import path from 'node:path'
import { fileURLToPath } from 'node:url'
const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMainModule) {
  main()
    .then(() => pool.end())
    .catch(async err => {
      console.error(err)
      await pool.end()
      process.exit(1)
    })
}
