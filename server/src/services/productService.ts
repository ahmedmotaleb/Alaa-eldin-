import crypto from 'node:crypto'
import { pool, withTransaction } from '../db.js'

export interface ProductRow {
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
  primaryImage: string | null
  tracksExpiry: number
  defaultShelfLifeDays: number | null
  sku: string | null
}

export const SELECT_PRODUCT = `
  SELECT id, slug, category_id as "categoryId", name, description, price, old_price as "oldPrice", cost,
         unit, emoji, available, bestseller, offer, order_count as "orderCount", stock, alert_threshold as "alertThreshold",
         barcode, brand, tracks_expiry as "tracksExpiry", default_shelf_life_days as "defaultShelfLifeDays", sku
  FROM products
`

export function serializeProduct(row: ProductRow) {
  return {
    ...row,
    oldPrice: row.oldPrice ?? undefined,
    available: !!row.available,
    bestseller: !!row.bestseller,
    offer: !!row.offer,
    primaryImage: row.primaryImage ?? undefined,
    tracksExpiry: !!row.tracksExpiry
  }
}

export type SerializedProduct = ReturnType<typeof serializeProduct>

export interface ProductWriteInput {
  categoryId: string
  name: string
  description: string
  price: number
  oldPrice: number | null
  cost: number
  unit: string
  emoji: string
  available: boolean
  bestseller: boolean
  offer: boolean
  stock: number
  alertThreshold: number
  barcode: string
  brand: string
}

// خريطة تحويل صوتي (transliteration) مبسّطة من العربي لحروف لاتينية — الهدف تسهيل قراءة
// الرابط تقريبياً (زي "زيت" -> "zyt") مش تمثيل صوتي دقيق أكاديمي. أي حرف عربي مش موجود في
// الخريطة (تشكيل، رموز) بيتجاهل بصمت بدل ما يوقف التوليد.
const ARABIC_TRANSLITERATION: Record<string, string> = {
  'ا': 'a', 'أ': 'a', 'إ': 'a', 'آ': 'a', 'ٱ': 'a', 'ى': 'a', 'ة': 'a',
  'ب': 'b', 'ت': 't', 'ث': 'th', 'ج': 'j', 'ح': 'h', 'خ': 'kh',
  'د': 'd', 'ذ': 'dh', 'ر': 'r', 'ز': 'z', 'س': 's', 'ش': 'sh',
  'ص': 's', 'ض': 'd', 'ط': 't', 'ظ': 'z', 'ع': 'a', 'غ': 'gh',
  'ف': 'f', 'ق': 'q', 'ك': 'k', 'ل': 'l', 'م': 'm', 'ن': 'n',
  'ه': 'h', 'و': 'w', 'ي': 'y', 'ئ': 'y', 'ؤ': 'w', 'ء': ''
}

function transliterate(input: string): string {
  return Array.from(input).map(ch => ARABIC_TRANSLITERATION[ch] ?? ch).join('')
}

// بيحوّل اسم المنتج لرابط (slug) آمن للـ URL: تحويل صوتي للعربي، تصغير الحروف، استبدال أي
// حاجة غير [a-z0-9] بشرطة واحدة، وإزالة الشرطات الزايدة من الأول/الآخر. لو الناتج فاضي
// بالكامل (اسم كله رموز/إيموجي مثلاً)، بيرجع "product" كـ fallback موثوق — الرابط أبداً ما
// بيبقاش فاضي.
export function slugifyProductName(name: string): string {
  const transliterated = transliterate(name)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // إزالة أي تشكيل/diacritics لاتينية (حروف بأكسنت)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return transliterated || 'product'
}

// بيولّد رابط فريد فعلياً: يجيب كل الروابط الموجودة اللي تطابق القاعدة أو القاعدة-رقم، وبعدين
// يختار أصغر لاحقة حرة (من غير لاحقة لو القاعدة نفسها حرة، وإلا -2 ثم -3 وهكذا).
export async function generateUniqueProductSlug(name: string): Promise<string> {
  const base = slugifyProductName(name)
  const { rows } = await pool.query<{ slug: string }>(
    'SELECT slug FROM products WHERE slug = $1 OR slug LIKE $2',
    [base, `${base}-%`]
  )
  const taken = new Set(rows.map(r => r.slug))
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base}-${n}`)) n++
  return `${base}-${n}`
}

function isUniqueSlugViolation(err: unknown): boolean {
  return err instanceof Error && 'code' in err && (err as { code: string }).code === '23505'
    && 'constraint' in err && String((err as { constraint?: string }).constraint ?? '').includes('slug')
}

// إنشاء منتج جديد — الرابط (slug) بيتولّد هنا بالكامل من اسم المنتج، أبداً مش بيتاخد من
// الفرونت إند. لو حصل تصادم نادر جداً (سباق حقيقي بين طلبين متزامنين بنفس الاسم بالظبط)،
// بيعيد المحاولة مرة واحدة بقراءة حالة قاعدة البيانات الفعلية تاني بدل ما يفشل الإنشاء كله.
export async function createProduct(input: ProductWriteInput): Promise<SerializedProduct> {
  const id = 'p' + crypto.randomBytes(4).toString('hex')
  let slug = await generateUniqueProductSlug(input.name)

  const insert = (slugToUse: string) => pool.query(
    `INSERT INTO products (id, slug, category_id, name, description, price, old_price, cost, unit, emoji, available, bestseller, offer, order_count, stock, alert_threshold, barcode, brand, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 0, $14, $15, $16, $17, $18)`,
    [
      id, slugToUse, input.categoryId, input.name, input.description, input.price, input.oldPrice, input.cost, input.unit, input.emoji,
      input.available ? 1 : 0, input.bestseller ? 1 : 0, input.offer ? 1 : 0, input.stock, input.alertThreshold, input.barcode, input.brand,
      new Date().toISOString()
    ]
  )

  try {
    await insert(slug)
  } catch (err) {
    if (!isUniqueSlugViolation(err)) throw err
    slug = await generateUniqueProductSlug(input.name)
    await insert(slug)
  }

  const { rows } = await pool.query<ProductRow>(`${SELECT_PRODUCT} WHERE id = $1`, [id])
  return serializeProduct(rows[0])
}

export interface ProductUpdateResult {
  before: SerializedProduct
  after: SerializedProduct
  stockDiff: number
  costChanged: boolean
}

// تعديل منتج موجود — الرابط (slug) أبداً ما بيتغيّرش هنا حتى لو الاسم اتغيّر، عشان روابط
// المنتج المنشورة (وأي فهرسة/مشاركة خارجية ليها) تفضل شغالة. لو حابب تغيّر الرابط فعلاً،
// ده قرار متعمّد محتاج مسار منفصل صريح (مش موجود دلوقتي بتصميم)، مش تأثير جانبي لتعديل الاسم.
export async function updateProduct(id: string, input: ProductWriteInput, updatedByUserId: string): Promise<ProductUpdateResult | null> {
  const { rows: existingRows } = await pool.query<ProductRow>(`${SELECT_PRODUCT} WHERE id = $1`, [id])
  const existing = existingRows[0]
  if (!existing) return null

  const stockDiff = input.stock - existing.stock
  const costChanged = input.cost !== existing.cost

  await withTransaction(async client => {
    await client.query(
      `UPDATE products SET category_id=$1, name=$2, description=$3, price=$4,
         old_price=$5, cost=$6, unit=$7, emoji=$8, available=$9, bestseller=$10,
         offer=$11, stock=$12, alert_threshold=$13, barcode=$14, brand=$15
       WHERE id=$16`,
      [
        input.categoryId, input.name, input.description, input.price,
        input.oldPrice, input.cost, input.unit, input.emoji, input.available ? 1 : 0, input.bestseller ? 1 : 0,
        input.offer ? 1 : 0, input.stock, input.alertThreshold, input.barcode, input.brand,
        id
      ]
    )
    if (stockDiff !== 0) {
      await client.query(
        `INSERT INTO stock_movements (product_id, type, quantity_change, note, created_at)
         VALUES ($1, 'adjustment', $2, 'تعديل من صفحة المنتج', $3)`,
        [id, stockDiff, new Date().toISOString()]
      )
    }
    if (costChanged) {
      await client.query(
        `INSERT INTO product_cost_history (id, product_id, unit_cost, source_type, source_id)
         VALUES ($1, $2, $3, 'manual_adjustment', $4)`,
        [crypto.randomUUID(), id, input.cost, updatedByUserId]
      )
    }
  })

  const { rows } = await pool.query<ProductRow>(`${SELECT_PRODUCT} WHERE id = $1`, [id])
  return {
    before: serializeProduct(existing),
    after: serializeProduct(rows[0]),
    stockDiff,
    costChanged
  }
}
