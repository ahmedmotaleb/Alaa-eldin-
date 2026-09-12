import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import crypto from 'node:crypto'
import { pool } from '../db.js'
import { getAlerts } from './alertsService.js'

const CATEGORY_ID = 'test-cat-alerts'
const PRODUCT_ID = 'test-prod-alerts'
const SUPPLIER_ID = 'test-supplier-alerts'
const RIDER_ID = 'test-rider-alerts'
const ORDER_ID = 'test-order-alerts'
const CUSTOMER_RETURN_ID = 'test-cr-alerts'
const SUPPLIER_RETURN_ID = 'test-sr-alerts'

// كل التنبيهات هنا محسوبة على مستوى النظام كله (مش على فلتر id معيّن)، فيها بيانات تانية
// حقيقية أو تجريبية موجودة أصلاً في القاعدة — الاختبارات هنا بتقارن العدد *قبل وبعد* إضافة
// بيانات الاختبار (delta) بدل افتراض عدد مطلق، عشان تفضل صحيحة بغض النظر عن أي بيانات تانية.
async function alertCount(category: string): Promise<number> {
  const alerts = await getAlerts()
  return alerts.find(a => a.category === category)?.count ?? 0
}

async function resetFixtures() {
  await pool.query('DELETE FROM order_items WHERE order_id = $1', [ORDER_ID])
  await pool.query('DELETE FROM customer_returns WHERE id = $1', [CUSTOMER_RETURN_ID])
  await pool.query('DELETE FROM supplier_returns WHERE id = $1', [SUPPLIER_RETURN_ID])
  await pool.query('DELETE FROM orders WHERE id = $1', [ORDER_ID])
  await pool.query('DELETE FROM riders WHERE id = $1', [RIDER_ID])
  await pool.query('DELETE FROM suppliers WHERE id = $1', [SUPPLIER_ID])
  await pool.query('DELETE FROM products WHERE id = $1', [PRODUCT_ID])
  await pool.query('DELETE FROM categories WHERE id = $1', [CATEGORY_ID])

  await pool.query(`INSERT INTO categories (id, name, emoji, tint, sort_order) VALUES ($1, 'فئة تنبيهات', '🧪', '#fff', 1)`, [CATEGORY_ID])
}

describe('alertsService.getAlerts', () => {
  beforeEach(resetFixtures)
  afterAll(resetFixtures)

  it('counts a product at or below its alert threshold as a low_stock alert', async () => {
    const before = await alertCount('low_stock')
    await pool.query(
      `INSERT INTO products (id, slug, category_id, name, description, price, cost, unit, emoji, available, stock, alert_threshold, created_at)
       VALUES ($1, 'alerts-low-stock', $2, 'منتج منخفض المخزون', 'وصف', 10, 5, 'وحدة', '🧪', 1, 1, 5, now())`,
      [PRODUCT_ID, CATEGORY_ID]
    )
    expect(await alertCount('low_stock')).toBe(before + 1)
  })

  it('does not count an unavailable low-stock product', async () => {
    const before = await alertCount('low_stock')
    await pool.query(
      `INSERT INTO products (id, slug, category_id, name, description, price, cost, unit, emoji, available, stock, alert_threshold, created_at)
       VALUES ($1, 'alerts-low-stock-unavailable', $2, 'منتج غير متاح', 'وصف', 10, 5, 'وحدة', '🧪', 0, 1, 5, now())`,
      [PRODUCT_ID, CATEGORY_ID]
    )
    expect(await alertCount('low_stock')).toBe(before)
  })

  it('counts an order stuck in a non-final status for more than 6 hours', async () => {
    const before = await alertCount('stuck_orders')
    await pool.query(
      `INSERT INTO orders (id, order_number, created_at, delivery_slot, payment_method, customer_full_name, customer_mobile, customer_address, subtotal, delivery_fee, total, status)
       VALUES ($1, $1, now() - interval '7 hours', 'now', 'cod', 'عميل اختبار', '01000000000', 'عنوان', 100, 10, 110, 'placed')`,
      [ORDER_ID]
    )
    expect(await alertCount('stuck_orders')).toBe(before + 1)
  })

  it('does not count a recent order in a non-final status', async () => {
    const before = await alertCount('stuck_orders')
    await pool.query(
      `INSERT INTO orders (id, order_number, created_at, delivery_slot, payment_method, customer_full_name, customer_mobile, customer_address, subtotal, delivery_fee, total, status)
       VALUES ($1, $1, now() - interval '1 hour', 'now', 'cod', 'عميل اختبار', '01000000000', 'عنوان', 100, 10, 110, 'placed')`,
      [ORDER_ID]
    )
    expect(await alertCount('stuck_orders')).toBe(before)
  })

  it('counts a customer return awaiting review', async () => {
    await pool.query(
      `INSERT INTO orders (id, order_number, created_at, delivery_slot, payment_method, customer_full_name, customer_mobile, customer_address, subtotal, delivery_fee, total, status)
       VALUES ($1, $1, now(), 'now', 'cod', 'عميل اختبار', '01000000000', 'عنوان', 100, 10, 110, 'delivered')`,
      [ORDER_ID]
    )
    const before = await alertCount('pending_customer_returns')
    await pool.query(
      `INSERT INTO customer_returns (id, return_number, order_id, status) VALUES ($1, $1, $2, 'requested')`,
      [CUSTOMER_RETURN_ID, ORDER_ID]
    )
    expect(await alertCount('pending_customer_returns')).toBe(before + 1)
  })

  it('counts a draft supplier return as pending', async () => {
    await pool.query(
      `INSERT INTO suppliers (id, name) VALUES ($1, 'مورد اختبار')`,
      [SUPPLIER_ID]
    )
    const before = await alertCount('pending_supplier_returns')
    await pool.query(
      `INSERT INTO supplier_returns (id, return_number, supplier_id, status) VALUES ($1, $1, $2, 'draft')`,
      [SUPPLIER_RETURN_ID, SUPPLIER_ID]
    )
    expect(await alertCount('pending_supplier_returns')).toBe(before + 1)
  })

  it('counts a rider with unsettled delivered cash', async () => {
    await pool.query(`INSERT INTO riders (id, name, created_at) VALUES ($1, 'مندوب اختبار', now())`, [RIDER_ID])
    const before = await alertCount('unsettled_rider_cash')
    await pool.query(
      `INSERT INTO orders (id, order_number, created_at, delivery_slot, payment_method, customer_full_name, customer_mobile, customer_address, subtotal, delivery_fee, total, status, rider_id, settlement_id)
       VALUES ($1, $1, now(), 'now', 'cod', 'عميل اختبار', '01000000000', 'عنوان', 100, 10, 110, 'delivered', $2, NULL)`,
      [ORDER_ID, RIDER_ID]
    )
    expect(await alertCount('unsettled_rider_cash')).toBe(before + 1)
  })

  it('omits a category entirely when its count is zero', async () => {
    const alerts = await getAlerts()
    for (const alert of alerts) {
      expect(alert.count).toBeGreaterThan(0)
    }
  })
})
