-- إعداد تتبع الصلاحية على مستوى المنتج — منتجات كتير (خضار غير معبأة، أدوات منزلية) مش
-- محتاجة تتبع صلاحية خالص، فالإعداد ده اختياري تماماً ومطفي افتراضياً.
ALTER TABLE products ADD COLUMN IF NOT EXISTS tracks_expiry INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS default_shelf_life_days INTEGER;

CREATE SEQUENCE IF NOT EXISTS goods_receipt_number_seq START 100001;

-- استلام بضاعة — مرتبط بأمر شراء دايماً في النسخة الحالية (استلام بدون أمر شراء مش مدعوم
-- لسه). كل استلام بيتعامل معاه كمعاملة واحدة ذرّية بالكامل (راجع purchaseReceivingService.ts):
-- قفل أمر الشراء -> التحقق من الكمية المتبقية -> الإيصال وبنوده -> تحديث كميات الاستلام في
-- أمر الشراء -> إنشاء دفعات مخزون -> زيادة المخزون -> تسجيل حركة مخزون -> تسجيل تاريخ التكلفة.
CREATE TABLE IF NOT EXISTS goods_receipts (
  id TEXT PRIMARY KEY,
  receipt_number TEXT NOT NULL UNIQUE,
  purchase_order_id TEXT NOT NULL REFERENCES purchase_orders(id),
  supplier_id TEXT NOT NULL REFERENCES suppliers(id),
  received_by_user_id TEXT REFERENCES users(id),
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_goods_receipts_po ON goods_receipts(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_goods_receipts_supplier ON goods_receipts(supplier_id);

CREATE TABLE IF NOT EXISTS goods_receipt_items (
  id TEXT PRIMARY KEY,
  goods_receipt_id TEXT NOT NULL REFERENCES goods_receipts(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_cost NUMERIC(12,2) NOT NULL CHECK (unit_cost >= 0),
  batch_number TEXT,
  expiry_date DATE,
  manufactured_date DATE
);
CREATE INDEX IF NOT EXISTS idx_goods_receipt_items_receipt ON goods_receipt_items(goods_receipt_id);
CREATE INDEX IF NOT EXISTS idx_goods_receipt_items_product ON goods_receipt_items(product_id);

-- دفعة مخزون — بتتسجّل مع كل استلام (سواء المنتج بيتتبع صلاحية أو لأ؛ expiry_date بيفضل
-- NULL للمنتجات اللي مش متابعة). quantity_remaining بينزل مع كل بيع/تسوية/مرتجع (المراحل
-- الجاية) وبيفضل quantity_received زي ما هو كسجل تاريخي لكمية الاستلام الأصلية.
CREATE TABLE IF NOT EXISTS inventory_batches (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  supplier_id TEXT REFERENCES suppliers(id),
  goods_receipt_item_id TEXT REFERENCES goods_receipt_items(id),
  batch_number TEXT,
  expiry_date DATE,
  manufactured_date DATE,
  quantity_received INTEGER NOT NULL CHECK (quantity_received > 0),
  quantity_remaining INTEGER NOT NULL CHECK (quantity_remaining >= 0),
  unit_cost NUMERIC(12,2) NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_inventory_batches_product ON inventory_batches(product_id);
-- FEFO (أقدم تاريخ صلاحية الأول): بنجيب أقرب دفعة صالحة (فيها كمية متبقية) بأقرب تاريخ
-- انتهاء بسرعة لمنتج معيّن — فهرس جزئي لأن الاستعلام دايماً بيستثني الدفعات الفارغة.
CREATE INDEX IF NOT EXISTS idx_inventory_batches_product_expiry
  ON inventory_batches(product_id, expiry_date) WHERE quantity_remaining > 0;

-- تاريخ تكلفة الشراء — بيتسجّل تلقائياً مع كل استلام بضاعة، وبيتسجّل كمان يدوياً لو حد
-- عدّل تكلفة منتج مباشرة من شاشة المنتج. سجل تاريخي فقط — لا يُحذف ولا يُعدَّل بعد التسجيل.
CREATE TABLE IF NOT EXISTS product_cost_history (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  supplier_id TEXT REFERENCES suppliers(id),
  unit_cost NUMERIC(12,2) NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('purchase_receipt', 'manual_adjustment')),
  source_id TEXT,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_product_cost_history_product ON product_cost_history(product_id, recorded_at DESC);
