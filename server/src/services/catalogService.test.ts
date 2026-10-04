import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { pool } from '../db.js'
import { listProducts, resolveProducts, autocompleteProducts, getProductBySlug, getPublicVariantsForProduct, getProductFacets } from './catalogService.js'

const CATEGORY_A = 'test-cat-catalog-a'
const CATEGORY_B = 'test-cat-catalog-b'

async function resetFixtures() {
  await pool.query('DELETE FROM product_alternatives')
  await pool.query('DELETE FROM product_images')
  await pool.query('DELETE FROM stock_movements')
  await pool.query('DELETE FROM order_items')
  await pool.query('DELETE FROM orders')
  await pool.query('DELETE FROM products')
  await pool.query('DELETE FROM categories')
  await pool.query(
    `INSERT INTO store_settings (id, name, whatsapp_number, currency, minimum_order, free_shipping_threshold, delivery_fee, show_exact_low_stock)
     VALUES (1, 'متجر تجريبي', '01000000000', 'ج.م', 100, 500, 30, 0)
     ON CONFLICT (id) DO UPDATE SET show_exact_low_stock = 0`
  )
  await pool.query(
    `INSERT INTO categories (id, name, emoji, tint, sort_order) VALUES ($1, 'خضروات', '🥦', '#fff', 1), ($2, 'مخبوزات', '🍞', '#eee', 2)`,
    [CATEGORY_A, CATEGORY_B]
  )
  // offer عمود GENERATED حقيقي (old_price > price، راجع migration 0073) — مش بيتكتب فيه
  // صراحة هنا أبداً، cat-p2 بس عنده old_price حقيقي أكبر من السعر عشان يبقى "عرض" فعلي.
  const products = [
    { id: 'cat-p1', slug: 'cat-p1', name: 'طماطم طازجة', brand: 'بلدي', barcode: '1111111', price: 20, oldPrice: null, category: CATEGORY_A, order: 50, stock: 30, alert: 5, bestseller: true },
    { id: 'cat-p2', slug: 'cat-p2', name: 'جبنة بيضاء', brand: 'دومتي', barcode: '2222222', price: 60, oldPrice: 75, category: CATEGORY_A, order: 10, stock: 3, alert: 5, bestseller: false },
    { id: 'cat-p3', slug: 'cat-p3', name: 'عيش بلدي', brand: 'المخبز', barcode: '3333333', price: 10, oldPrice: null, category: CATEGORY_B, order: 5, stock: 0, alert: 5, bestseller: false },
    { id: 'cat-p4', slug: 'cat-p4', name: 'زبادي يوناني', brand: 'دومتي', barcode: '', price: 35, oldPrice: null, category: CATEGORY_B, order: 90, stock: 20, alert: 5, bestseller: true }
  ]
  for (const p of products) {
    await pool.query(
      `INSERT INTO products (id, slug, category_id, name, description, price, old_price, cost, unit, emoji, available, bestseller, order_count, stock, alert_threshold, barcode, brand, created_at)
       VALUES ($1, $2, $3, $4, 'وصف تجريبي', $5, $6, 1, 'قطعة', '🧪', 1, $7, $8, $9, $10, $11, $12, now())`,
      [p.id, p.slug, p.category, p.name, p.price, p.oldPrice, p.bestseller ? 1 : 0, p.order, p.stock, p.alert, p.barcode, p.brand]
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

  // عروض شبح (phantom offers): offer عمود GENERATED من old_price/price بس — مستحيل منتج
  // يظهر في عروض اليوم من غير خصم حقيقي فعلي، بغض النظر عن أي قيمة تاريخية قديمة.
  it('never returns a product with no oldPrice at all when filtering by offer=true', async () => {
    const { products } = await listProducts({ offer: true, limit: 100 })
    expect(products.map(p => p.id)).not.toContain('cat-p1')
  })

  it('never returns a product once its oldPrice drops to no longer exceed the current price', async () => {
    await pool.query('UPDATE products SET old_price = 55 WHERE id = $1', ['cat-p2']) // كان 75، بقى 55 < 60
    const { products } = await listProducts({ offer: true, limit: 100 })
    expect(products.map(p => p.id)).not.toContain('cat-p2')
  })

  it('still returns a product once a real oldPrice > price exists, even if it never had one before', async () => {
    await pool.query('UPDATE products SET old_price = 30 WHERE id = $1', ['cat-p3']) // السعر 10
    const { products } = await listProducts({ offer: true, limit: 100 })
    expect(products.map(p => p.id).sort()).toEqual(['cat-p2', 'cat-p3'])
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

  it('never exposes the exact low-stock count unless showExactLowStock is enabled', async () => {
    const { products } = await listProducts({ limit: 100 })
    expect(products.find(p => p.id === 'cat-p2')?.lowStockRemaining).toBeUndefined()
  })

  it('exposes the exact remaining count only for low_stock items once showExactLowStock is enabled', async () => {
    await pool.query('UPDATE store_settings SET show_exact_low_stock = 1 WHERE id = 1')
    const { products } = await listProducts({ limit: 100 })
    expect(products.find(p => p.id === 'cat-p2')?.lowStockRemaining).toBe(3)
    expect(products.find(p => p.id === 'cat-p1')?.lowStockRemaining).toBeUndefined()
    expect(products.find(p => p.id === 'cat-p3')?.lowStockRemaining).toBeUndefined()
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

  it('filters by a minimum price', async () => {
    const { products } = await listProducts({ minPrice: 50, limit: 100 })
    expect(products.map(p => p.id)).toEqual(['cat-p2'])
  })

  it('filters by a maximum price', async () => {
    const { products } = await listProducts({ maxPrice: 15, limit: 100 })
    expect(products.map(p => p.id)).toEqual(['cat-p3'])
  })

  it('filters by a min/max price range together', async () => {
    const { products } = await listProducts({ minPrice: 15, maxPrice: 30, limit: 100 })
    expect(products.map(p => p.id)).toEqual(['cat-p1'])
  })

  it('filters by exact unit value', async () => {
    await pool.query(`UPDATE products SET unit = 'كيلو' WHERE id = 'cat-p1'`)
    const kilos = await listProducts({ unit: 'كيلو', limit: 100 })
    expect(kilos.products.map(p => p.id)).toEqual(['cat-p1'])
    const pieces = await listProducts({ unit: 'قطعة', limit: 100 })
    expect(pieces.products.map(p => p.id).sort()).toEqual(['cat-p2', 'cat-p3', 'cat-p4'])
  })
})

describe('listProducts combined filters', () => {
  it('category + query narrows to matches within that category only', async () => {
    const { products } = await listProducts({ category: CATEGORY_B, search: 'زبادي', limit: 100 })
    expect(products.map(p => p.id)).toEqual(['cat-p4'])
  })

  it('category + query + availability excludes an out-of-stock match within the same category', async () => {
    // "مخبوزات" (اسم القسم B) بيطابق المنتجين cat-p3 وcat-p4 عادي، لكن cat-p3 نافد
    // المخزون فلازم يُستبعد لما نضيف available=true فوق نفس القسم والبحث.
    const both = await listProducts({ category: CATEGORY_B, search: 'مخبوزات', limit: 100 })
    expect(both.products.map(p => p.id).sort()).toEqual(['cat-p3', 'cat-p4'])
    const availableOnly = await listProducts({ category: CATEGORY_B, search: 'مخبوزات', available: true, limit: 100 })
    expect(availableOnly.products.map(p => p.id)).toEqual(['cat-p4'])
  })

  it('offer + query applies both as AND, not OR', async () => {
    const matching = await listProducts({ offer: true, search: 'جبنة', limit: 100 })
    expect(matching.products.map(p => p.id)).toEqual(['cat-p2'])
    const nonMatching = await listProducts({ offer: true, search: 'طماطم', limit: 100 })
    expect(nonMatching.products).toHaveLength(0)
  })

  it('bestseller + price range narrows the bestseller set further', async () => {
    const bestsellers = await listProducts({ bestseller: true, limit: 100 })
    expect(bestsellers.products.map(p => p.id).sort()).toEqual(['cat-p1', 'cat-p4'])
    const narrowed = await listProducts({ bestseller: true, minPrice: 30, limit: 100 })
    expect(narrowed.products.map(p => p.id)).toEqual(['cat-p4'])
  })

  it('category + sort + pagination keeps a stable order across pages', async () => {
    const page1 = await listProducts({ category: CATEGORY_A, sort: 'price_desc', limit: 1, page: 1 })
    expect(page1.products.map(p => p.id)).toEqual(['cat-p2'])
    expect(page1.pagination).toEqual({ page: 1, limit: 1, total: 2, pages: 2 })
    const page2 = await listProducts({ category: CATEGORY_A, sort: 'price_desc', limit: 1, page: 2 })
    expect(page2.products.map(p => p.id)).toEqual(['cat-p1'])
  })
})

describe('getProductFacets', () => {
  it('returns the real distinct brands and units present across all products', async () => {
    const { brands, units } = await getProductFacets({})
    expect(brands.slice().sort()).toEqual(['المخبز', 'بلدي', 'دومتي'])
    expect(units).toEqual(['قطعة'])
  })

  it('scopes facets to the same category/search/offer/bestseller/available context as listProducts', async () => {
    const { brands } = await getProductFacets({ category: CATEGORY_B })
    expect(brands.slice().sort()).toEqual(['المخبز', 'دومتي'])
  })

  it('excludes brands only reachable through an unavailable product once available=true is applied', async () => {
    const { brands } = await getProductFacets({ available: true })
    expect(brands.slice().sort()).toEqual(['بلدي', 'دومتي'])
  })

  it('never includes empty-string brand/unit placeholders', async () => {
    await pool.query(`UPDATE products SET brand = '' WHERE id = 'cat-p3'`)
    const { brands } = await getProductFacets({})
    expect(brands).not.toContain('')
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

  it('includes only available variants of the product, excluding a disabled one', async () => {
    await pool.query(
      `INSERT INTO product_variants (id, product_id, name, price, cost, stock, available, created_at) VALUES
         ('test-variant-visible', 'cat-p1', 'كبير', 30, 15, 5, 1, now()),
         ('test-variant-hidden', 'cat-p1', 'مسحوب', 30, 15, 5, 0, now())`
    )
    try {
      const product = await getProductBySlug('cat-p1')
      expect(product?.variants).toEqual([{ id: 'test-variant-visible', name: 'كبير', price: 30, stock: 5 }])
    } finally {
      await pool.query(`DELETE FROM product_variants WHERE id IN ('test-variant-visible', 'test-variant-hidden')`)
    }
  })
})

describe('product card hasVariants flag (weight/unit bottom sheet trigger)', () => {
  it('is false for a product with no variants, true once an available variant exists', async () => {
    const before = await resolveProducts(['cat-p1'])
    expect(before[0].hasVariants).toBe(false)

    await pool.query(
      `INSERT INTO product_variants (id, product_id, name, price, cost, stock, available, created_at)
       VALUES ('test-hv-1', 'cat-p1', 'كبير', 30, 15, 5, 1, now())`
    )
    try {
      const after = await resolveProducts(['cat-p1'])
      expect(after[0].hasVariants).toBe(true)
    } finally {
      await pool.query(`DELETE FROM product_variants WHERE id = 'test-hv-1'`)
    }
  })

  it('stays false when the product only has a disabled (unavailable) variant', async () => {
    await pool.query(
      `INSERT INTO product_variants (id, product_id, name, price, cost, stock, available, created_at)
       VALUES ('test-hv-2', 'cat-p1', 'مسحوب', 30, 15, 5, 0, now())`
    )
    try {
      const { products } = await listProducts({ search: 'طماطم' })
      expect(products.find(p => p.id === 'cat-p1')?.hasVariants).toBe(false)
    } finally {
      await pool.query(`DELETE FROM product_variants WHERE id = 'test-hv-2'`)
    }
  })
})

describe('getPublicVariantsForProduct', () => {
  it('returns only available variants, in lean shape, for use by the weight/unit bottom sheet', async () => {
    await pool.query(
      `INSERT INTO product_variants (id, product_id, name, price, cost, stock, available, sort_order, created_at) VALUES
         ('test-sel-1', 'cat-p1', 'كبير', 30, 15, 5, 1, 1, now()),
         ('test-sel-2', 'cat-p1', 'صغير', 18, 9, 0, 1, 2, now()),
         ('test-sel-3', 'cat-p1', 'مسحوب', 30, 15, 5, 0, 3, now())`
    )
    try {
      const variants = await getPublicVariantsForProduct('cat-p1')
      expect(variants).toEqual([
        { id: 'test-sel-1', name: 'كبير', price: 30, stock: 5 },
        { id: 'test-sel-2', name: 'صغير', price: 18, stock: 0 }
      ])
    } finally {
      await pool.query(`DELETE FROM product_variants WHERE id IN ('test-sel-1', 'test-sel-2', 'test-sel-3')`)
    }
  })

  it('returns an empty array for a product with no variants', async () => {
    expect(await getPublicVariantsForProduct('cat-p4')).toEqual([])
  })

  it('exposes the exact low-stock count on the detail endpoint only when the setting is enabled', async () => {
    const before = await getProductBySlug('cat-p2')
    expect(before?.lowStockRemaining).toBeUndefined()

    await pool.query('UPDATE store_settings SET show_exact_low_stock = 1 WHERE id = 1')
    const after = await getProductBySlug('cat-p2')
    expect(after?.stockState).toBe('low_stock')
    expect(after?.lowStockRemaining).toBe(3)
  })
})

// primaryImage على نفس استعلامات الواجهة العامة (listProducts لصفحة المتجر/الكتالوج،
// getProductBySlug لصفحة تفاصيل المنتج) — مش بس GET /api/admin/products/:id (مُغطّى في
// adminProductImagesConfigured.test.ts). القيمة نفسها بتيجي من نفس LEFT JOIN LATERAL على
// product_images في SELECT_PRODUCT_LIST/SELECT_PRODUCT_DETAIL جوه catalogService.ts.
describe('primaryImage on public catalog queries', () => {
  it('listProducts returns primaryImage for a product that has an uploaded image, and leaves it undefined otherwise', async () => {
    await pool.query(
      `INSERT INTO product_images (id, product_id, image_url, storage_key, alt_text, sort_order, is_primary, created_at)
       VALUES ('test-pub-img-1', 'cat-p1', 'https://res.cloudinary.com/test/image/upload/pub-key.webp', 'pub-key', '', 0, 1, now())`
    )
    const { products } = await listProducts({ limit: 100 })
    const withImage = products.find(p => p.id === 'cat-p1')
    const withoutImage = products.find(p => p.id === 'cat-p2')
    expect(withImage?.primaryImage).toBe('https://res.cloudinary.com/test/image/upload/pub-key.webp')
    expect(withoutImage?.primaryImage).toBeUndefined()
  })

  // getProductBySlug (صفحة تفاصيل المنتج) بيرجّع gallery كاملة (كل الصور، كل واحدة بعلامة
  // isPrimary الخاصة بيها) بدل حقل primaryImage مفرد — الفرونت إند (ProductPage.tsx) بالفعل
  // بيستخرج primaryImage بنفسه من gallery.find(isPrimary) ?? gallery[0]، فمفيش حقل مفرد
  // متوقّع هنا أصلاً؛ ده شكل API متعمّد ومختلف عن listProducts، مش نقص.
  it('getProductBySlug exposes the uploaded image in gallery, marked as primary', async () => {
    await pool.query(
      `INSERT INTO product_images (id, product_id, image_url, storage_key, alt_text, sort_order, is_primary, created_at)
       VALUES ('test-pub-img-2', 'cat-p1', 'https://res.cloudinary.com/test/image/upload/pub-detail-key.webp', 'pub-detail-key', '', 0, 1, now())`
    )
    const product = await getProductBySlug('cat-p1')
    expect(product?.gallery).toHaveLength(1)
    expect(product?.gallery[0]).toMatchObject({ url: 'https://res.cloudinary.com/test/image/upload/pub-detail-key.webp', isPrimary: true })
  })
})
