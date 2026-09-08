import express from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { pool } from './db.js'
import { assertMigrationsUpToDate } from './checkMigrations.js'
import { attachUser } from './auth.js'
import { authRouter } from './routes/auth.js'
import { ordersRouter } from './routes/orders.js'
import { adminOrdersRouter } from './routes/adminOrders.js'
import { catalogRouter } from './routes/catalog.js'
import { adminProductsRouter } from './routes/adminProducts.js'
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

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT ?? 8787)
const DEV_ORIGIN = process.env.DEV_ORIGIN ?? 'http://localhost:5183'
const isProduction = process.env.NODE_ENV === 'production'

// السيرفر نفسه ما بينشئش/يعدّلش أي مخطط قاعدة بيانات — ده مسؤولية "npm run db:migrate"
// كخطوة نشر منفصلة وصريحة. هنا بس نتأكد إن الترحيلات المطلوبة اتطبقت فعلاً، ونرفض نقلع
// لو في نقص بدل ما نشتغل بصمت على مخطط قديم/ناقص.
await assertMigrationsUpToDate()

const app = express()
app.disable('x-powered-by')

if (!isProduction) {
  app.use(cors({ origin: DEV_ORIGIN, credentials: true }))
}

// بدون مصادقة، بدون أي اعتماد تاني غير قاعدة البيانات — يُستخدم كـ Railway healthcheck.
app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1')
    res.status(200).json({ status: 'ok' })
  } catch {
    res.status(503).json({ status: 'error' })
  }
})

app.use(express.json())
app.use(cookieParser())
app.use(attachUser)

app.use('/api/auth', authRouter)
app.use('/api/orders', ordersRouter)
app.use('/api', catalogRouter)
app.use('/api', discountsRouter)
app.use('/api', bannersRouter)
app.use('/api', settingsRouter)
app.use('/api/admin/orders', adminOrdersRouter)
app.use('/api/admin/products', adminProductsRouter)
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
  app.use('/admin', express.static(adminDir))
  app.use(express.static(clientDir))
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

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err)
  res.status(500).json({ error: 'server_error' })
})

app.listen(PORT, () => {
  console.log(`API server listening on http://localhost:${PORT}`)
})
