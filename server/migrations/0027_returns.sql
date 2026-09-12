-- مرتجعات الموردين — المخزون بينقص فقط عند "approved" (لحظة تأكيد قرار الإرجاع)، مش وقت
-- "draft" (لسه مسودة قابلة للتعديل/الحذف). لو الإرجاع اتلغى بعد ما اتوافق عليه، الكمية
-- بترجع تاني (راجع supplierReturnService.ts) — عشان كده كل بند محتاج يعرف حركة المخزون
-- اللي هو سببها (stock_movement_id) عشان يقدر يعكسها بالظبط وقت الإلغاء.
CREATE SEQUENCE IF NOT EXISTS supplier_return_number_seq START 100001;

CREATE TABLE IF NOT EXISTS supplier_returns (
  id TEXT PRIMARY KEY,
  return_number TEXT NOT NULL UNIQUE,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id),
  purchase_order_id TEXT REFERENCES purchase_orders(id),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'approved', 'sent', 'completed', 'cancelled')),
  reason TEXT NOT NULL DEFAULT '',
  created_by_user_id TEXT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_supplier_returns_supplier ON supplier_returns(supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_returns_status ON supplier_returns(status);

CREATE TABLE IF NOT EXISTS supplier_return_items (
  id TEXT PRIMARY KEY,
  supplier_return_id TEXT NOT NULL REFERENCES supplier_returns(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id),
  batch_id TEXT REFERENCES inventory_batches(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
  stock_movement_id INTEGER REFERENCES stock_movements(id)
);
CREATE INDEX IF NOT EXISTS idx_supplier_return_items_return ON supplier_return_items(supplier_return_id);

-- مرتجعات العملاء — الاسترداد المالي هنا سجل/حالة فقط (بيئة الدفع عند الاستلام يعني
-- الاسترداد الفعلي بيحصل يدوياً خارج النظام)، النظام أبداً ما بيحرّك فلوس لوحده. المخزون
-- بيرجع بس لو condition = 'return_to_stock' ولحظة "تم الاستلام فعلياً" (received) —
-- مش لحظة الطلب (requested)، عشان محدش يقدر "يطلب" مرتجع ويزوّد المخزون من غير ما يرجّع حاجة فعلياً.
CREATE SEQUENCE IF NOT EXISTS customer_return_number_seq START 100001;

CREATE TABLE IF NOT EXISTS customer_returns (
  id TEXT PRIMARY KEY,
  return_number TEXT NOT NULL UNIQUE,
  order_id TEXT NOT NULL REFERENCES orders(id),
  customer_id TEXT REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested', 'approved', 'received', 'refunded', 'rejected', 'cancelled')),
  reason TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  refund_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_by_user_id TEXT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_customer_returns_order ON customer_returns(order_id);
CREATE INDEX IF NOT EXISTS idx_customer_returns_status ON customer_returns(status);

-- "restock_decision" في المواصفة الأصلية كان حقل عام على مستوى الإرجاع كله، لكن قرار
-- إعادة التخزين فعلياً بيختلف من صنف للتاني في نفس الإرجاع (منتج سليم يرجع للمخزون،
-- ومنتج تاني في نفس الطلب يبقى تالف) — فاتنقل هنا لمستوى الصنف (condition) بدل عمود
-- عام كان ممكن يبقى مضلل لإرجاع مختلط.
CREATE TABLE IF NOT EXISTS customer_return_items (
  id TEXT PRIMARY KEY,
  customer_return_id TEXT NOT NULL REFERENCES customer_returns(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id),
  order_item_id INTEGER NOT NULL REFERENCES order_items(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  condition TEXT NOT NULL DEFAULT 'return_to_stock'
    CHECK (condition IN ('return_to_stock', 'damaged', 'expired', 'discard')),
  refund_amount NUMERIC(12,2) NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_customer_return_items_return ON customer_return_items(customer_return_id);
CREATE INDEX IF NOT EXISTS idx_customer_return_items_order_item ON customer_return_items(order_item_id);
