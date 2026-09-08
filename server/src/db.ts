import Database from 'better-sqlite3'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { SEED_CATEGORIES, SEED_PRODUCTS } from './seedData.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.join(__dirname, '..', 'data')
fs.mkdirSync(dataDir, { recursive: true })

export const db = new Database(path.join(dataDir, 'app.sqlite'))
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
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

  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
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
    status TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL,
    name TEXT NOT NULL,
    unit TEXT NOT NULL,
    unit_price REAL NOT NULL,
    quantity INTEGER NOT NULL,
    line_total REAL NOT NULL
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
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
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
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS stock_movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id TEXT NOT NULL REFERENCES products(id),
    type TEXT NOT NULL CHECK (type IN ('restock', 'return', 'damage', 'loss', 'adjustment')),
    quantity_change INTEGER NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS banners (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kicker TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    emoji TEXT NOT NULL,
    cta_label TEXT NOT NULL,
    link TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS riders (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT NOT NULL DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS settlements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rider_id TEXT NOT NULL REFERENCES riders(id),
    amount REAL NOT NULL,
    order_count INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL,
    amount REAL NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    expense_date TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
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
  CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
  CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
  CREATE INDEX IF NOT EXISTS idx_stock_movements_product ON stock_movements(product_id);
  CREATE INDEX IF NOT EXISTS idx_settlements_rider ON settlements(rider_id);
`)

const orderColumns = (db.prepare("PRAGMA table_info(orders)").all() as { name: string }[]).map(c => c.name)
if (!orderColumns.includes('discount_code')) {
  db.exec('ALTER TABLE orders ADD COLUMN discount_code TEXT')
}
if (!orderColumns.includes('discount_amount')) {
  db.exec('ALTER TABLE orders ADD COLUMN discount_amount REAL NOT NULL DEFAULT 0')
}
if (!orderColumns.includes('customer_governorate')) {
  db.exec("ALTER TABLE orders ADD COLUMN customer_governorate TEXT NOT NULL DEFAULT ''")
}
if (!orderColumns.includes('rider_id')) {
  db.exec('ALTER TABLE orders ADD COLUMN rider_id TEXT REFERENCES riders(id)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_orders_rider ON orders(rider_id)')
}
if (!orderColumns.includes('settlement_id')) {
  db.exec('ALTER TABLE orders ADD COLUMN settlement_id INTEGER REFERENCES settlements(id)')
}

const settingsColumns = (db.prepare("PRAGMA table_info(store_settings)").all() as { name: string }[]).map(c => c.name)
if (!settingsColumns.includes('show_todays_offers')) {
  db.exec('ALTER TABLE store_settings ADD COLUMN show_todays_offers INTEGER NOT NULL DEFAULT 1')
}
if (!settingsColumns.includes('show_best_sellers')) {
  db.exec('ALTER TABLE store_settings ADD COLUMN show_best_sellers INTEGER NOT NULL DEFAULT 1')
}
if (!settingsColumns.includes('cod_enabled')) {
  db.exec('ALTER TABLE store_settings ADD COLUMN cod_enabled INTEGER NOT NULL DEFAULT 1')
}

const categoryCount = (db.prepare('SELECT COUNT(*) as n FROM categories').get() as { n: number }).n
if (categoryCount === 0) {
  const insertCategory = db.prepare('INSERT INTO categories (id, name, emoji, tint, sort_order) VALUES (?, ?, ?, ?, ?)')
  const insertProduct = db.prepare(`
    INSERT INTO products (id, slug, category_id, name, description, price, old_price, cost, unit, emoji, available, bestseller, offer, order_count, stock, alert_threshold, barcode, brand)
    VALUES (@id, @slug, @categoryId, @name, @description, @price, @oldPrice, @cost, @unit, @emoji, @available, @bestseller, @offer, @orderCount, @stock, @alertThreshold, @barcode, @brand)
  `)
  const seed = db.transaction(() => {
    for (const c of SEED_CATEGORIES) insertCategory.run(c.id, c.name, c.emoji, c.tint, c.sortOrder)
    for (const p of SEED_PRODUCTS) {
      insertProduct.run({
        ...p,
        available: p.available ? 1 : 0,
        bestseller: p.bestseller ? 1 : 0,
        offer: p.offer ? 1 : 0
      })
    }
  })
  seed()
}

const bannerCount = (db.prepare('SELECT COUNT(*) as n FROM banners').get() as { n: number }).n
if (bannerCount === 0) {
  db.prepare(`
    INSERT INTO banners (kicker, title, note, emoji, cta_label, link, active, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, 1, 0)
  `).run('🔥 عرض الأسبوع', 'خصم 20% على الألبان والأجبان', 'صالح حتى نهاية الأسبوع', '🧀', 'تسوق العرض', '/category/dairy')
}

const settingsCount = (db.prepare('SELECT COUNT(*) as n FROM store_settings').get() as { n: number }).n
if (settingsCount === 0) {
  db.prepare(`
    INSERT INTO store_settings (id, name, whatsapp_number, currency, minimum_order, free_shipping_threshold, delivery_fee)
    VALUES (1, ?, ?, ?, ?, ?, ?)
  `).run('علاء الدين', '201XXXXXXXXX', 'ج.م', 100, 500, 30)
}
