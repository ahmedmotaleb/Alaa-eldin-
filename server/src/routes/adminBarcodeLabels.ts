// راجت صفحة "المنتجات → طباعة الباركود" — بحث عن منتجات/متغيرات لطباعة ملصقات، وتوليد باركود
// داخلي جديد للمفقود بس (بدون إعادة توليد أي باركود موجود بالفعل إلا بتأكيد صريح).
import { Router } from 'express'
import { pool } from '../db.js'
import { requireAdmin, requirePermission } from '../auth.js'
import { recordAuditLog } from '../services/auditLogService.js'
import { listVariantsForProduct, type ProductVariant } from '../services/productVariantService.js'
import { generateBarcodeForProduct, generateBarcodeForVariant } from '../services/barcodeService.js'
import { NORMALIZE_SQL } from '../textSearch.js'

export const adminBarcodeLabelsRouter = Router()
adminBarcodeLabelsRouter.use(requireAdmin)

const MIN_SEARCH_LENGTH = 2
const SEARCH_RESULT_LIMIT = 30

interface BarcodeSearchRow {
  id: string
  name: string
  barcode: string
  sku: string | null
  price: number
  stock: number
  brand: string
  emoji: string
  categoryName: string
}

export interface BarcodeSearchProduct {
  id: string
  name: string
  barcode: string
  sku: string | null
  price: number
  stock: number
  brand: string
  emoji: string
  categoryName: string
  variants: ProductVariant[]
}

// البحث بيغطي اسم/باركود/SKU/الماركة/القسم للمنتج نفسه، وكمان اسم/باركود/SKU أي متغيّر
// تابع له (EXISTS) — عشان لو الأدمن بحث برقم باركود متغيّر بالتحديد، المنتج الأب يظهر مع
// كل متغيراته (مش المتغيّر المطابق بس) عشان يقدر يختار أي متغيّر تاني منه لو حب.
adminBarcodeLabelsRouter.get('/search', requirePermission('products.barcode.view'), async (req, res) => {
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : ''
  if (search.length < MIN_SEARCH_LENGTH) {
    res.json({ products: [] })
    return
  }

  const likeTerm = `%${search}%`
  const { rows } = await pool.query<BarcodeSearchRow>(
    `SELECT p.id, p.name, p.barcode, p.sku, p.price, p.stock, p.brand, p.emoji, c.name as "categoryName"
     FROM products p
     JOIN categories c ON c.id = p.category_id
     WHERE (
       p.barcode = $2 OR p.sku ILIKE $1
       OR ${NORMALIZE_SQL('p.name')} ILIKE ${NORMALIZE_SQL('$1')}
       OR ${NORMALIZE_SQL('p.brand')} ILIKE ${NORMALIZE_SQL('$1')}
       OR ${NORMALIZE_SQL('c.name')} ILIKE ${NORMALIZE_SQL('$1')}
       OR EXISTS (
         SELECT 1 FROM product_variants v
         WHERE v.product_id = p.id
           AND (v.barcode = $2 OR v.sku ILIKE $1 OR ${NORMALIZE_SQL('v.name')} ILIKE ${NORMALIZE_SQL('$1')})
       )
     )
     ORDER BY p.name
     LIMIT $3`,
    [likeTerm, search, SEARCH_RESULT_LIMIT]
  )

  const products: BarcodeSearchProduct[] = await Promise.all(
    rows.map(async row => ({ ...row, variants: await listVariantsForProduct(row.id) }))
  )
  res.json({ products })
})

interface GenerateBarcodeBody {
  targetType: 'product' | 'variant'
  targetId: string
  confirmOverwrite?: boolean
}

function validateGenerateBody(body: unknown): GenerateBarcodeBody | null {
  const b = body as Record<string, unknown>
  if ((b?.targetType !== 'product' && b?.targetType !== 'variant') || typeof b?.targetId !== 'string' || !b.targetId.trim()) {
    return null
  }
  return { targetType: b.targetType, targetId: b.targetId.trim(), confirmOverwrite: b.confirmOverwrite === true }
}

adminBarcodeLabelsRouter.post('/generate', requirePermission('products.barcode.generate'), async (req, res) => {
  const body = validateGenerateBody(req.body)
  if (!body) { res.status(400).json({ error: 'invalid_request' }); return }

  const result = body.targetType === 'product'
    ? await generateBarcodeForProduct(body.targetId, body.confirmOverwrite)
    : await generateBarcodeForVariant(body.targetId, body.confirmOverwrite)

  if ('error' in result) {
    res.status(result.error === 'barcode_already_set' ? 409 : 404).json({ error: result.error })
    return
  }

  await recordAuditLog({
    adminUserId: req.user!.id,
    action: 'product_barcode_generated',
    entityType: body.targetType,
    entityId: body.targetId,
    newValues: { barcode: result.barcode }
  })
  res.json(result)
})
