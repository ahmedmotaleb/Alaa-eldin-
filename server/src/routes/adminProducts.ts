import { Router } from 'express'
import crypto from 'node:crypto'
import { db } from '../db.js'
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
  SELECT id, slug, category_id as categoryId, name, description, price, old_price as oldPrice, cost,
         unit, emoji, available, bestseller, offer, order_count as orderCount, stock, alert_threshold as alertThreshold,
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

adminProductsRouter.get('/', (_req, res) => {
  const rows = db.prepare(`${SELECT_PRODUCT} ORDER BY name`).all() as ProductRow[]
  res.json({ products: rows.map(serialize) })
})

adminProductsRouter.get('/:id', (req, res) => {
  const row = db.prepare(`${SELECT_PRODUCT} WHERE id = ?`).get(req.params.id) as ProductRow | undefined
  if (!row) {
    res.status(404).json({ error: 'product_not_found' })
    return
  }
  res.json({ product: serialize(row) })
})

function validateBody(body: unknown) {
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

  const category = db.prepare('SELECT id FROM categories WHERE id = ?').get(b.categoryId)
  if (!category) return null

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

adminProductsRouter.post('/', (req, res) => {
  const data = validateBody(req.body)
  if (!data) {
    res.status(400).json({ error: 'missing_fields' })
    return
  }

  const existing = db.prepare('SELECT id FROM products WHERE slug = ?').get(data.slug)
  if (existing) {
    res.status(409).json({ error: 'slug_taken' })
    return
  }

  const id = 'p' + crypto.randomBytes(4).toString('hex')
  db.prepare(`
    INSERT INTO products (id, slug, category_id, name, description, price, old_price, cost, unit, emoji, available, bestseller, offer, order_count, stock, alert_threshold, barcode, brand)
    VALUES (@id, @slug, @categoryId, @name, @description, @price, @oldPrice, @cost, @unit, @emoji, @available, @bestseller, @offer, 0, @stock, @alertThreshold, @barcode, @brand)
  `).run({
    id, ...data,
    available: data.available ? 1 : 0,
    bestseller: data.bestseller ? 1 : 0,
    offer: data.offer ? 1 : 0
  })

  const row = db.prepare(`${SELECT_PRODUCT} WHERE id = ?`).get(id) as ProductRow
  res.status(201).json({ product: serialize(row) })
})

adminProductsRouter.patch('/:id', (req, res) => {
  const existing = db.prepare(`${SELECT_PRODUCT} WHERE id = ?`).get(req.params.id) as ProductRow | undefined
  if (!existing) {
    res.status(404).json({ error: 'product_not_found' })
    return
  }

  const data = validateBody({ ...serialize(existing), ...(req.body ?? {}) })
  if (!data) {
    res.status(400).json({ error: 'missing_fields' })
    return
  }

  if (data.slug) {
    const slugOwner = db.prepare('SELECT id FROM products WHERE slug = ? AND id != ?').get(data.slug, req.params.id)
    if (slugOwner) {
      res.status(409).json({ error: 'slug_taken' })
      return
    }
  }

  const stockDiff = data.stock - existing.stock
  const updateProduct = db.prepare(`
    UPDATE products SET slug=@slug, category_id=@categoryId, name=@name, description=@description, price=@price,
      old_price=@oldPrice, cost=@cost, unit=@unit, emoji=@emoji, available=@available, bestseller=@bestseller,
      offer=@offer, stock=@stock, alert_threshold=@alertThreshold, barcode=@barcode, brand=@brand
    WHERE id=@id
  `)
  const insertMovement = db.prepare(`
    INSERT INTO stock_movements (product_id, type, quantity_change, note)
    VALUES (?, 'adjustment', ?, 'تعديل من صفحة المنتج')
  `)

  db.transaction(() => {
    updateProduct.run({
      id: req.params.id, ...data,
      available: data.available ? 1 : 0,
      bestseller: data.bestseller ? 1 : 0,
      offer: data.offer ? 1 : 0
    })
    if (stockDiff !== 0) insertMovement.run(req.params.id, stockDiff)
  })()

  const row = db.prepare(`${SELECT_PRODUCT} WHERE id = ?`).get(req.params.id) as ProductRow
  res.json({ product: serialize(row) })
})
