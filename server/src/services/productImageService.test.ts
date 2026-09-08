// اختبارات تكامل حقيقية على جدول product_images — بتتأكد من قواعد العمل الحرجة: أول صورة
// تتضاف لمنتج تبقى تلقائياً الصورة الرئيسية، وترقية الصورة التالية تلقائياً لو الصورة
// الرئيسية اتحذفت، عشان أبداً ما يفضلش منتج بمرجع صورة رئيسية مكسور.
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { pool } from '../db.js'
import {
  listProductImages, addProductImage, setPrimaryProductImage,
  updateProductImageAlt, reorderProductImages, getProductImage, deleteProductImage
} from './productImageService.js'

const CATEGORY_ID = 'test-cat-img'
const PRODUCT_ID = 'test-prod-img'

async function resetFixtures() {
  await pool.query('DELETE FROM product_images')
  await pool.query('DELETE FROM order_items')
  await pool.query('DELETE FROM stock_movements')
  await pool.query('DELETE FROM orders')
  await pool.query('DELETE FROM products')
  await pool.query('DELETE FROM categories')
  await pool.query(
    `INSERT INTO categories (id, name, emoji, tint, sort_order) VALUES ($1, 'فئة اختبار', '🧪', '#fff', 1)`,
    [CATEGORY_ID]
  )
  await pool.query(
    `INSERT INTO products (id, slug, category_id, name, description, price, cost, unit, emoji, available, stock, created_at)
     VALUES ($1, 'test-product-img', $2, 'منتج اختبار الصور', 'وصف', 10, 5, 'وحدة', '🧪', 1, 50, now())`,
    [PRODUCT_ID, CATEGORY_ID]
  )
}

let idCounter = 0
function nextId() {
  idCounter += 1
  return `img-test-${idCounter}`
}

beforeEach(async () => {
  await resetFixtures()
})

afterAll(async () => {
  await pool.end()
})

describe('addProductImage', () => {
  it('makes the first uploaded image primary automatically', async () => {
    const image = await addProductImage({
      id: nextId(), productId: PRODUCT_ID, imageUrl: 'https://example.com/a.webp', storageKey: 'a', altText: 'صورة أ'
    })
    expect(image.isPrimary).toBe(true)
    expect(image.sortOrder).toBe(0)
  })

  it('does not make a second image primary automatically', async () => {
    await addProductImage({ id: nextId(), productId: PRODUCT_ID, imageUrl: 'https://example.com/a.webp', storageKey: 'a', altText: 'صورة أ' })
    const second = await addProductImage({ id: nextId(), productId: PRODUCT_ID, imageUrl: 'https://example.com/b.webp', storageKey: 'b', altText: 'صورة ب' })
    expect(second.isPrimary).toBe(false)
    expect(second.sortOrder).toBe(1)
  })
})

describe('setPrimaryProductImage', () => {
  it('enforces exactly one primary image per product', async () => {
    const first = await addProductImage({ id: nextId(), productId: PRODUCT_ID, imageUrl: 'https://example.com/a.webp', storageKey: 'a', altText: 'صورة أ' })
    const second = await addProductImage({ id: nextId(), productId: PRODUCT_ID, imageUrl: 'https://example.com/b.webp', storageKey: 'b', altText: 'صورة ب' })

    await setPrimaryProductImage(PRODUCT_ID, second.id)

    const images = await listProductImages(PRODUCT_ID)
    const primaryCount = images.filter(img => img.isPrimary).length
    expect(primaryCount).toBe(1)
    expect(images.find(img => img.id === second.id)?.isPrimary).toBe(true)
    expect(images.find(img => img.id === first.id)?.isPrimary).toBe(false)
  })
})

describe('deleteProductImage', () => {
  it('auto-promotes the next image when the primary image is deleted', async () => {
    const first = await addProductImage({ id: nextId(), productId: PRODUCT_ID, imageUrl: 'https://example.com/a.webp', storageKey: 'a', altText: 'صورة أ' })
    const second = await addProductImage({ id: nextId(), productId: PRODUCT_ID, imageUrl: 'https://example.com/b.webp', storageKey: 'b', altText: 'صورة ب' })

    await deleteProductImage(PRODUCT_ID, first.id, first)

    const remaining = await listProductImages(PRODUCT_ID)
    expect(remaining).toHaveLength(1)
    expect(remaining[0].id).toBe(second.id)
    expect(remaining[0].isPrimary).toBe(true)
  })

  it('leaves zero images with no broken reference when the only image is deleted', async () => {
    const only = await addProductImage({ id: nextId(), productId: PRODUCT_ID, imageUrl: 'https://example.com/a.webp', storageKey: 'a', altText: 'صورة أ' })
    await deleteProductImage(PRODUCT_ID, only.id, only)
    const remaining = await listProductImages(PRODUCT_ID)
    expect(remaining).toHaveLength(0)
  })

  it('does not change the primary image when a non-primary image is deleted', async () => {
    const first = await addProductImage({ id: nextId(), productId: PRODUCT_ID, imageUrl: 'https://example.com/a.webp', storageKey: 'a', altText: 'صورة أ' })
    const second = await addProductImage({ id: nextId(), productId: PRODUCT_ID, imageUrl: 'https://example.com/b.webp', storageKey: 'b', altText: 'صورة ب' })

    await deleteProductImage(PRODUCT_ID, second.id, second)

    const remaining = await listProductImages(PRODUCT_ID)
    expect(remaining).toHaveLength(1)
    expect(remaining[0].id).toBe(first.id)
    expect(remaining[0].isPrimary).toBe(true)
  })
})

describe('updateProductImageAlt', () => {
  it('updates the alt text of an image', async () => {
    const image = await addProductImage({ id: nextId(), productId: PRODUCT_ID, imageUrl: 'https://example.com/a.webp', storageKey: 'a', altText: 'قديم' })
    await updateProductImageAlt(image.id, 'نص بديل جديد')
    const updated = await getProductImage(PRODUCT_ID, image.id)
    expect(updated?.altText).toBe('نص بديل جديد')
  })
})

describe('reorderProductImages', () => {
  it('applies the given order as sort_order', async () => {
    const first = await addProductImage({ id: nextId(), productId: PRODUCT_ID, imageUrl: 'https://example.com/a.webp', storageKey: 'a', altText: 'أ' })
    const second = await addProductImage({ id: nextId(), productId: PRODUCT_ID, imageUrl: 'https://example.com/b.webp', storageKey: 'b', altText: 'ب' })

    const reordered = await reorderProductImages(PRODUCT_ID, [second.id, first.id])
    const bySort = [...reordered].sort((a, b) => a.sortOrder - b.sortOrder)
    expect(bySort[0].id).toBe(second.id)
    expect(bySort[1].id).toBe(first.id)
  })
})
