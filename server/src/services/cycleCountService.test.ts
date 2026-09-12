import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { pool } from '../db.js'
import {
  createCycleCount,
  listCycleCounts,
  getCycleCount,
  recordCounts,
  completeCycleCount,
  cancelCycleCount
} from './cycleCountService.js'

const CATEGORY_ID = 'test-cat-cyclecount'
const OTHER_CATEGORY_ID = 'test-cat-cyclecount-other'
const PRODUCT_A = 'test-prod-cc-a'
const PRODUCT_B = 'test-prod-cc-b'
const PRODUCT_OTHER_CAT = 'test-prod-cc-other-cat'
const USER_ID = 'test-user-cyclecount'

async function resetFixtures() {
  await pool.query('DELETE FROM stock_movements WHERE product_id = ANY($1::text[])', [[PRODUCT_A, PRODUCT_B, PRODUCT_OTHER_CAT]])
  await pool.query('DELETE FROM cycle_count_items WHERE product_id = ANY($1::text[])', [[PRODUCT_A, PRODUCT_B, PRODUCT_OTHER_CAT]])
  await pool.query('DELETE FROM cycle_counts WHERE created_by_user_id = $1', [USER_ID])
  await pool.query('DELETE FROM products WHERE id = ANY($1::text[])', [[PRODUCT_A, PRODUCT_B, PRODUCT_OTHER_CAT]])
  await pool.query('DELETE FROM categories WHERE id = ANY($1::text[])', [[CATEGORY_ID, OTHER_CATEGORY_ID]])
  await pool.query('DELETE FROM users WHERE id = $1', [USER_ID])

  await pool.query(`INSERT INTO categories (id, name, emoji, tint, sort_order) VALUES ($1, 'فئة جرد', '🧪', '#fff', 1)`, [CATEGORY_ID])
  await pool.query(`INSERT INTO categories (id, name, emoji, tint, sort_order) VALUES ($1, 'فئة تانية', '🧪', '#fff', 2)`, [OTHER_CATEGORY_ID])
  await pool.query(
    `INSERT INTO products (id, slug, category_id, name, description, price, cost, unit, emoji, available, stock, sku, barcode, created_at)
     VALUES ($1, 'cc-prod-a', $2, 'منتج أ', 'وصف', 10, 5, 'وحدة', '🧪', 1, 20, 'SKU-A', 'BC-A', now())`,
    [PRODUCT_A, CATEGORY_ID]
  )
  await pool.query(
    `INSERT INTO products (id, slug, category_id, name, description, price, cost, unit, emoji, available, stock, sku, barcode, created_at)
     VALUES ($1, 'cc-prod-b', $2, 'منتج ب', 'وصف', 10, 5, 'وحدة', '🧪', 1, 15, 'SKU-B', 'BC-B', now())`,
    [PRODUCT_B, CATEGORY_ID]
  )
  await pool.query(
    `INSERT INTO products (id, slug, category_id, name, description, price, cost, unit, emoji, available, stock, sku, barcode, created_at)
     VALUES ($1, 'cc-prod-other', $2, 'منتج فئة تانية', 'وصف', 10, 5, 'وحدة', '🧪', 1, 5, 'SKU-C', 'BC-C', now())`,
    [PRODUCT_OTHER_CAT, OTHER_CATEGORY_ID]
  )
  await pool.query(
    `INSERT INTO users (id, email, password_hash, full_name, created_at, is_admin, role)
     VALUES ($1, 'cyclecount-tester@test.local', 'x', 'مختبر', now(), 1, 'admin')`,
    [USER_ID]
  )
}

describe('cycleCountService', () => {
  beforeEach(resetFixtures)
  afterAll(resetFixtures)

  it('creates a cycle count scoped to a category, snapshotting current stock', async () => {
    const created = await createCycleCount({ categoryId: CATEGORY_ID, note: 'جرد شهري', userId: USER_ID })
    if ('error' in created) throw new Error('unexpected error')

    const detail = await getCycleCount(created.id)
    expect(detail).toBeTruthy()
    expect(detail!.items).toHaveLength(2)
    expect(detail!.status).toBe('draft')
    const itemA = detail!.items.find(i => i.productId === PRODUCT_A)
    expect(itemA?.systemQuantity).toBe(20)
    expect(itemA?.countedQuantity).toBeNull()
    expect(detail!.items.some(i => i.productId === PRODUCT_OTHER_CAT)).toBe(false)
  })

  it('rejects creation for an unknown category', async () => {
    const result = await createCycleCount({ categoryId: 'no-such-category', userId: USER_ID })
    expect(result).toEqual({ error: 'category_not_found' })
  })

  it('lists cycle counts with item/counted/variance summary counts', async () => {
    const created = await createCycleCount({ categoryId: CATEGORY_ID, userId: USER_ID })
    if ('error' in created) throw new Error('unexpected error')
    await recordCounts(created.id, [{ productId: PRODUCT_A, countedQuantity: 18 }])

    const list = await listCycleCounts()
    const entry = list.find(c => c.id === created.id)
    expect(entry).toBeTruthy()
    expect(entry!.itemCount).toBe(2)
    expect(entry!.countedCount).toBe(1)
    expect(entry!.varianceCount).toBe(1)
  })

  it('records counts, ignoring unknown product ids', async () => {
    const created = await createCycleCount({ categoryId: CATEGORY_ID, userId: USER_ID })
    if ('error' in created) throw new Error('unexpected error')

    const result = await recordCounts(created.id, [
      { productId: PRODUCT_A, countedQuantity: 19 },
      { productId: 'does-not-exist', countedQuantity: 5 }
    ])
    expect(result).toEqual({ updated: 1, skipped: ['does-not-exist'] })
  })

  it('rejects recording counts on a non-draft cycle count', async () => {
    const created = await createCycleCount({ categoryId: CATEGORY_ID, userId: USER_ID })
    if ('error' in created) throw new Error('unexpected error')
    await cancelCycleCount(created.id)

    const result = await recordCounts(created.id, [{ productId: PRODUCT_A, countedQuantity: 19 }])
    expect(result).toEqual({ error: 'not_draft' })
  })

  it('completes a cycle count, adjusting stock and recording a stock movement only for varied items', async () => {
    const created = await createCycleCount({ categoryId: CATEGORY_ID, userId: USER_ID })
    if ('error' in created) throw new Error('unexpected error')

    // منتج أ: نفس الكمية (20) — من غير فرق. منتج ب: فرق فعلي (15 -> 12).
    await recordCounts(created.id, [
      { productId: PRODUCT_A, countedQuantity: 20 },
      { productId: PRODUCT_B, countedQuantity: 12 }
    ])

    const result = await completeCycleCount(created.id, USER_ID)
    expect(result).toEqual({ adjustedCount: 1 })

    const { rows: productRows } = await pool.query<{ stock: number }>('SELECT stock FROM products WHERE id = $1', [PRODUCT_B])
    expect(productRows[0].stock).toBe(12)

    const { rows: movementRows } = await pool.query(
      `SELECT quantity_change as "quantityChange" FROM stock_movements WHERE product_id = $1 AND type = 'adjustment'`,
      [PRODUCT_B]
    )
    expect(movementRows).toHaveLength(1)
    expect(movementRows[0].quantityChange).toBe(-3)

    const detail = await getCycleCount(created.id)
    expect(detail!.status).toBe('completed')
    expect(detail!.completedAt).toBeTruthy()
  })

  it('uses the live stock at completion time, not the stale creation-time snapshot, when computing the adjustment delta', async () => {
    const created = await createCycleCount({ categoryId: CATEGORY_ID, userId: USER_ID })
    if ('error' in created) throw new Error('unexpected error')

    // بعد إنشاء الجرد (لقطة = 20)، حصل بيع خفّض المخزون الفعلي لـ 17 قبل ما حد يكمل الجرد.
    await pool.query('UPDATE products SET stock = 17 WHERE id = $1', [PRODUCT_A])
    // العدّاد وجد 17 فعلياً على الرف (مفيش فرق حقيقي رغم إن اللقطة القديمة كانت 20).
    await recordCounts(created.id, [{ productId: PRODUCT_A, countedQuantity: 17 }])

    const result = await completeCycleCount(created.id, USER_ID)
    expect(result).toEqual({ adjustedCount: 0 })

    const { rows } = await pool.query<{ stock: number }>('SELECT stock FROM products WHERE id = $1', [PRODUCT_A])
    expect(rows[0].stock).toBe(17)
  })

  it('rejects completing a non-draft cycle count', async () => {
    const created = await createCycleCount({ categoryId: CATEGORY_ID, userId: USER_ID })
    if ('error' in created) throw new Error('unexpected error')
    await cancelCycleCount(created.id)

    const result = await completeCycleCount(created.id, USER_ID)
    expect(result).toEqual({ error: 'not_draft' })
  })

  it('cancels a draft cycle count without touching stock', async () => {
    const created = await createCycleCount({ categoryId: CATEGORY_ID, userId: USER_ID })
    if ('error' in created) throw new Error('unexpected error')
    await recordCounts(created.id, [{ productId: PRODUCT_A, countedQuantity: 999 }])

    const result = await cancelCycleCount(created.id)
    expect(result).toEqual({ ok: true })

    const { rows } = await pool.query<{ stock: number }>('SELECT stock FROM products WHERE id = $1', [PRODUCT_A])
    expect(rows[0].stock).toBe(20)

    const detail = await getCycleCount(created.id)
    expect(detail!.status).toBe('cancelled')
  })

  it('returns not_found for an unknown cycle count id', async () => {
    expect(await getCycleCount('no-such-cycle-count')).toBeNull()
    expect(await recordCounts('no-such-cycle-count', [])).toEqual({ error: 'not_found' })
    expect(await completeCycleCount('no-such-cycle-count', USER_ID)).toEqual({ error: 'not_found' })
    expect(await cancelCycleCount('no-such-cycle-count')).toEqual({ error: 'not_found' })
  })
})
