// اختبارات HTTP حقيقية لمسارات الجرد الدوري (/api/admin/cycle-counts) — تركيز خاص على
// تصدير/استيراد CSV مع منتج بمتغيّرات (المطابقة بالـ sku/barcode لازم تفرّق بين المتغيّرات
// نفسها، مش تتوقف عند المنتج الأب بس).
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { app } from '../app.js'
import { pool } from '../db.js'

const PREFIX = 'acyc-'
const STRONG_PASSWORD = 'CorrectHorse9'
const CATEGORY_ID = `${PREFIX}category`
const PRODUCT_ID = `${PREFIX}product`
const VARIANT_1 = `${PREFIX}variant-1`
const VARIANT_2 = `${PREFIX}variant-2`

function uniqueEmail(label: string): string {
  return `${PREFIX}${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`
}

async function adminAgent() {
  const agent = request.agent(app)
  const email = uniqueEmail('admin')
  const res = await agent.post('/api/auth/register').send({ email, password: STRONG_PASSWORD, fullName: 'مستخدم اختبار' })
  expect(res.status).toBe(201)
  await pool.query('UPDATE users SET is_admin = 1, role = $2 WHERE id = $1', [res.body.user.id, 'admin'])
  return agent
}

async function seedCatalog() {
  await pool.query(`INSERT INTO categories (id, name, emoji, tint, sort_order) VALUES ($1, 'فئة اختبار', '🧪', '#fff', 1)`, [CATEGORY_ID])
  await pool.query(
    `INSERT INTO products (id, slug, category_id, name, description, price, cost, unit, emoji, available, stock, created_at)
     VALUES ($1, $1, $2, 'منتج بمتغيّرات', 'وصف', 10, 5, 'قطعة', '🧪', 1, 999, now())`,
    [PRODUCT_ID, CATEGORY_ID]
  )
  await pool.query(
    `INSERT INTO product_variants (id, product_id, name, sku, barcode, price, cost, stock, available, sort_order, created_at)
     VALUES ($1, $2, 'أحمر', 'ACYC-SKU-1', 'ACYC-BC-1', 12, 6, 10, 1, 0, now())`,
    [VARIANT_1, PRODUCT_ID]
  )
  await pool.query(
    `INSERT INTO product_variants (id, product_id, name, sku, barcode, price, cost, stock, available, sort_order, created_at)
     VALUES ($1, $2, 'أزرق', 'ACYC-SKU-2', 'ACYC-BC-2', 12, 6, 4, 1, 1, now())`,
    [VARIANT_2, PRODUCT_ID]
  )
}

async function cleanup() {
  await pool.query(`DELETE FROM stock_movements WHERE product_id = $1`, [PRODUCT_ID])
  await pool.query(`DELETE FROM cycle_count_items WHERE product_id = $1`, [PRODUCT_ID])
  await pool.query(`DELETE FROM cycle_counts WHERE category_id = $1`, [CATEGORY_ID])
  await pool.query(`DELETE FROM product_variants WHERE product_id = $1`, [PRODUCT_ID])
  await pool.query(`DELETE FROM products WHERE id = $1`, [PRODUCT_ID])
  await pool.query(`DELETE FROM categories WHERE id = $1`, [CATEGORY_ID])
  await pool.query(`DELETE FROM users WHERE email LIKE $1`, [`${PREFIX}%`])
}

beforeEach(async () => { await cleanup(); await seedCatalog() }, 20000)
afterAll(async () => { await cleanup(); await pool.end() })

describe('GET /api/admin/cycle-counts/:id/export — variant-aware', () => {
  it('exports one row per variant with the variant own sku/barcode', async () => {
    const agent = await adminAgent()
    const created = await agent.post('/api/admin/cycle-counts').send({ categoryId: CATEGORY_ID })
    expect(created.status).toBe(201)

    const res = await agent.get(`/api/admin/cycle-counts/${created.body.id}/export`)
    expect(res.status).toBe(200)
    expect(res.text).toContain('ACYC-SKU-1')
    expect(res.text).toContain('ACYC-SKU-2')
    expect(res.text).toContain('منتج بمتغيّرات — أحمر')
    expect(res.text).toContain('منتج بمتغيّرات — أزرق')
  })
})

describe('POST /api/admin/cycle-counts/:id/import — variant-aware', () => {
  it('matches each row by the variant sku and applies counts to the correct variant on completion', async () => {
    const agent = await adminAgent()
    const created = await agent.post('/api/admin/cycle-counts').send({ categoryId: CATEGORY_ID })
    expect(created.status).toBe(201)
    const cycleCountId = created.body.id

    const csv = [
      'sku,barcode,name,system_quantity,counted_quantity',
      'ACYC-SKU-1,ACYC-BC-1,منتج بمتغيّرات — أحمر,10,10',
      'ACYC-SKU-2,ACYC-BC-2,منتج بمتغيّرات — أزرق,4,7'
    ].join('\n')

    const res = await agent
      .post(`/api/admin/cycle-counts/${cycleCountId}/import`)
      .attach('file', Buffer.from(csv, 'utf-8'), 'counts.csv')
    expect(res.status).toBe(200)
    expect(res.body.updated).toBe(2)
    expect(res.body.unmatched).toEqual([])

    const complete = await agent.post(`/api/admin/cycle-counts/${cycleCountId}/complete`)
    expect(complete.status).toBe(200)
    expect(complete.body.adjustedCount).toBe(1)

    const { rows } = await pool.query<{ stock: number }>('SELECT stock FROM product_variants WHERE id = $1', [VARIANT_2])
    expect(rows[0].stock).toBe(7)
    const { rows: v1Rows } = await pool.query<{ stock: number }>('SELECT stock FROM product_variants WHERE id = $1', [VARIANT_1])
    expect(v1Rows[0].stock).toBe(10)
  })

  it('reports an unmatched row when the sku/barcode does not belong to this cycle count', async () => {
    const agent = await adminAgent()
    const created = await agent.post('/api/admin/cycle-counts').send({ categoryId: CATEGORY_ID })
    const csv = ['sku,barcode,name,system_quantity,counted_quantity', 'does-not-exist,,x,0,5'].join('\n')

    const res = await agent
      .post(`/api/admin/cycle-counts/${created.body.id}/import`)
      .attach('file', Buffer.from(csv, 'utf-8'), 'counts.csv')
    expect(res.status).toBe(200)
    expect(res.body.updated).toBe(0)
    expect(res.body.unmatched).toEqual(['does-not-exist'])
  })
})
