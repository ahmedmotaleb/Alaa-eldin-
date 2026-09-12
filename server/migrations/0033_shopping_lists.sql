-- قوائم تسوق مسمّاة يقدر العميل يحفظ فيها منتجات بكمياتها لاستخدامها تاني بسهولة (زي "قائمة
-- الأسبوع") — منفصلة تماماً عن السلة الفعلية وعن المفضلة (اللي من غير كميات ومن غير تسمية).
CREATE TABLE IF NOT EXISTS shopping_lists (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shopping_lists_user ON shopping_lists(user_id);

CREATE TABLE IF NOT EXISTS shopping_list_items (
  id TEXT PRIMARY KEY,
  list_id TEXT NOT NULL REFERENCES shopping_lists(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (list_id, product_id)
);
