import { Router } from 'express'
import { requireAdmin } from '../auth.js'
import {
  getRevenueByDay, getOverviewStats, getSalesStats, getRevenueByCategory, getTopProducts,
  getRevenueBySlot, getProductStats, getRegionRevenue, getOrdersBreakdown, getHomeSummary
} from '../services/analyticsService.js'

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
