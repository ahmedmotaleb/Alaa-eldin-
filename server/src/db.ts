import pg from 'pg'
import { SEED_CATEGORIES, SEED_PRODUCTS } from './seedData.js'

const { Pool } = pg

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/alaa_eldin'
})

export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      is_admin INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      emoji TEXT NOT NULL,
      tint TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      category_id TEXT NOT NULL REFERENCES categories(id),
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      price REAL NOT NULL,
      old_price REAL,
      cost REAL NOT NULL DEFAULT 0,
      unit TEXT NOT NULL,
      emoji TEXT NOT NULL,
      available INTEGER NOT NULL DEFAULT 1,
      bestseller INTEGER NOT NULL DEFAULT 0,
      offer INTEGER NOT NULL DEFAULT 0,
      order_count INTEGER NOT NULL DEFAULT 0,
      stock INTEGER NOT NULL DEFAULT 0,
      alert_threshold INTEGER NOT NULL DEFAULT 0,
      barcode TEXT NOT NULL DEFAULT '',
      brand TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS riders (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settlements (
      id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      rider_id TEXT NOT NULL REFERENCES riders(id),
      amount REAL NOT NULL,
      order_count INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      delivery_slot TEXT NOT NULL,
      payment_method TEXT NOT NULL,
      customer_full_name TEXT NOT NULL,
      customer_mobile TEXT NOT NULL,
      customer_governorate TEXT NOT NULL DEFAULT '',
      customer_address TEXT NOT NULL,
      subtotal REAL NOT NULL,
      delivery_fee REAL NOT NULL,
      total REAL NOT NULL,
      status TEXT NOT NULL,
      discount_code TEXT,
      discount_amount REAL NOT NULL DEFAULT 0,
      rider_id TEXT REFERENCES riders(id),
      settlement_id INTEGER REFERENCES settlements(id)
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id TEXT NOT NULL,
      name TEXT NOT NULL,
      unit TEXT NOT NULL,
      unit_price REAL NOT NULL,
      quantity INTEGER NOT NULL,
      line_total REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS discounts (
      code TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK (type IN ('percentage', 'fixed')),
      value REAL NOT NULL,
      min_order REAL NOT NULL DEFAULT 0,
      max_uses INTEGER,
      used_count INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      expires_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS stock_movements (
      id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      product_id TEXT NOT NULL REFERENCES products(id),
      type TEXT NOT NULL CHECK (type IN ('restock', 'return', 'damage', 'loss', 'adjustment')),
      quantity_change INTEGER NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS banners (
      id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      kicker TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      emoji TEXT NOT NULL,
      cta_label TEXT NOT NULL,
      link TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      category TEXT NOT NULL,
      amount REAL NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      expense_date TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS store_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      name TEXT NOT NULL,
      whatsapp_number TEXT NOT NULL,
      currency TEXT NOT NULL,
      minimum_order REAL NOT NULL,
      free_shipping_threshold REAL NOT NULL,
      delivery_fee REAL NOT NULL,
      show_todays_offers INTEGER NOT NULL DEFAULT 1,
      show_best_sellers INTEGER NOT NULL DEFAULT 1,
      cod_enabled INTEGER NOT NULL DEFAULT 1
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
    CREATE INDEX IF NOT EXISTS idx_orders_rider ON orders(rider_id);
    CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
    CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
    CREATE INDEX IF NOT EXISTS idx_stock_movements_product ON stock_movements(product_id);
    CREATE INDEX IF NOT EXISTS idx_settlements_rider ON settlements(rider_id);
  `)

  // طلبات الزوّار (بدون تسجيل دخول) أصبحت مسموحة — عمود user_id بقى nullable.
  // ده تعديل على عمود موجود بالفعل في قواعد بيانات منشورة قبل كده، فمحتاج ALTER صريح
  // (على عكس باقي الأعمدة اللي بتتزرع كاملة من الأول في CREATE TABLE). آمن يتنفذ كذا مرة.
  await pool.query('ALTER TABLE orders ALTER COLUMN user_id DROP NOT NULL')

  const { rows: [{ n: categoryCount }] } = await pool.query<{ n: string }>('SELECT COUNT(*) as n FROM categories')
  if (Number(categoryCount) === 0) {
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
  }

  const { rows: [{ n: bannerCount }] } = await pool.query<{ n: string }>('SELECT COUNT(*) as n FROM banners')
  if (Number(bannerCount) === 0) {
    await pool.query(
      `INSERT INTO banners (kicker, title, note, emoji, cta_label, link, active, sort_order, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 1, 0, $7)`,
      ['🔥 عرض الأسبوع', 'خصم 20% على الألبان والأجبان', 'صالح حتى نهاية الأسبوع', '🧀', 'تسوق العرض', '/category/dairy', new Date().toISOString()]
    )
  }

  const { rows: [{ n: settingsCount }] } = await pool.query<{ n: string }>('SELECT COUNT(*) as n FROM store_settings')
  if (Number(settingsCount) === 0) {
    await pool.query(
      `INSERT INTO store_settings (id, name, whatsapp_number, currency, minimum_order, free_shipping_threshold, delivery_fee)
       VALUES (1, $1, $2, $3, $4, $5, $6)`,
      ['علاء الدين', '201XXXXXXXXX', 'ج.م', 100, 500, 30]
    )
  }
}
