-- Baseline schema. Uses IF NOT EXISTS everywhere because this migration is being
-- introduced onto a database that was previously created by ad hoc CREATE-TABLE-IF-NOT-EXISTS
-- logic that used to run on every application boot (see db.ts history). Running this as
-- migration 0001 is therefore a safe no-op against that already-existing production schema,
-- while establishing a real, tracked baseline for every migration that follows.

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

CREATE TABLE IF NOT EXISTS password_resets (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(user_id);

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

-- ترقية مؤجلة من قبل هذا النظام: كانت النسخة الأصلية من عمود orders.user_id تفرض NOT NULL
-- (حساب مسجّل إلزامي). صارت nullable لدعم طلبات الزوّار بدون تسجيل دخول. آمن التنفيذ
-- حتى لو كان العمود nullable بالفعل (DROP NOT NULL على عمود nullable هي no-op في Postgres).
ALTER TABLE orders ALTER COLUMN user_id DROP NOT NULL;
