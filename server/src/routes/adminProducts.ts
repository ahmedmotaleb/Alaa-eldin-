import { Router } from 'express'
import crypto from 'node:crypto'
import { pool, withTransaction } from '../db.js'
import { requireAdmin } from '../auth.js'

export const adminProductsRouter = Router()
adminProductsRouter.use(requireAdmin)

interface ProductRow {
  id: string
  slug: string
  categoryId: string
  name: string
  description: string
  price: number
  oldPrice: number | null
  cost: number
  unit: string
  emoji: string
  available: number
  bestseller: number
  offer: number
  orderCount: number
  stock: number
  alertThreshold: number
  barcode: string
  brand: string
}

const SELECT_PRODUCT = `
  SELECT id, slug, category_id as "categoryId", name, description, price, old_price as "oldPrice", cost,
         unit, emoji, available, bestseller, offer, order_count as "orderCount", stock, alert_threshold as "alertThreshold",
         barcode, brand
  FROM products
`

function serialize(row: ProductRow) {
  return {
    ...row,
    oldPrice: row.oldPrice ?? undefined,
    available: !!row.available,
    bestseller: !!row.bestseller,
    offer: !!row.offer
  }
}

adminProductsRouter.get('/', async (_req, res) => {
  const { rows } = await pool.query<ProductRow>(`${SELECT_PRODUCT} ORDER BY name`)
  res.json({ products: rows.map(serialize) })
})

adminProductsRouter.get('/:id', async (req, res) => {
  const { rows } = await pool.query<ProductRow>(`${SELECT_PRODUCT} WHERE id = $1`, [req.params.id])
  const row = rows[0]
  if (!row) {
    res.status(404).json({ error: 'product_not_found' })
    return
  }
  res.json({ product: serialize(row) })
})

async function validateBody(body: unknown) {
  const b = body as Record<string, unknown>
  if (
    typeof b?.slug !== 'string' || !b.slug.trim() ||
    typeof b?.categoryId !== 'string' || !b.categoryId.trim() ||
    typeof b?.name !== 'string' || !b.name.trim() ||
    typeof b?.description !== 'string' ||
    typeof b?.price !== 'number' || b.price <= 0 ||
    typeof b?.cost !== 'number' || b.cost < 0 ||
    typeof b?.unit !== 'string' || !b.unit.trim() ||
    typeof b?.emoji !== 'string' || !b.emoji.trim() ||
    typeof b?.available !== 'boolean' ||
    typeof b?.stock !== 'number' || b.stock < 0 ||
    typeof b?.alertThreshold !== 'number' || b.alertThreshold < 0
  ) return null

  const { rows: categoryRows } = await pool.query('SELECT id FROM categories WHERE id = $1', [b.categoryId])
  if (!categoryRows[0]) return null

  return {
    slug: b.slug.trim(),
    categoryId: b.categoryId as string,
    name: (b.name as string).trim(),
    description: (b.description as string).trim(),
    price: b.price as number,
    oldPrice: typeof b.oldPrice === 'number' && b.oldPrice > 0 ? b.oldPrice : null,
    cost: b.cost as number,
    unit: (b.unit as string).trim(),
    emoji: (b.emoji as string).trim(),
    available: b.available as boolean,
    bestseller: !!b.bestseller,
    offer: !!b.offer,
    stock: b.stock as number,
    alertThreshold: b.alertThreshold as number,
    barcode: typeof b.barcode === 'string' ? b.barcode.trim() : '',
    brand: typeof b.brand === 'string' ? b.brand.trim() : ''
  }
}

adminProductsRouter.post('/', async (req, res) => {
  const data = await validateBody(req.body)
  if (!data) {
    res.status(400).json({ error: 'missing_fields' })
    return
  }

  const { rows: existingRows } = await pool.query('SELECT id FROM products WHERE slug = $1', [data.slug])
  if (existingRows[0]) {
    res.status(409).json({ error: 'slug_taken' })
    return
  }

  const id = 'p' + crypto.randomBytes(4).toString('hex')
  await pool.query(
    `INSERT INTO products (id, slug, category_id, name, description, price, old_price, cost, unit, emoji, available, bestseller, offer, order_count, stock, alert_threshold, barcode, brand, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 0, $14, $15, $16, $17, $18)`,
    [
      id, data.slug, data.categoryId, data.name, data.description, data.price, data.oldPrice, data.cost, data.unit, data.emoji,
      data.available ? 1 : 0, data.bestseller ? 1 : 0, data.offer ? 1 : 0, data.stock, data.alertThreshold, data.barcode, data.brand,
      new Date().toISOString()
    ]
  )

  const { rows } = await pool.query<ProductRow>(`${SELECT_PRODUCT} WHERE id = $1`, [id])
  res.status(201).json({ product: serialize(rows[0]) })
})

adminProductsRouter.patch('/:id', async (req, res) => {
  const { rows: existingRows } = await pool.query<ProductRow>(`${SELECT_PRODUCT} WHERE id = $1`, [req.params.id])
  const existing = existingRows[0]
  if (!existing) {
    res.status(404).json({ error: 'product_not_found' })
    return
  }

  const data = await validateBody({ ...serialize(existing), ...(req.body ?? {}) })
  if (!data) {
    res.status(400).json({ error: 'missing_fields' })
    return
  }

  if (data.slug) {
    const { rows: slugOwnerRows } = await pool.query('SELECT id FROM products WHERE slug = $1 AND id != $2', [data.slug, req.params.id])
    if (slugOwnerRows[0]) {
      res.status(409).json({ error: 'slug_taken' })
      return
    }
  }

  const stockDiff = data.stock - existing.stock

  await withTransaction(async client => {
    await client.query(
      `UPDATE products SET slug=$1, category_id=$2, name=$3, description=$4, price=$5,
         old_price=$6, cost=$7, unit=$8, emoji=$9, available=$10, bestseller=$11,
         offer=$12, stock=$13, alert_threshold=$14, barcode=$15, brand=$16
       WHERE id=$17`,
      [
        data.slug, data.categoryId, data.name, data.description, data.price,
        data.oldPrice, data.cost, data.unit, data.emoji, data.available ? 1 : 0, data.bestseller ? 1 : 0,
        data.offer ? 1 : 0, data.stock, data.alertThreshold, data.barcode, data.brand,
        req.params.id
      ]
    )
    if (stockDiff !== 0) {
      await client.query(
        `INSERT INTO stock_movements (product_id, type, quantity_change, note, created_at)
         VALUES ($1, 'adjustment', $2, 'تعديل من صفحة المنتج', $3)`,
        [req.params.id, stockDiff, new Date().toISOString()]
      )
    }
  })

  const { rows } = await pool.query<ProductRow>(`${SELECT_PRODUCT} WHERE id = $1`, [req.params.id])
  res.json({ product: serialize(rows[0]) })
})
