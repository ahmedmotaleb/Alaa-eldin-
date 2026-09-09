// اختبارات تكامل حقيقية على قاعدة بيانات اختبار فعلية — نفس أسلوب باقي خدمات هذا المشروع.
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { pool } from '../db.js'
import {
  getRevenueByDay, getOverviewStats, getSalesStats, getRevenueByCategory, getTopProducts,
  getRevenueBySlot, getProductStats, getRegionRevenue, getOrdersBreakdown, getHomeSummary
} from './analyticsService.js'

const CATEGORY_A = 'test-cat-an-a'
const CATEGORY_B = 'test-cat-an-b'
const PRODUCT_A = 'test-prod-an-a'
const PRODUCT_B = 'test-prod-an-b'

async function resetFixtures() {
  await pool.query('DELETE FROM stock_movements')
  await pool.query('DELETE FROM order_items')
  await pool.query('DELETE FROM orders')
  await pool.query('DELETE FROM products')
  await pool.query('DELETE FROM categories')

  await pool.query(`INSERT INTO categories (id, name, emoji, tint, sort_order) VALUES ($1, 'قسم أ', '🧪', '#fff', 1)`, [CATEGORY_A])
  await pool.query(`INSERT INTO categories (id, name, emoji, tint, sort_order) VALUES ($1, 'قسم ب', '🧪', '#fff', 2)`, [CATEGORY_B])
  await pool.query(
    `INSERT INTO products (id, slug, category_id, name, description, price, cost, unit, emoji, available, stock, created_at)
     VALUES ($1, $1, $2, 'منتج أ', 'وصف', 25, 10, 'قطعة', '🧪', 1, 20, now())`,
    [PRODUCT_A, CATEGORY_A]
  )
  await pool.query(
    `INSERT INTO products (id, slug, category_id, name, description, price, cost, unit, emoji, available, stock, created_at)
     VALUES ($1, $1, $2, 'منتج ب', 'وصف', 40, 15, 'قطعة', '🧪', 1, 20, now())`,
    [PRODUCT_B, CATEGORY_B]
  )
}

interface OrderFixture {
  id: string
  status?: string
  total?: number
  governorate?: string
  deliverySlot?: string
  createdAt?: string
  items?: { productId: string, name?: string, quantity: number, lineTotal: number }[]
}

async function insertOrder(fixture: OrderFixture) {
  const total = fixture.total ?? 100
  await pool.query(
    `INSERT INTO orders (id, order_number, user_id, created_at, delivery_slot, payment_method,
       customer_full_name, customer_mobile, customer_governorate, customer_address,
       subtotal, delivery_fee, total, status, discount_amount)
     VALUES ($1, $1, NULL, $2, $3, 'COD', 'عميل اختبار', '01012345678', $4, 'عنوان اختبار', $5, 0, $5, $6, 0)`,
    [fixture.id, fixture.createdAt ?? new Date().toISOString(), fixture.deliverySlot ?? 'now', fixture.governorate ?? 'القاهرة', total, fixture.status ?? 'placed']
  )
  for (const item of fixture.items ?? []) {
    await pool.query(
      'INSERT INTO order_items (order_id, product_id, name, unit, unit_price, quantity, line_total) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [fixture.id, item.productId, item.name ?? 'اسم', 'قطعة', item.lineTotal / item.quantity, item.quantity, item.lineTotal]
    )
  }
}

beforeEach(async () => {
  await resetFixtures()
})

afterAll(async () => {
  await pool.end()
})

describe('getRevenueByDay', () => {
  it('excludes cancelled orders and zero-fills days with no orders', async () => {
    const today = new Date().toISOString()
    await insertOrder({ id: 'an-day-1', total: 100, createdAt: today })
    await insertOrder({ id: 'an-day-2', total: 50, createdAt: today, status: 'cancelled' })

    const days = await getRevenueByDay(3)
    expect(days).toHaveLength(3)
    const todayBucket = days[days.length - 1]
    expect(todayBucket.revenue).toBe(100)
    expect(todayBucket.orderCount).toBe(1)
    expect(days[0].revenue).toBe(0)
    expect(days[0].orderCount).toBe(0)
  })
})

describe('getOverviewStats', () => {
  it('excludes cancelled orders from revenue/avg but counts them in totalOrders', async () => {
    await insertOrder({ id: 'an-ov-1', total: 100 })
    await insertOrder({ id: 'an-ov-2', total: 200 })
    await insertOrder({ id: 'an-ov-3', total: 999, status: 'cancelled' })

    const stats = await getOverviewStats()
    expect(stats.totalRevenue).toBe(300)
    expect(stats.totalOrders).toBe(3)
    expect(stats.avgOrderValue).toBe(150)
  })

  it('returns zeros with no orders at all', async () => {
    const stats = await getOverviewStats()
    expect(stats).toEqual({ totalRevenue: 0, totalOrders: 0, avgOrderValue: 0 })
  })
})

describe('getSalesStats', () => {
  it('computes total/avg/max revenue excluding cancelled orders', async () => {
    await insertOrder({ id: 'an-sales-1', total: 100 })
    await insertOrder({ id: 'an-sales-2', total: 300 })
    await insertOrder({ id: 'an-sales-3', total: 1000, status: 'cancelled' })

    const stats = await getSalesStats()
    expect(stats.totalRevenue).toBe(400)
    expect(stats.avgOrderValue).toBe(200)
    expect(stats.maxOrderValue).toBe(300)
  })
})

describe('getRevenueByCategory', () => {
  it('sums line totals per category, excluding cancelled orders, and includes zero-revenue categories', async () => {
    await insertOrder({ id: 'an-cat-1', items: [{ productId: PRODUCT_A, quantity: 2, lineTotal: 50 }] })
    await insertOrder({ id: 'an-cat-2', status: 'cancelled', items: [{ productId: PRODUCT_B, quantity: 5, lineTotal: 200 }] })

    const rows = await getRevenueByCategory()
    const byId = new Map(rows.map(r => [r.categoryId, r]))
    expect(byId.get(CATEGORY_A)?.revenue).toBe(50)
    expect(byId.get(CATEGORY_B)?.revenue).toBe(0)
  })
})

describe('getTopProducts', () => {
  it('sums quantity/revenue per product excluding cancelled orders, sorted by revenue desc', async () => {
    await insertOrder({ id: 'an-top-1', items: [{ productId: PRODUCT_A, quantity: 2, lineTotal: 50 }] })
    await insertOrder({ id: 'an-top-2', items: [{ productId: PRODUCT_B, quantity: 1, lineTotal: 40 }] })
    await insertOrder({ id: 'an-top-3', items: [{ productId: PRODUCT_A, quantity: 3, lineTotal: 75 }] })
    await insertOrder({ id: 'an-top-4', status: 'cancelled', items: [{ productId: PRODUCT_B, quantity: 100, lineTotal: 9999 }] })

    const rows = await getTopProducts()
    expect(rows[0]).toMatchObject({ productId: PRODUCT_A, qty: 5, revenue: 125 })
    expect(rows[1]).toMatchObject({ productId: PRODUCT_B, qty: 1, revenue: 40 })
  })

  it('preserves the historical order_items name even for a since-renamed or deleted product', async () => {
    await insertOrder({ id: 'an-top-5', items: [{ productId: 'now-deleted-product', name: 'منتج محذوف', quantity: 1, lineTotal: 30 }] })
    const rows = await getTopProducts()
    expect(rows.find(r => r.productId === 'now-deleted-product')?.name).toBe('منتج محذوف')
  })
})

describe('getRevenueBySlot', () => {
  it('groups by delivery slot, excluding cancelled orders', async () => {
    await insertOrder({ id: 'an-slot-1', deliverySlot: 'now', total: 100 })
    await insertOrder({ id: 'an-slot-2', deliverySlot: 'now', total: 50 })
    await insertOrder({ id: 'an-slot-3', deliverySlot: 'evening', total: 200 })
    await insertOrder({ id: 'an-slot-4', deliverySlot: 'evening', total: 999, status: 'cancelled' })

    const rows = await getRevenueBySlot()
    const byId = new Map(rows.map(r => [r.slot, r]))
    expect(byId.get('now')).toMatchObject({ count: 2, revenue: 150 })
    expect(byId.get('evening')).toMatchObject({ count: 1, revenue: 200 })
  })
})

describe('getProductStats', () => {
  it('counts only products that actually sold (excluding cancelled orders) vs the full catalog', async () => {
    await insertOrder({ id: 'an-prodstat-1', items: [{ productId: PRODUCT_A, quantity: 1, lineTotal: 25 }] })
    const stats = await getProductStats()
    expect(stats.soldProductCount).toBe(1)
    expect(stats.totalProductCount).toBe(2)
  })
})

describe('getRegionRevenue', () => {
  it('groups by governorate, excluding cancelled orders, with a fallback label for blank governorates', async () => {
    await insertOrder({ id: 'an-region-1', governorate: 'القاهرة', total: 100 })
    await insertOrder({ id: 'an-region-2', governorate: 'الجيزة', total: 50 })
    await insertOrder({ id: 'an-region-3', governorate: '   ', total: 999, status: 'cancelled' })
    await insertOrder({ id: 'an-region-4', governorate: '', total: 40 })

    const rows = await getRegionRevenue()
    const byGov = new Map(rows.map(r => [r.governorate, r]))
    expect(byGov.get('القاهرة')).toMatchObject({ count: 1, revenue: 100 })
    expect(byGov.get('غير محدد')).toMatchObject({ count: 1, revenue: 40 })
  })
})

describe('getOrdersBreakdown', () => {
  it('counts cancelled orders too (unlike every other analytics function) and computes avg items per order', async () => {
    await insertOrder({ id: 'an-break-1', status: 'placed', items: [{ productId: PRODUCT_A, quantity: 2, lineTotal: 50 }] })
    await insertOrder({ id: 'an-break-2', status: 'delivered', items: [{ productId: PRODUCT_B, quantity: 4, lineTotal: 160 }] })
    await insertOrder({ id: 'an-break-3', status: 'cancelled', items: [{ productId: PRODUCT_A, quantity: 1, lineTotal: 25 }] })

    const result = await getOrdersBreakdown()
    expect(result.totalOrders).toBe(3)
    expect(result.cancelledCount).toBe(1)
    expect(result.avgItemsPerOrder).toBeCloseTo((2 + 4 + 1) / 3)
    const byStatus = new Map(result.statusCounts.map(s => [s.status, s.count]))
    expect(byStatus.get('placed')).toBe(1)
    expect(byStatus.get('delivered')).toBe(1)
    expect(byStatus.get('cancelled')).toBe(1)
  })
})

describe('getHomeSummary', () => {
  it('scopes revenue/count to today only, excluding cancelled, while newOrdersCount is all-time', async () => {
    const today = new Date().toISOString()
    const yesterday = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()
    await insertOrder({ id: 'an-home-1', total: 100, createdAt: today, status: 'placed' })
    await insertOrder({ id: 'an-home-2', total: 500, createdAt: today, status: 'cancelled' })
    await insertOrder({ id: 'an-home-3', total: 300, createdAt: yesterday, status: 'placed' })

    const summary = await getHomeSummary()
    expect(summary.todayRevenue).toBe(100)
    expect(summary.todayOrderCount).toBe(1)
    expect(summary.totalOrders).toBe(3)
    expect(summary.newOrdersCount).toBe(2)
  })
})
