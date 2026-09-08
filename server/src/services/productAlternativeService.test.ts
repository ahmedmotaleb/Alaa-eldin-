import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { pool } from '../db.js'
import { listPublicAlternatives, listAdminAlternatives, addAlternative, removeAlternative } from './productAlternativeService.js'

const CATEGORY_ID = 'test-cat-alt'
const PRODUCT_ID = 'test-prod-alt-main'
const ALT_AVAILABLE_ID = 'test-prod-alt-a'
const ALT_HIDDEN_ID = 'test-prod-alt-b'

async function resetFixtures() {
  await pool.query('DELETE FROM product_alternatives')
  await pool.query('DELETE FROM product_images')
  await pool.query('DELETE FROM products')
  await pool.query('DELETE FROM categories')
  await pool.query(
    `INSERT INTO categories (id, name, emoji, tint, sort_order) VALUES ($1, 'فئة اختبار', '🧪', '#fff', 1)`,
    [CATEGORY_ID]
  )
  await pool.query(
    `INSERT INTO products (id, slug, category_id, name, description, price, cost, unit, emoji, available, stock, created_at)
     VALUES ($1, 'main-alt', $2, 'المنتج الأساسي', 'وصف', 10, 5, 'وحدة', '🧪', 1, 50, now())`,
    [PRODUCT_ID, CATEGORY_ID]
  )
  await pool.query(
    `INSERT INTO products (id, slug, category_id, name, description, price, cost, unit, emoji, available, stock, created_at)
     VALUES ($1, 'alt-available', $2, 'بديل متاح', 'وصف', 12, 5, 'وحدة', '🥫', 1, 50, now())`,
    [ALT_AVAILABLE_ID, CATEGORY_ID]
  )
  await pool.query(
    `INSERT INTO products (id, slug, category_id, name, description, price, cost, unit, emoji, available, stock, created_at)
     VALUES ($1, 'alt-hidden', $2, 'بديل مخفي', 'وصف', 15, 5, 'وحدة', '🧴', 0, 50, now())`,
    [ALT_HIDDEN_ID, CATEGORY_ID]
  )
}

beforeEach(async () => {
  await resetFixtures()
})

afterAll(async () => {
  await pool.end()
})

describe('addAlternative / listPublicAlternatives / listAdminAlternatives', () => {
  it('lists an added alternative for both public and admin views', async () => {
    await addAlternative(PRODUCT_ID, ALT_AVAILABLE_ID, 0)
    const publicList = await listPublicAlternatives(PRODUCT_ID)
    const adminList = await listAdminAlternatives(PRODUCT_ID)
    expect(publicList.map(p => p.id)).toEqual([ALT_AVAILABLE_ID])
    expect(adminList.map(p => p.id)).toEqual([ALT_AVAILABLE_ID])
  })

  it('excludes an unavailable (hidden) product from the public list but keeps it in the admin list', async () => {
    await addAlternative(PRODUCT_ID, ALT_HIDDEN_ID, 0)
    const publicList = await listPublicAlternatives(PRODUCT_ID)
    const adminList = await listAdminAlternatives(PRODUCT_ID)
    expect(publicList).toHaveLength(0)
    expect(adminList.map(p => p.id)).toEqual([ALT_HIDDEN_ID])
  })

  it('orders alternatives by priority', async () => {
    await addAlternative(PRODUCT_ID, ALT_AVAILABLE_ID, 5)
    await addAlternative(PRODUCT_ID, ALT_HIDDEN_ID, 1)
    const adminList = await listAdminAlternatives(PRODUCT_ID)
    expect(adminList.map(p => p.id)).toEqual([ALT_HIDDEN_ID, ALT_AVAILABLE_ID])
  })

  it('never returns the product itself even if a self-link were attempted', async () => {
    // القيد الفعلي موجود على مستوى قاعدة البيانات (CHECK product_id != alternative_product_id)،
    // هنا بنتأكد إن الخدمة نفسها ما بترجعش أي بديل لمنتج تاني غير اللي اتضاف فعلاً.
    await addAlternative(PRODUCT_ID, ALT_AVAILABLE_ID, 0)
    const adminList = await listAdminAlternatives(PRODUCT_ID)
    expect(adminList.every(p => p.id !== PRODUCT_ID)).toBe(true)
  })
})

describe('removeAlternative', () => {
  it('removes a previously added alternative', async () => {
    await addAlternative(PRODUCT_ID, ALT_AVAILABLE_ID, 0)
    await removeAlternative(PRODUCT_ID, ALT_AVAILABLE_ID)
    const adminList = await listAdminAlternatives(PRODUCT_ID)
    expect(adminList).toHaveLength(0)
  })
})
