import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import cookieParser from 'cookie-parser'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import multer from 'multer'
import { pool } from './db.js'
import { assertMigrationsUpToDate } from './checkMigrations.js'
import { attachUser } from './auth.js'
import { isRequestOriginAllowed } from './csrfOriginCheck.js'
import { isContentTypeAllowed } from './contentTypeCheck.js'
import { isSensitivePath } from './staticFallbackCheck.js'
import { attachRequestId } from './requestId.js'
import { apiRequestLogger } from './httpLogger.js'
import { logger, logEvent, logError } from './logger.js'
import { logStartupConfigSummary } from './config.js'
import { authRouter } from './routes/auth.js'
import { ordersRouter } from './routes/orders.js'
import { adminOrdersRouter } from './routes/adminOrders.js'
import { catalogRouter } from './routes/catalog.js'
import { adminProductsRouter } from './routes/adminProducts.js'
import { adminBulkPricingRouter } from './routes/adminBulkPricing.js'
import { adminBulkStockRouter } from './routes/adminBulkStock.js'
import { adminBulkCostRouter } from './routes/adminBulkCost.js'
import { adminProductImagesRouter } from './routes/adminProductImages.js'
import { adminBarcodeLabelsRouter } from './routes/adminBarcodeLabels.js'
import { adminSearchRouter } from './routes/adminSearch.js'
import { adminSupportRouter } from './routes/adminSupport.js'
import { adminProductAlternativesRouter } from './routes/adminProductAlternatives.js'
import { adminSuppliersRouter } from './routes/adminSuppliers.js'
import { adminPurchaseOrdersRouter } from './routes/adminPurchaseOrders.js'
import { adminGoodsReceivingRouter } from './routes/adminGoodsReceiving.js'
import { adminInventoryBatchesRouter } from './routes/adminInventoryBatches.js'
import { adminStockWriteOffsRouter } from './routes/adminStockWriteOffs.js'
import { adminSupplierReturnsRouter } from './routes/adminSupplierReturns.js'
import { adminCustomerReturnsRouter } from './routes/adminCustomerReturns.js'
import { adminReplenishmentRouter } from './routes/adminReplenishment.js'
import { adminInventoryValuationRouter } from './routes/adminInventoryValuation.js'
import { adminCategoriesRouter } from './routes/adminCategories.js'
import { adminCustomersRouter } from './routes/adminCustomers.js'
import { adminReferralsRouter } from './routes/adminReferrals.js'
import { discountsRouter } from './routes/discounts.js'
import { adminDiscountsRouter } from './routes/adminDiscounts.js'
import { promotionsRouter } from './routes/promotions.js'
import { adminPromotionsRouter } from './routes/adminPromotions.js'
import { adminStockMovementsRouter } from './routes/adminStockMovements.js'
import { adminCycleCountsRouter } from './routes/adminCycleCounts.js'
import { adminAlertsRouter } from './routes/adminAlerts.js'
import { adminUsersRouter } from './routes/adminUsers.js'
import { adminRolesRouter } from './routes/adminRoles.js'
import { adminWhatsappRouter } from './routes/adminWhatsapp.js'
import { bannersRouter } from './routes/banners.js'
import { adminBannersRouter } from './routes/adminBanners.js'
import { settingsRouter } from './routes/settings.js'
import { adminSettingsRouter } from './routes/adminSettings.js'
import { adminExpensesRouter } from './routes/adminExpenses.js'
import { adminRidersRouter } from './routes/adminRiders.js'
import { riderRouter } from './routes/rider.js'
import { adminSettlementsRouter } from './routes/adminSettlements.js'
import { adminAuditLogsRouter } from './routes/adminAuditLogs.js'
import { adminAnalyticsRouter } from './routes/adminAnalytics.js'
import { adminIntegrationsRouter } from './routes/adminIntegrations.js'
import { adminSecurityStatusRouter } from './routes/adminSecurityStatus.js'
import { adminPagesRouter } from './routes/adminPages.js'
import { pagesRouter } from './routes/pages.js'
import { trackRouter } from './routes/track.js'
import { addressesRouter } from './routes/addresses.js'
import { favoritesRouter } from './routes/favorites.js'
import { supportRouter } from './routes/support.js'
import { shoppingListsRouter } from './routes/shoppingLists.js'
import { notificationsRouter } from './routes/notifications.js'
import { frequentlyPurchasedRouter } from './routes/frequentlyPurchased.js'
import { deliveryRouter } from './routes/delivery.js'
import { adminDeliveryRouter } from './routes/adminDelivery.js'
import { seoRouter } from './routes/seo.js'
import { loyaltyRouter } from './routes/loyalty.js'
import { cartSnapshotRouter } from './routes/cartSnapshot.js'
import { backInStockRouter } from './routes/backInStock.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DEV_ORIGIN = process.env.DEV_ORIGIN ?? 'http://localhost:5183'
const isProduction = process.env.NODE_ENV === 'production'

// السيرفر نفسه ما بينشئش/يعدّلش أي مخطط قاعدة بيانات — ده مسؤولية "npm run db:migrate"
// كخطوة نشر منفصلة وصريحة. هنا بس نتأكد إن الترحيلات المطلوبة اتطبقت فعلاً، ونرفض نقلع
// لو في نقص بدل ما نشتغل بصمت على مخطط قديم/ناقص.
await assertMigrationsUpToDate()
logEvent('database_connected')
logStartupConfigSummary()

export const app = express()
app.disable('x-powered-by')

// CSP مخصص لطبيعة المشروع الفعلية: خطين ثابتين (المتجر واللوحة) بيتصلوا بالـ API من نفس
// الأصل، مفيش أي كود inline (كل شيء JS مبني كملفات منفصلة عن طريق Vite)، وصور المنتجات من
// Cloudinary + خط Tajawal من Google Fonts هما المصدرين الخارجيين الوحيدين المستخدمين فعلياً.
// COEP متعطّل عمداً — تفعيله ممكن يمنع تحميل صور Cloudinary لو مفيش هيدر CORP منها.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      // https://challenges.cloudflare.com مطلوب لتحميل سكريبت وعرض iframe Turnstile —
      // متطلب موثّق من Cloudflare نفسها لتشغيل الـ widget تحت CSP صارم. لا يُضاف غير ده.
      scriptSrc: ["'self'", 'https://challenges.cloudflare.com'],
      styleSrc: ["'self'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'https://res.cloudinary.com'],
      connectSrc: ["'self'"],
      manifestSrc: ["'self'"],
      workerSrc: ["'self'"],
      frameSrc: ["'self'", 'https://challenges.cloudflare.com'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"]
    }
  },
  crossOriginEmbedderPolicy: false
}))

app.use(attachRequestId)
app.use(apiRequestLogger)

// الويب (تطوير وإنتاج) بيكلّم الـ API من نفس الأصل (/api) فمحتاجش CORS خالص — القائمة دي
// موجودة بس عشان بيئة التطوير المحلية (منفذ Vite المختلف عن السيرفر).
const ALLOWED_ORIGINS = new Set([DEV_ORIGIN])

app.use(cors({
  origin(origin, callback) {
    // مفيش هيدر Origin خالص (نفس الأصل، أو أداة زي curl) — مسموح دايماً.
    if (!origin) { callback(null, true); return }
    if (ALLOWED_ORIGINS.has(origin)) { callback(null, true); return }
    // في التطوير بس: مسموح بأي أصل http محلي (منافذ Vite بتتغيّر). الإنتاج مقيّد بالقائمة الصريحة فقط.
    callback(null, !isProduction)
  },
  credentials: true
}))

// بدون مصادقة، بدون أي اعتماد تاني غير قاعدة البيانات — يُستخدم كـ Railway healthcheck.
app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1')
    res.status(200).json({ status: 'ok' })
  } catch {
    logError('healthcheck_failed', {})
    res.status(503).json({ status: 'error' })
  }
})

// عام بدون مصادقة، وقبل أي middleware خاص بـ /api — بيرجع نصوص/XML ثابتة أو شبه ثابتة،
// مش بيانات مستخدم، فمحتاجش body parser ولا الكوكيز.
app.use(seoRouter)

// حدّ أكبر مقصور بس على مسارات المنتجات الإدارية (استيراد CSV + تحديث السعر/المخزون/التكلفة
// بالجملة) — الوحيدة اللي بتستقبل حمولة JSON فيها لآلاف الصفوف دفعة واحدة. لازم يتسجّل قبل
// المحلل العام الأصغر تحت؛ body-parser بيتجاهل أي محاولة تحليل تانية لجسم اتحلل قبل كده،
// فترتيب التسجيل ده هو اللي بيحدد أي حد يتطبّق فعلياً على كل مسار.
app.use('/api/admin/products', express.json({ limit: '5mb' }))

// الحد الافتراضي لباقي كل الـ API — طلبات JSON عادية (تسجيل دخول، عربة، عناوين، طلبات...)
// ما بتحتاجش أكتر من كده أبداً، وأي حمولة أكبر غالباً محاولة إساءة استخدام أو خطأ عميل.
app.use(express.json({ limit: '256kb' }))
app.use(cookieParser())
app.use(attachUser)

// حماية CSRF: الكوكيز نفسها SameSite=Lax فعلياً (مش policy إضافية هنا) بيمنع المتصفح من
// إرفاقها مع أي طلب POST/PATCH/DELETE... جاي من موقع تاني أصلاً — الفحص ده طبقة صريحة
// إضافية (defense in depth) بترفض أي طلب تغيير حالة لو هيدر Origin موجود ومش من الأصل
// المسموح، حتى لو المتصفح (قديم أو مُعدّل) سمح بإرسال الكوكيز. طلب من غير هيدر Origin خالص
// (curl، تطبيقات native) بيتقبل زي ما كان دايماً — نفس منطق إعدادات CORS فوق بالظبط.
app.use('/api', (req, res, next) => {
  if (isRequestOriginAllowed(req.method, req.headers.origin, ALLOWED_ORIGINS, isProduction, req.headers.host)) { next(); return }
  res.status(403).json({ error: 'invalid_origin' })
})

// أي طلب POST/PUT/PATCH معاه جسم فعلي لازم يكون application/json أو multipart/form-data
// (رفع ملفات) — أي نوع تاني (نص، XML، form-urlencoded) مرفوض بوضوح بدل ما يوصل لمنطق
// المسار ويتفسّر غلط بصمت (express.json() أصلاً بيتجاهل أي Content-Type غير JSON صامتاً).
app.use('/api', (req, res, next) => {
  if (isContentTypeAllowed(req.method, req.headers['content-length'], req.headers['content-type'])) { next(); return }
  res.status(415).json({ error: 'unsupported_content_type' })
})

// كل استجابات /api/* ديناميكية أو خاصة بمستخدم (سلة، دفع، طلبات، محفظة، تسجيل دخول، مخزون
// لحظي) — ممنوع تتخزن في أي كاش وسيط (متصفح، CDN) حتى لو كانت الاستجابة ناجحة (200).
// service worker الواجهة عنده قواعد كاش خاصة بيه لصفحات محدودة جداً (فئات/بنرات/إعدادات)
// بتدير كاشها بنفسها بشكل صريح، بغض النظر عن الهيدر ده.
app.use('/api', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store')
  next()
})

app.use('/api/auth', authRouter)
app.use('/api/orders', ordersRouter)
app.use('/api/track', trackRouter)
app.use('/api/account/addresses', addressesRouter)
app.use('/api/account/favorites', favoritesRouter)
app.use('/api/account/support', supportRouter)
app.use('/api/account/shopping-lists', shoppingListsRouter)
app.use('/api/loyalty', loyaltyRouter)
app.use('/api/account/cart-snapshot', cartSnapshotRouter)
app.use('/api/products/notify-when-available', backInStockRouter)
app.use('/api/notifications', notificationsRouter)
app.use('/api/account/frequently-purchased', frequentlyPurchasedRouter)
app.use('/api/delivery', deliveryRouter)
app.use('/api/admin/delivery', adminDeliveryRouter)
app.use('/api', catalogRouter)
app.use('/api', discountsRouter)
app.use('/api', promotionsRouter)
app.use('/api', bannersRouter)
app.use('/api', settingsRouter)
app.use('/api', pagesRouter)
app.use('/api/admin/pages', adminPagesRouter)
app.use('/api/admin/orders', adminOrdersRouter)
app.use('/api/admin/products', adminProductsRouter)
app.use('/api/admin/products/bulk-pricing', adminBulkPricingRouter)
app.use('/api/admin/products/bulk-stock', adminBulkStockRouter)
app.use('/api/admin/products/bulk-cost', adminBulkCostRouter)
app.use('/api/admin/products', adminProductImagesRouter)
app.use('/api/admin/products', adminProductAlternativesRouter)
app.use('/api/admin/barcode-labels', adminBarcodeLabelsRouter)
app.use('/api/admin/search', adminSearchRouter)
app.use('/api/admin/support', adminSupportRouter)
app.use('/api/admin/suppliers', adminSuppliersRouter)
app.use('/api/admin/purchase-orders', adminPurchaseOrdersRouter)
app.use('/api/admin/goods-receipts', adminGoodsReceivingRouter)
app.use('/api/admin/inventory-batches', adminInventoryBatchesRouter)
app.use('/api/admin/stock-write-offs', adminStockWriteOffsRouter)
app.use('/api/admin/supplier-returns', adminSupplierReturnsRouter)
app.use('/api/admin/customer-returns', adminCustomerReturnsRouter)
app.use('/api/admin/replenishment', adminReplenishmentRouter)
app.use('/api/admin/inventory-valuation', adminInventoryValuationRouter)
app.use('/api/admin/audit-logs', adminAuditLogsRouter)
app.use('/api/admin/categories', adminCategoriesRouter)
app.use('/api/admin/customers', adminCustomersRouter)
app.use('/api/admin/referrals', adminReferralsRouter)
app.use('/api/admin/discounts', adminDiscountsRouter)
app.use('/api/admin/promotions', adminPromotionsRouter)
app.use('/api/admin/stock-movements', adminStockMovementsRouter)
app.use('/api/admin/cycle-counts', adminCycleCountsRouter)
app.use('/api/admin/alerts', adminAlertsRouter)
app.use('/api/admin/users', adminUsersRouter)
app.use('/api/admin/roles', adminRolesRouter)
app.use('/api/admin/whatsapp', adminWhatsappRouter)
app.use('/api/admin/banners', adminBannersRouter)
app.use('/api/admin/settings', adminSettingsRouter)
app.use('/api/admin/expenses', adminExpensesRouter)
app.use('/api/admin/riders', adminRidersRouter)
app.use('/api/rider', riderRouter)
app.use('/api/admin/settlements', adminSettlementsRouter)
app.use('/api/admin/analytics', adminAnalyticsRouter)
app.use('/api/admin/integrations', adminIntegrationsRouter)
app.use('/api/admin/security-status', adminSecurityStatusRouter)

if (isProduction) {
  const clientDir = path.join(__dirname, '..', '..', 'dist')
  const adminDir = path.join(__dirname, '..', '..', 'admin', 'dist')

  // ملفات Vite جوه /assets/ بيتسمّى اسمها بـ hash المحتوى — فآمن تماماً نديها كاش طويل
  // وimmutable (سنة كاملة). أي ملف تاني (index.html, manifest, service worker نفسه) بيتغيّر
  // بنفس الاسم في كل نشر جديد، فلازم يتحقق من السيرفر كل مرة (no-cache) عشان المستخدمين
  // ياخدوا التحديثات الجديدة فوراً من غير ما يعلقوا على نسخة قديمة متخزنة.
  const staticOptions: Parameters<typeof express.static>[1] = {
    setHeaders(res, filePath) {
      if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
      } else {
        res.setHeader('Cache-Control', 'no-cache')
      }
    }
  }

  app.use('/admin', express.static(adminDir, staticOptions))
  app.use(express.static(clientDir, staticOptions))
  app.use((req, res, next) => {
    // بيسمح بس بمسارات التنقل جوه الـ SPA (زي /product/tomato) ترجع index.html.
    // أي مسار بامتداد ملف (.js, .css, .png...) يبقى أكيد طلب أصل ثابت مش موجود —
    // لازم يرجع 404 حقيقي، عشان لو الملف مش موجود (نسخة قديمة متخزنة في الموبايل/service
    // worker بتشاور على hash قديم بعد نشر جديد مثلاً) الفرونت إند ياخد خطأ واضح بدل ما
    // ياخد صفحة HTML كاملة بـ 200 مكان الملف ويحصله خطأ تشغيل غامض.
    const lastSegment = req.path.split('/').pop() ?? ''
    if (req.method !== 'GET' || req.path.startsWith('/api') || lastSegment.includes('.') || isSensitivePath(req.path)) {
      next()
      return
    }
    res.sendFile(path.join(req.path.startsWith('/admin') ? adminDir : clientDir, 'index.html'))
  })
}

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'not_found' })
})

app.use((_req, res) => {
  res.status(404).send('Not Found')
})

app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof multer.MulterError) {
    res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'file_too_large' : 'upload_error' })
    return
  }
  // جسم الطلب (express.json) تعدّى الحد المسموح — نفس رسالة رفع الملفات الكبيرة، لكن كود
  // حالة HTTP الصحيح لحمولة JSON زيادة عن اللازم هو 413 (مش 400).
  if (err && typeof err === 'object' && 'type' in err && (err as { type: unknown }).type === 'entity.too.large') {
    res.status(413).json({ error: 'payload_too_large' })
    return
  }
  // جسم JSON غير صالح نحوياً (body-parser بيرمي SyntaxError بـ type: 'entity.parse.failed')
  // — خطأ من العميل نفسه، مش السيرفر، فكود الحالة الصحيح 400 (مش 500 العام).
  if (err && typeof err === 'object' && 'type' in err && (err as { type: unknown }).type === 'entity.parse.failed') {
    res.status(400).json({ error: 'invalid_json' })
    return
  }
  // اللوج هنا فيه تفاصيل الخطأ الكاملة (stack) للسيرفر بس — العميل بياخد رسالة عامة آمنة
  // من غير أي stack trace أو تفاصيل داخلية.
  logger.error({
    event: 'unhandled_error',
    requestId: req.requestId,
    path: req.path,
    method: req.method,
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined
  })
  res.status(500).json({ error: 'server_error' })
})
