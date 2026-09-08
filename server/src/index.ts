import express from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import multer from 'multer'
import { pool } from './db.js'
import { assertMigrationsUpToDate } from './checkMigrations.js'
import { attachUser } from './auth.js'
import { attachRequestId } from './requestId.js'
import { apiRequestLogger } from './httpLogger.js'
import { logger, logEvent, logError } from './logger.js'
import { authRouter } from './routes/auth.js'
import { ordersRouter } from './routes/orders.js'
import { adminOrdersRouter } from './routes/adminOrders.js'
import { catalogRouter } from './routes/catalog.js'
import { adminProductsRouter } from './routes/adminProducts.js'
import { adminProductImagesRouter } from './routes/adminProductImages.js'
import { adminCategoriesRouter } from './routes/adminCategories.js'
import { adminCustomersRouter } from './routes/adminCustomers.js'
import { discountsRouter } from './routes/discounts.js'
import { adminDiscountsRouter } from './routes/adminDiscounts.js'
import { adminStockMovementsRouter } from './routes/adminStockMovements.js'
import { adminUsersRouter } from './routes/adminUsers.js'
import { bannersRouter } from './routes/banners.js'
import { adminBannersRouter } from './routes/adminBanners.js'
import { settingsRouter } from './routes/settings.js'
import { adminSettingsRouter } from './routes/adminSettings.js'
import { adminExpensesRouter } from './routes/adminExpenses.js'
import { adminRidersRouter } from './routes/adminRiders.js'
import { adminSettlementsRouter } from './routes/adminSettlements.js'
import { adminAuditLogsRouter } from './routes/adminAuditLogs.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT ?? 8787)
const DEV_ORIGIN = process.env.DEV_ORIGIN ?? 'http://localhost:5183'
const isProduction = process.env.NODE_ENV === 'production'

// السيرفر نفسه ما بينشئش/يعدّلش أي مخطط قاعدة بيانات — ده مسؤولية "npm run db:migrate"
// كخطوة نشر منفصلة وصريحة. هنا بس نتأكد إن الترحيلات المطلوبة اتطبقت فعلاً، ونرفض نقلع
// لو في نقص بدل ما نشتغل بصمت على مخطط قديم/ناقص.
await assertMigrationsUpToDate()
logEvent('database_connected')

const app = express()
app.disable('x-powered-by')
app.use(attachRequestId)
app.use(apiRequestLogger)

if (!isProduction) {
  app.use(cors({ origin: DEV_ORIGIN, credentials: true }))
}

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

app.use(express.json())
app.use(cookieParser())
app.use(attachUser)

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
app.use('/api', catalogRouter)
app.use('/api', discountsRouter)
app.use('/api', bannersRouter)
app.use('/api', settingsRouter)
app.use('/api/admin/orders', adminOrdersRouter)
app.use('/api/admin/products', adminProductsRouter)
app.use('/api/admin/products', adminProductImagesRouter)
app.use('/api/admin/audit-logs', adminAuditLogsRouter)
app.use('/api/admin/categories', adminCategoriesRouter)
app.use('/api/admin/customers', adminCustomersRouter)
app.use('/api/admin/discounts', adminDiscountsRouter)
app.use('/api/admin/stock-movements', adminStockMovementsRouter)
app.use('/api/admin/users', adminUsersRouter)
app.use('/api/admin/banners', adminBannersRouter)
app.use('/api/admin/settings', adminSettingsRouter)
app.use('/api/admin/expenses', adminExpensesRouter)
app.use('/api/admin/riders', adminRidersRouter)
app.use('/api/admin/settlements', adminSettlementsRouter)

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
    if (req.method !== 'GET' || req.path.startsWith('/api')) {
      next()
      return
    }
    res.sendFile(path.join(req.path.startsWith('/admin') ? adminDir : clientDir, 'index.html'))
  })
}

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'not_found' })
})

app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof multer.MulterError) {
    res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'file_too_large' : 'upload_error' })
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

app.listen(PORT, () => {
  logEvent('server_started', { port: PORT })
})
