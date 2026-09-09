// بذر بيانات تجريبية — أمر صريح (npm run db:seed) وليس جزءاً من إقلاع التطبيق.
// آمن يتنفذ أكتر من مرة: كل خطوة بتتحقق إن الجدول فاضي الأول قبل ما تدرج أي حاجة،
// فمفيش خطر إنه يكرر البيانات أو يطبّق على قاعدة بيانات إنتاج فيها بيانات حقيقية بالفعل.
import { pool, withTransaction } from './db.js'
import { SEED_CATEGORIES, SEED_PRODUCTS } from './seedData.js'

async function seedCategoriesAndProducts() {
  const { rows: [{ n }] } = await pool.query<{ n: string }>('SELECT COUNT(*) as n FROM categories')
  if (Number(n) > 0) {
    console.log('categories/products already seeded — skipping')
    return
  }

  await withTransaction(async client => {
    for (const c of SEED_CATEGORIES) {
      await client.query(
        'INSERT INTO categories (id, name, emoji, tint, sort_order) VALUES ($1, $2, $3, $4, $5)',
        [c.id, c.name, c.emoji, c.tint, c.sortOrder]
      )
    }
    const now = new Date().toISOString()
    for (const p of SEED_PRODUCTS) {
      await client.query(
        `INSERT INTO products (id, slug, category_id, name, description, price, old_price, cost, unit, emoji, available, bestseller, offer, order_count, stock, alert_threshold, barcode, brand, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
        [
          p.id, p.slug, p.categoryId, p.name, p.description, p.price, p.oldPrice ?? null, p.cost, p.unit, p.emoji,
          p.available ? 1 : 0, p.bestseller ? 1 : 0, p.offer ? 1 : 0, p.orderCount, p.stock, p.alertThreshold, p.barcode, p.brand, now
        ]
      )
    }
  })
  console.log(`seeded ${SEED_CATEGORIES.length} categories and ${SEED_PRODUCTS.length} products`)
}

async function seedDefaultBanner() {
  const { rows: [{ n }] } = await pool.query<{ n: string }>('SELECT COUNT(*) as n FROM banners')
  if (Number(n) > 0) {
    console.log('banners already seeded — skipping')
    return
  }
  await pool.query(
    `INSERT INTO banners (kicker, title, note, emoji, cta_label, link, active, sort_order, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, 1, 0, $7)`,
    ['🔥 عرض الأسبوع', 'خصم 20% على الألبان والأجبان', 'صالح حتى نهاية الأسبوع', '🧀', 'تسوق العرض', '/category/dairy', new Date().toISOString()]
  )
  console.log('seeded default banner')
}

async function seedDefaultStoreSettings() {
  const { rows: [{ n }] } = await pool.query<{ n: string }>('SELECT COUNT(*) as n FROM store_settings')
  if (Number(n) > 0) {
    console.log('store_settings already seeded — skipping')
    return
  }
  await pool.query(
    `INSERT INTO store_settings (id, name, whatsapp_number, currency, minimum_order, free_shipping_threshold, delivery_fee)
     VALUES (1, $1, $2, $3, $4, $5, $6)`,
    // رقم الواتساب بيتخزّن بالصيغة المحلية (01xxxxxxxxx) — نفس القاعدة اللي بيفرضها
    // isValidEgyptianMobile في الواجهة ولوحة التحكم. التحويل للصيغة الدولية بيحصل وقت
    // بناء رابط wa.me بس. القيمة القديمة هنا كانت بصيغة دولية (201XXXXXXXXX) واللي كانت
    // بتخالف التحقق نفسه وبتمنع حفظ إعدادات المتجر لحد ما الأدمن يصلّحها يدوياً.
    ['علاء الدين', '01XXXXXXXXX', 'ج.م', 100, 500, 30]
  )
  console.log('seeded default store_settings')
}

async function main() {
  await seedCategoriesAndProducts()
  await seedDefaultBanner()
  await seedDefaultStoreSettings()
}

main()
  .then(() => pool.end())
  .catch(async err => {
    console.error(err)
    await pool.end()
    process.exit(1)
  })
