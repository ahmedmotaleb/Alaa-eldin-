import { Router } from 'express'
import { pool } from '../db.js'
import { listPublicAlternatives } from '../services/productAlternativeService.js'
import { listProducts, resolveProducts, autocompleteProducts, getProductBySlug, type SortOption } from '../services/catalogService.js'

export const catalogRouter = Router()

interface CategoryRow {
  id: string
  name: string
  emoji: string
  tint: string
  imageUrl: string | null
  productCount: string
}

const SORT_OPTIONS = new Set<SortOption>(['popular', 'price_asc', 'price_desc', 'name', 'newest'])

function parseBool(value: unknown): boolean | undefined {
  if (value === 'true') return true
  if (value === 'false') return false
  return undefined
}

catalogRouter.get('/categories', async (_req, res) => {
  const { rows } = await pool.query<CategoryRow>(`
    SELECT c.id, c.name, c.emoji, c.tint, c.image_url as "imageUrl",
           (SELECT count(*) FROM products p WHERE p.category_id = c.id) as "productCount"
    FROM categories c
    ORDER BY c.sort_order
  `)
  res.json({
    categories: rows.map(r => ({
      id: r.id, name: r.name, emoji: r.emoji, tint: r.tint,
      image: r.imageUrl ?? undefined,
      productCount: Number(r.productCount)
    }))
  })
})

// كل الفلترة والفرز والتقسيم لصفحات بيحصل في PostgreSQL — الواجهة الأمامية مبتحملش الكتالوج
// كامل خالص ولا بتعمل أي فلترة/فرز في React. راجع Product Card DTO في catalogService (بيانات
// خفيفة بس بدون الوصف الكامل أو التكلفة أو الكمية الدقيقة).
catalogRouter.get('/products', async (req, res) => {
  const sort = SORT_OPTIONS.has(req.query.sort as SortOption) ? (req.query.sort as SortOption) : undefined
  const result = await listProducts({
    page: req.query.page ? Number(req.query.page) : undefined,
    limit: req.query.limit ? Number(req.query.limit) : undefined,
    category: typeof req.query.category === 'string' ? req.query.category : undefined,
    search: typeof req.query.search === 'string' ? req.query.search : undefined,
    sort,
    offer: parseBool(req.query.offer),
    bestseller: parseBool(req.query.bestseller),
    available: parseBool(req.query.available),
    brand: typeof req.query.brand === 'string' ? req.query.brand : undefined
  })
  res.json(result)
})

// إكمال تلقائي بعد 300ms debounce على الواجهة — هنا برضه بنفس شرط حد أدنى حرفين، ما عدا
// مطابقة باركود دقيقة اللي بتشتغل فوراً.
catalogRouter.get('/products/autocomplete', async (req, res) => {
  const products = await autocompleteProducts(typeof req.query.search === 'string' ? req.query.search : '')
  res.json({ products })
})

// حل دفعة من معرفات المنتجات لحالتها الحالية (سعر/صورة/توفر/وحدة) — بيستخدمها السلة
// (والطلبات المحفوظة محلياً) عشان تعيد التحقق من بيانات المنتج من غير ما تحمّل الكتالوج كامل.
catalogRouter.post('/products/resolve', async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter((id: unknown) => typeof id === 'string') : []
  const products = await resolveProducts(ids)
  res.json({ products })
})

// بدائل مشابهة مُدارة يدوياً من الإدارة — لعرض اقتراحات فقط، مفيش أي استبدال تلقائي
// للمنتج في السلة أو الطلب من هنا. بيانات خفيفة (زي كارت منتج) بس.
catalogRouter.get('/products/:id/alternatives', async (req, res) => {
  const alternatives = await listPublicAlternatives(String(req.params.id))
  res.json({ alternatives })
})

// تفاصيل منتج كاملة للعميل (وصف، معرض صور، بدائل، منتجات مشابهة) — مفيش تكلفة داخلية
// ولا كمية مخزون دقيقة، بس حالة مخزون آمنة (متوفر/منخفض/نافد).
catalogRouter.get('/products/:slug', async (req, res) => {
  const product = await getProductBySlug(String(req.params.slug))
  if (!product) {
    res.status(404).json({ error: 'product_not_found' })
    return
  }
  res.json({ product })
})
