import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { pool } from '../db.js'
import { listProducts, resolveProducts, autocompleteProducts, getProductBySlug } from './catalogService.js'

const CATEGORY_A = 'test-cat-catalog-a'
const CATEGORY_B = 'test-cat-catalog-b'

async function resetFixtures() {
  await pool.query('DELETE FROM product_alternatives')
  await pool.query('DELETE FROM product_images')
  await pool.query('DELETE FROM products')
  await pool.query('DELETE FROM categories')
  await pool.query(
    `INSERT INTO categories (id, name, emoji, tint, sort_order) VALUES ($1, 'خضروات', '🥦', '#fff', 1), ($2, 'مخبوزات', '🍞', '#eee', 2)`,
    [CATEGORY_A, CATEGORY_B]
  )
  const products = [
    { id: 'cat-p1', slug: 'cat-p1', name: 'طماطم طازجة', brand: 'بلدي', barcode: '1111111', price: 20, category: CATEGORY_A, order: 50, stock: 30, alert: 5, offer: false, bestseller: true },
    { id: 'cat-p2', slug: 'cat-p2', name: 'جبنة بيضاء', brand: 'دومتي', barcode: '2222222', price: 60, category: CATEGORY_A, order: 10, stock: 3, alert: 5, offer: true, bestseller: false },
    { id: 'cat-p3', slug: 'cat-p3', name: 'عيش بلدي', brand: 'المخبز', barcode: '3333333', price: 10, category: CATEGORY_B, order: 5, stock: 0, alert: 5, offer: false, bestseller: false },
    { id: 'cat-p4', slug: 'cat-p4', name: 'زبادي يوناني', brand: 'دومتي', barcode: '', price: 35, category: CATEGORY_B, order: 90, stock: 20, alert: 5, offer: false, bestseller: true }
  ]
  for (const p of products) {
    await pool.query(
      `INSERT INTO products (id, slug, category_id, name, description, price, cost, unit, emoji, available, bestseller, offer, order_count, stock, alert_threshold, barcode, brand, created_at)
       VALUES ($1, $2, $3, $4, 'وصف تجريبي', $5, 1, 'قطعة', '🧪', 1, $6, $7, $8, $9, $10, $11, $12, now())`,
      [p.id, p.slug, p.category, p.name, p.price, p.bestseller ? 1 : 0, p.offer ? 1 : 0, p.order, p.stock, p.alert, p.barcode, p.brand]
    )
  }
}

beforeEach(async () => {
  await resetFixtures()
})

afterAll(async () => {
  await pool.end()
})

describe('listProducts', () => {
  it('paginates with defaults and reports total/pages', async () => {
    const { products, pagination } = await listProducts({ limit: 2, page: 1 })
    expect(products).toHaveLength(2)
    expect(pagination).toEqual({ page: 1, limit: 2, total: 4, pages: 2 })
  })

  it('clamps limit to the maximum of 100', async () => {
    const { pagination } = await listProducts({ limit: 999 })
    expect(pagination.limit).toBe(100)
  })

  it('filters by category', async () => {
    const { products } = await listProducts({ category: CATEGORY_B, limit: 100 })
    expect(products.map(p => p.id).sort()).toEqual(['cat-p3', 'cat-p4'])
  })

  it('filters by brand', async () => {
    const { products } = await listProducts({ brand: 'دومتي', limit: 100 })
    expect(products.map(p => p.id).sort()).toEqual(['cat-p2', 'cat-p4'])
  })

  it('filters by offer and bestseller flags', async () => {
    const offers = await listProducts({ offer: true, limit: 100 })
    expect(offers.products.map(p => p.id)).toEqual(['cat-p2'])
    const bestsellers = await listProducts({ bestseller: true, limit: 100 })
    expect(bestsellers.products.map(p => p.id).sort()).toEqual(['cat-p1', 'cat-p4'])
  })

  it('computes customer availability as adminAvailable && stock > 0, never just the admin flag', async () => {
    const { products } = await listProducts({ limit: 100 })
    const outOfStock = products.find(p => p.id === 'cat-p3')
    expect(outOfStock?.available).toBe(false)
    const inStock = products.find(p => p.id === 'cat-p1')
    expect(inStock?.available).toBe(true)
  })

  it('filters by computed availability, not just the admin flag', async () => {
    const unavailable = await listProducts({ available: false, limit: 100 })
    expect(unavailable.products.map(p => p.id)).toEqual(['cat-p3'])
  })

  it('reports a low_stock state when stock is at or below the alert threshold', async () => {
    const { products } = await listProducts({ limit: 100 })
    expect(products.find(p => p.id === 'cat-p2')?.stockState).toBe('low_stock')
    expect(products.find(p => p.id === 'cat-p3')?.stockState).toBe('out_of_stock')
    expect(products.find(p => p.id === 'cat-p1')?.stockState).toBe('in_stock')
  })

  it('sorts by price ascending and descending', async () => {
    const asc = await listProducts({ sort: 'price_asc', limit: 100 })
    expect(asc.products.map(p => p.id)).toEqual(['cat-p3', 'cat-p1', 'cat-p4', 'cat-p2'])
    const desc = await listProducts({ sort: 'price_desc', limit: 100 })
    expect(desc.products.map(p => p.id)).toEqual(['cat-p2', 'cat-p4', 'cat-p1', 'cat-p3'])
  })

  it('sorts by popularity (order_count) by default', async () => {
    const { products } = await listProducts({ limit: 100 })
    expect(products.map(p => p.id)).toEqual(['cat-p4', 'cat-p1', 'cat-p2', 'cat-p3'])
  })

  it('sorts by newest', async () => {
    await pool.query(`UPDATE products SET created_at = now() - interval '1 day' WHERE id = 'cat-p1'`)
    const { products } = await listProducts({ sort: 'newest', limit: 100 })
    expect(products[0].id).not.toBe('cat-p1')
  })

  it('finds products by exact barcode even below the minimum search length', async () => {
    const { products } = await listProducts({ search: '2222222', limit: 100 })
    expect(products.map(p => p.id)).toEqual(['cat-p2'])
  })

  it('requires at least 2 characters for a non-barcode search', async () => {
    const { products, pagination } = await listProducts({ search: 'ط', limit: 100 })
    expect(products).toHaveLength(0)
    expect(pagination.total).toBe(0)
  })

  it('normalizes common Arabic letter variants for search (ة/ه)', async () => {
    const { products } = await listProducts({ search: 'جبنه', limit: 100 })
    expect(products.map(p => p.id)).toEqual(['cat-p2'])
  })

  it('matches by brand and by category name too', async () => {
    const byBrand = await listProducts({ search: 'المخبز', limit: 100 })
    expect(byBrand.products.map(p => p.id)).toEqual(['cat-p3'])
    const byCategory = await listProducts({ search: 'مخبوزات', limit: 100 })
    expect(byCategory.products.map(p => p.id).sort()).toEqual(['cat-p3', 'cat-p4'])
  })

  it('never returns internal-only fields like cost or exact stock', async () => {
    const { products } = await listProducts({ limit: 1 })
    expect(products[0]).not.toHaveProperty('cost')
    expect(products[0]).not.toHaveProperty('stock')
    expect(products[0]).not.toHaveProperty('description')
  })
})

describe('resolveProducts', () => {
  it('returns current card data only for the requested ids, silently dropping unknown ones', async () => {
    const products = await resolveProducts(['cat-p1', 'cat-p4', 'does-not-exist'])
    expect(products.map(p => p.id).sort()).toEqual(['cat-p1', 'cat-p4'])
  })

  it('returns an empty list for an empty input', async () => {
    expect(await resolveProducts([])).toEqual([])
  })
})

describe('autocompleteProducts', () => {
  it('returns at most 8 results and respects the minimum search length', async () => {
    expect(await autocompleteProducts('ط')).toEqual([])
    const results = await autocompleteProducts('طماطم')
    expect(results.length).toBeGreaterThan(0)
    expect(results.length).toBeLessThanOrEqual(8)
  })
})

describe('getProductBySlug', () => {
  it('returns full detail including description, gallery, and similar products, but no cost/exact stock', async () => {
    const product = await getProductBySlug('cat-p1')
    expect(product?.name).toBe('طماطم طازجة')
    expect(product?.description).toBe('وصف تجريبي')
    expect(product?.gallery).toEqual([])
    expect(product?.similarProducts.map(p => p.id)).toEqual(['cat-p2'])
    expect(product).not.toHaveProperty('cost')
    expect(product).not.toHaveProperty('stock')
  })

  it('returns null for an unknown slug', async () => {
    expect(await getProductBySlug('does-not-exist')).toBeNull()
  })
})
