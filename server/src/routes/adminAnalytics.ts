import { Router } from 'express'
import { requireAdmin, requirePermission } from '../auth.js'
import {
  getRevenueByDay, getOverviewStats, getSalesStats, getRevenueByCategory, getTopProducts,
  getRevenueBySlot, getProductStats, getRegionRevenue, getOrdersBreakdown, getHomeSummary,
  getRiderPerformance
} from '../services/analyticsService.js'
import { getPurchasingInventoryAnalytics } from '../services/purchasingInventoryAnalyticsService.js'
import { todayInCairo, addCalendarDays, isValidCalendarDateString } from '../cairoDate.js'

export const adminAnalyticsRouter = Router()
adminAnalyticsRouter.use(requireAdmin)

const OVERVIEW_CHART_DAYS = 14
const HOME_CHART_DAYS = 7
const HOME_TOP_PRODUCTS_LIMIT = 5

adminAnalyticsRouter.get('/overview', async (_req, res) => {
  const [stats, revenueByDay, revenueByCategory] = await Promise.all([
    getOverviewStats(),
    getRevenueByDay(OVERVIEW_CHART_DAYS),
    getRevenueByCategory()
  ])
  res.json({ ...stats, revenueByDay, revenueByCategory })
})

adminAnalyticsRouter.get('/sales', async (_req, res) => {
  const [stats, revenueByDay, revenueBySlot] = await Promise.all([
    getSalesStats(),
    getRevenueByDay(OVERVIEW_CHART_DAYS),
    getRevenueBySlot()
  ])
  res.json({ ...stats, revenueByDay, revenueBySlot })
})

adminAnalyticsRouter.get('/products', async (_req, res) => {
  const [productStats, topProducts, revenueByCategory] = await Promise.all([
    getProductStats(),
    getTopProducts(),
    getRevenueByCategory()
  ])
  res.json({ ...productStats, topProducts, revenueByCategory })
})

adminAnalyticsRouter.get('/regions', async (_req, res) => {
  res.json({ regions: await getRegionRevenue() })
})

adminAnalyticsRouter.get('/orders-breakdown', async (_req, res) => {
  res.json(await getOrdersBreakdown())
})

adminAnalyticsRouter.get('/riders', async (_req, res) => {
  res.json({ riders: await getRiderPerformance() })
})

adminAnalyticsRouter.get('/home-summary', async (_req, res) => {
  const [summary, revenueByDay, topProducts] = await Promise.all([
    getHomeSummary(),
    getRevenueByDay(HOME_CHART_DAYS),
    getTopProducts()
  ])
  res.json({
    ...summary,
    revenueByDay,
    topProducts: topProducts.slice().sort((a, b) => b.qty - a.qty).slice(0, HOME_TOP_PRODUCTS_LIMIT)
  })
})

const PURCHASING_ANALYTICS_DAY_OPTIONS = new Set([7, 30, 90])
const MAX_PURCHASING_ANALYTICS_LIMIT = 200
const DEFAULT_PURCHASING_ANALYTICS_LIMIT = 50

adminAnalyticsRouter.get('/purchasing-inventory', requirePermission('analytics.view'), async (req, res) => {
  const today = todayInCairo()
  let fromDate: string
  let toDate: string
  if (isValidCalendarDateString(req.query.fromDate) && isValidCalendarDateString(req.query.toDate)) {
    fromDate = req.query.fromDate
    toDate = req.query.toDate
  } else {
    const days = PURCHASING_ANALYTICS_DAY_OPTIONS.has(Number(req.query.days)) ? Number(req.query.days) : 30
    toDate = today
    fromDate = addCalendarDays(today, -(days - 1))
  }
  if (fromDate > toDate) {
    res.status(400).json({ error: 'invalid_date_range' })
    return
  }

  const limit = Math.min(MAX_PURCHASING_ANALYTICS_LIMIT, Math.max(1, parseInt(String(req.query.limit ?? DEFAULT_PURCHASING_ANALYTICS_LIMIT), 10) || DEFAULT_PURCHASING_ANALYTICS_LIMIT))
  const supplierId = typeof req.query.supplierId === 'string' && req.query.supplierId.trim() ? req.query.supplierId.trim() : undefined
  const categoryId = typeof req.query.categoryId === 'string' && req.query.categoryId.trim() ? req.query.categoryId.trim() : undefined

  const analytics = await getPurchasingInventoryAnalytics({ fromDate, toDate, supplierId, categoryId, limit })
  res.json({ fromDate, toDate, ...analytics })
})
