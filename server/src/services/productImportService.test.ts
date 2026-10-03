import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { pool } from '../db.js'
import { parseCsv, csvRecords } from '../csv.js'
import { validateImportRows, importValidatedRows, generateProductImportTemplateCsv, type ImportConfirmRow } from './productImportService.js'

const CATEGORY_ID = 'test-cat-import'
const EXISTING_PRODUCT_ID = 'test-prod-import-existing'
const USER_ID = 'test-user-import'

async function resetFixtures() {
  await pool.query("DELETE FROM products WHERE slug LIKE 'import-test-%' OR id = $1", [EXISTING_PRODUCT_ID])
  await pool.query('DELETE FROM categories WHERE id = $1', [CATEGORY_ID])
  await pool.query('DELETE FROM users WHERE id = $1', [USER_ID])

  await pool.query(
    `INSERT INTO categories (id, name, emoji, tint, sort_order) VALUES ($1, 'فئة اختبار الاستيراد', '🧪', '#fff', 1)`,
    [CATEGORY_ID]
  )
  await pool.query(
    `INSERT INTO products (id, slug, category_id, name, description, price, cost, unit, emoji, available, stock, alert_threshold, sku, barcode, created_at)
     VALUES ($1, 'import-test-existing', $2, 'منتج موجود', 'وصف', 10, 5, 'وحدة', '🧪', 1, 20, 5, 'SKU-EXIST-1', 'BC-EXIST-1', now())`,
    [EXISTING_PRODUCT_ID, CATEGORY_ID]
  )
  await pool.query(
    `INSERT INTO users (id, email, password_hash, full_name, created_at, is_admin, role)
     VALUES ($1, 'import-tester@test.local', 'x', 'مختبر', now(), 1, 'admin')`,
    [USER_ID]
  )
}

describe('productImportService', () => {
  beforeEach(resetFixtures)
  afterAll(async () => {
    await pool.query("DELETE FROM products WHERE slug LIKE 'import-test-%'")
    await pool.query('DELETE FROM categories WHERE id = $1', [CATEGORY_ID])
    await pool.query('DELETE FROM users WHERE id = $1', [USER_ID])
  })

  describe('validateImportRows', () => {
    it('matches an existing product by sku and proposes an update action', async () => {
      const [row] = await validateImportRows([{ sku: 'SKU-EXIST-1', price: '15' }])
      expect(row.action).toBe('update')
      expect(row.productId).toBe(EXISTING_PRODUCT_ID)
      expect(row.data.price).toBe(15)
      expect(row.errors).toEqual([])
    })

    it('matches an existing product by id and proposes an update action', async () => {
      const [row] = await validateImportRows([{ id: EXISTING_PRODUCT_ID, stock: '30' }])
      expect(row.action).toBe('update')
      expect(row.data.stock).toBe(30)
    })

    it('rejects an update row with no valid fields to change', async () => {
      const [row] = await validateImportRows([{ sku: 'SKU-EXIST-1' }])
      expect(row.action).toBe('invalid')
    })

    it('rejects Eastern Arabic digits in a numeric field instead of silently converting them', async () => {
      const [row] = await validateImportRows([{ sku: 'SKU-EXIST-1', price: '١٥' }])
      expect(row.action).toBe('invalid')
      expect(row.errors.some(e => e.includes('السعر'))).toBe(true)
    })

    it('proposes creating a genuinely new product when there is no id/sku match and required fields are valid', async () => {
      const [row] = await validateImportRows([{
        name: 'منتج جديد من الاستيراد', categoryId: CATEGORY_ID, slug: 'import-test-new-1', unit: 'وحدة', price: '25'
      }])
      expect(row.action).toBe('create')
      expect(row.data.name).toBe('منتج جديد من الاستيراد')
      expect(row.data.slug).toBe('import-test-new-1')
      expect(row.data.price).toBe(25)
      expect(row.data.stock).toBe(0)
    })

    it('rejects a create row missing the required slug', async () => {
      const [row] = await validateImportRows([{ name: 'منتج بدون رابط', categoryId: CATEGORY_ID, unit: 'وحدة', price: '25' }])
      expect(row.action).toBe('invalid')
      expect(row.errors.some(e => e.includes('slug'))).toBe(true)
    })

    it('rejects a create row referencing a non-existent category', async () => {
      const [row] = await validateImportRows([{ name: 'منتج', categoryId: 'no-such-category', slug: 'import-test-new-2', unit: 'وحدة', price: '25' }])
      expect(row.action).toBe('invalid')
      expect(row.errors.some(e => e.includes('القسم'))).toBe(true)
    })

    it('rejects a create row whose slug already exists', async () => {
      const [row] = await validateImportRows([{ name: 'منتج', categoryId: CATEGORY_ID, slug: 'import-test-existing', unit: 'وحدة', price: '25' }])
      expect(row.action).toBe('invalid')
      expect(row.errors.some(e => e.includes('الرابط'))).toBe(true)
    })

    it('rejects two new rows in the same batch that collide with each other on slug', async () => {
      const rows = await validateImportRows([
        { name: 'منتج أ', categoryId: CATEGORY_ID, slug: 'import-test-dup', unit: 'وحدة', price: '10' },
        { name: 'منتج ب', categoryId: CATEGORY_ID, slug: 'import-test-dup', unit: 'وحدة', price: '20' }
      ])
      expect(rows[0].action).toBe('create')
      expect(rows[1].action).toBe('invalid')
    })

    it('rejects two new rows in the same batch that collide with each other on a brand-new sku', async () => {
      const rows = await validateImportRows([
        { name: 'منتج أ', categoryId: CATEGORY_ID, slug: 'import-test-new-3a', unit: 'وحدة', price: '10', sku: 'SKU-NEW-DUP' },
        { name: 'منتج ب', categoryId: CATEGORY_ID, slug: 'import-test-new-3b', unit: 'وحدة', price: '20', sku: 'SKU-NEW-DUP' }
      ])
      expect(rows[0].action).toBe('create')
      expect(rows[1].action).toBe('invalid')
      expect(rows[1].errors.some(e => e.includes('SKU'))).toBe(true)
    })

    it('treats a row whose sku matches an existing product as an update, even when other create-only fields are also present', async () => {
      const [row] = await validateImportRows([{
        name: 'اسم متجاهَل', categoryId: CATEGORY_ID, slug: 'import-test-ignored', unit: 'وحدة', price: '25', sku: 'SKU-EXIST-1'
      }])
      expect(row.action).toBe('update')
      expect(row.productId).toBe(EXISTING_PRODUCT_ID)
    })

    it('rejects a non-negative-integer stock value with a decimal', async () => {
      const [row] = await validateImportRows([{
        name: 'منتج', categoryId: CATEGORY_ID, slug: 'import-test-new-4', unit: 'وحدة', price: '25', stock: '3.5'
      }])
      expect(row.action).toBe('invalid')
    })

    it('marks a fully empty row as invalid rather than silently skipping it', async () => {
      const [row] = await validateImportRows([{}])
      expect(row.action).toBe('invalid')
    })
  })

  describe('importValidatedRows', () => {
    it('creates a genuinely new product from a validated create row', async () => {
      const rows: ImportConfirmRow[] = [{
        rowNumber: 2,
        action: 'create',
        data: { name: 'منتج مؤكد', categoryId: CATEGORY_ID, slug: 'import-test-confirm-1', unit: 'وحدة', price: 30, stock: 5 }
      }]
      const summary = await importValidatedRows(rows, USER_ID)
      expect(summary.created).toBe(1)
      expect(summary.failed).toEqual([])

      const { rows: created } = await pool.query('SELECT name, price, stock FROM products WHERE slug = $1', ['import-test-confirm-1'])
      expect(created[0].name).toBe('منتج مؤكد')
      expect(Number(created[0].price)).toBe(30)
      expect(created[0].stock).toBe(5)
    })

    it('updates an existing product from a validated update row using only the changed fields', async () => {
      const rows: ImportConfirmRow[] = [{
        rowNumber: 2,
        action: 'update',
        productId: EXISTING_PRODUCT_ID,
        data: { price: 99 }
      }]
      const summary = await importValidatedRows(rows, USER_ID)
      expect(summary.updated).toBe(1)

      const { rows: updated } = await pool.query('SELECT price, stock FROM products WHERE id = $1', [EXISTING_PRODUCT_ID])
      expect(Number(updated[0].price)).toBe(99)
      expect(updated[0].stock).toBe(20) // لم يتغيّر لأنه لم يُرسل ضمن الحقول المُحدَّثة
    })

    // offer عمود GENERATED من السيرفر (oldPrice > price) — استيراد CSV بيغيّر price/oldPrice
    // بس، ومفيش حاجة تانية مطلوبة عشان offer يفضل متزامن: قاعدة البيانات نفسها بتحسبه.
    it('a created product with a real oldPrice > price is correctly reported as an offer', async () => {
      await importValidatedRows([{
        rowNumber: 2,
        action: 'create',
        data: { name: 'منتج عرض من الاستيراد', categoryId: CATEGORY_ID, slug: 'import-test-offer-create', unit: 'وحدة', price: 40, oldPrice: 60 }
      }], USER_ID)
      const { rows } = await pool.query('SELECT offer FROM products WHERE slug = $1', ['import-test-offer-create'])
      expect(rows[0].offer).toBe(1)
    })

    it('a CSV update that invalidates the discount (price rises above oldPrice) turns the offer off', async () => {
      await pool.query('UPDATE products SET old_price = 150 WHERE id = $1', [EXISTING_PRODUCT_ID]) // أكبر من السعر الحالي (20) فعلاً عرض
      const before = await pool.query('SELECT offer FROM products WHERE id = $1', [EXISTING_PRODUCT_ID])
      expect(before.rows[0].offer).toBe(1)

      await importValidatedRows([{
        rowNumber: 2, action: 'update', productId: EXISTING_PRODUCT_ID, data: { price: 200 } // بقى أكبر من old_price
      }], USER_ID)

      const after = await pool.query('SELECT offer FROM products WHERE id = $1', [EXISTING_PRODUCT_ID])
      expect(after.rows[0].offer).toBe(0)
    })

    it('fails a create row whose slug was taken by another request between preview and confirm', async () => {
      await pool.query(
        `INSERT INTO products (id, slug, category_id, name, description, price, cost, unit, emoji, available, stock, created_at)
         VALUES ('race-winner', 'import-test-race', $1, 'سبق الاستيراد', 'وصف', 5, 2, 'وحدة', '🧪', 1, 1, now())`,
        [CATEGORY_ID]
      )
      const rows: ImportConfirmRow[] = [{
        rowNumber: 2,
        action: 'create',
        data: { name: 'متأخر', categoryId: CATEGORY_ID, slug: 'import-test-race', unit: 'وحدة', price: 10 }
      }]
      const summary = await importValidatedRows(rows, USER_ID)
      expect(summary.created).toBe(0)
      expect(summary.failed).toEqual([{ rowNumber: 2, reason: 'slug_taken' }])
    })

    it('continues processing remaining rows in the chunk after one row fails', async () => {
      const rows: ImportConfirmRow[] = [
        { rowNumber: 2, action: 'update', productId: 'no-such-product', data: { price: 1 } },
        { rowNumber: 3, action: 'create', data: { name: 'ينجح', categoryId: CATEGORY_ID, slug: 'import-test-continues', unit: 'وحدة', price: 12 } }
      ]
      const summary = await importValidatedRows(rows, USER_ID)
      expect(summary.created).toBe(1)
      expect(summary.failed).toEqual([{ rowNumber: 2, reason: 'product_not_found' }])
    })
  })

  describe('generateProductImportTemplateCsv', () => {
    it('includes the existing product with all import columns plus a reference categoryName', async () => {
      const csv = await generateProductImportTemplateCsv()
      const records = csvRecords(parseCsv(csv.replace(/^﻿/, '')))
      const row = records.find(r => r.id === EXISTING_PRODUCT_ID)
      expect(row).toBeTruthy()
      expect(row?.sku).toBe('SKU-EXIST-1')
      expect(row?.barcode).toBe('BC-EXIST-1')
      expect(row?.name).toBe('منتج موجود')
      expect(row?.categoryId).toBe(CATEGORY_ID)
      expect(row?.categoryName).toBe('فئة اختبار الاستيراد')
      expect(row?.slug).toBe('import-test-existing')
      expect(row?.unit).toBe('وحدة')
      expect(row?.price).toBe('10')
      expect(row?.cost).toBe('5')
      expect(row?.stock).toBe('20')
      expect(row?.alertThreshold).toBe('5')
      expect(row?.available).toBe('1')
    })

    it('filters by categoryId so only products in that category are included', async () => {
      const csv = await generateProductImportTemplateCsv({ categoryId: 'no-such-category' })
      const records = csvRecords(parseCsv(csv.replace(/^﻿/, '')))
      expect(records.find(r => r.id === EXISTING_PRODUCT_ID)).toBeUndefined()
    })

    it('filters by search matching name/sku/barcode', async () => {
      const csv = await generateProductImportTemplateCsv({ search: 'SKU-EXIST-1' })
      const records = csvRecords(parseCsv(csv.replace(/^﻿/, '')))
      expect(records.some(r => r.id === EXISTING_PRODUCT_ID)).toBe(true)
    })

    it('produces a template row that re-validates as an update (round-trip), ignoring the extra categoryName column', async () => {
      const csv = await generateProductImportTemplateCsv({ search: 'SKU-EXIST-1' })
      const records = csvRecords(parseCsv(csv.replace(/^﻿/, '')))
      const [row] = await validateImportRows(records.filter(r => r.id === EXISTING_PRODUCT_ID))
      expect(row.action).toBe('update')
      expect(row.productId).toBe(EXISTING_PRODUCT_ID)
    })
  })
})
