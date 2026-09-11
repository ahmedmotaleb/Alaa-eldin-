-- ترقيم أوامر الشراء بصيغة PO-100001 — sequence حقيقي في قاعدة البيانات (مش رقم مُولّد في
-- الواجهة) عشان يفضل فريد حتى مع طلبات متزامنة من أكتر من مستخدم.
CREATE SEQUENCE IF NOT EXISTS purchase_order_number_seq START 100001;

CREATE TABLE IF NOT EXISTS purchase_orders (
  id TEXT PRIMARY KEY,
  po_number TEXT NOT NULL UNIQUE,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'submitted', 'partially_received', 'received', 'cancelled')),
  expected_date DATE,
  notes TEXT NOT NULL DEFAULT '',
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount NUMERIC(12,2) NOT NULL DEFAULT 0,
  shipping_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_by_user_id TEXT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier ON purchase_orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_status ON purchase_orders(status);

-- ordered_qty/unit_cost بيتبعتوا من الأدمن، لكن السيرفر هو اللي بيحسب line_total والإجماليات
-- في أمر الشراء — مفيش أي إجمالي متبعت من الواجهة بيتصدّق زي ما هو (نفس مبدأ الطلبات العادية).
-- received_qty بيتحدّث بس من مسار استلام البضاعة (المرحلة الجاية) — يبدأ صفر دايماً هنا.
CREATE TABLE IF NOT EXISTS purchase_order_items (
  id TEXT PRIMARY KEY,
  purchase_order_id TEXT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id),
  ordered_qty INTEGER NOT NULL CHECK (ordered_qty > 0),
  received_qty INTEGER NOT NULL DEFAULT 0 CHECK (received_qty >= 0),
  unit_cost NUMERIC(12,2) NOT NULL CHECK (unit_cost >= 0),
  line_total NUMERIC(12,2) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_purchase_order_items_po ON purchase_order_items(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_purchase_order_items_product ON purchase_order_items(product_id);
