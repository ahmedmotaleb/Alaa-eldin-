import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { pool } from '../db.js'
import { listFavorites, isFavorite, addFavorite, removeFavorite } from './favoriteService.js'

const USER_ID = 'test-user-fav-1'
const CATEGORY_ID = 'test-cat-fav'
const PRODUCT_AVAILABLE = 'test-prod-fav-a'
const PRODUCT_HIDDEN = 'test-prod-fav-b'

async function resetFixtures() {
  await pool.query('DELETE FROM customer_favorites')
  await pool.query('DELETE FROM product_images')
  await pool.query('DELETE FROM products')
  await pool.query('DELETE FROM categories')
  await pool.query('DELETE FROM users WHERE id = $1', [USER_ID])
  await pool.query(
    `INSERT INTO users (id, email, password_hash, full_name, created_at) VALUES ($1, 'fav-test@test.local', 'x', 'عميل اختبار', now())`,
    [USER_ID]
  )
  await pool.query(
    `INSERT INTO categories (id, name, emoji, tint, sort_order) VALUES ($1, 'فئة اختبار', '🧪', '#fff', 1)`,
    [CATEGORY_ID]
  )
  await pool.query(
    `INSERT INTO products (id, slug, category_id, name, description, price, cost, unit, emoji, available, stock, created_at)
     VALUES ($1, 'fav-available', $2, 'منتج متاح', 'وصف', 10, 5, 'قطعة', '🧪', 1, 20, now())`,
    [PRODUCT_AVAILABLE, CATEGORY_ID]
  )
  await pool.query(
    `INSERT INTO products (id, slug, category_id, name, description, price, cost, unit, emoji, available, stock, created_at)
     VALUES ($1, 'fav-hidden', $2, 'منتج مخفي', 'وصف', 10, 5, 'قطعة', '🧪', 0, 0, now())`,
    [PRODUCT_HIDDEN, CATEGORY_ID]
  )
}

beforeEach(async () => {
  await resetFixtures()
})

afterAll(async () => {
  await pool.end()
})

describe('addFavorite / listFavorites / isFavorite / removeFavorite', () => {
  it('adds a favorite and lists it back with current product data', async () => {
    await addFavorite(USER_ID, PRODUCT_AVAILABLE)
    const favorites = await listFavorites(USER_ID)
    expect(favorites.map(p => p.id)).toEqual([PRODUCT_AVAILABLE])
  })

  it('reports isFavorite correctly before and after adding', async () => {
    expect(await isFavorite(USER_ID, PRODUCT_AVAILABLE)).toBe(false)
    await addFavorite(USER_ID, PRODUCT_AVAILABLE)
    expect(await isFavorite(USER_ID, PRODUCT_AVAILABLE)).toBe(true)
  })

  it('adding the same favorite twice does not create a duplicate', async () => {
    await addFavorite(USER_ID, PRODUCT_AVAILABLE)
    await addFavorite(USER_ID, PRODUCT_AVAILABLE)
    const { rows } = await pool.query('SELECT count(*) as n FROM customer_favorites WHERE user_id = $1', [USER_ID])
    expect(Number(rows[0].n)).toBe(1)
  })

  it('still includes an unavailable favorited product (still shown as a favorite, just not purchasable)', async () => {
    await addFavorite(USER_ID, PRODUCT_HIDDEN)
    const favorites = await listFavorites(USER_ID)
    expect(favorites.map(p => p.id)).toEqual([PRODUCT_HIDDEN])
    expect(favorites[0].available).toBe(false)
  })

  it('removes a favorite', async () => {
    await addFavorite(USER_ID, PRODUCT_AVAILABLE)
    await removeFavorite(USER_ID, PRODUCT_AVAILABLE)
    expect(await listFavorites(USER_ID)).toHaveLength(0)
  })
})
