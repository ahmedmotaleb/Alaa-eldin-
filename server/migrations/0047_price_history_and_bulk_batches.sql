-- سجل تحركات العمليات الجماعية (Bulk Price Update وأي عملية جماعية مستقبلية مماثلة) —
-- سجل واحد لكل عملية تأكيد (لا لكل ملف مرفوع، فقط لحظة التأكيد الفعلي)، يسمح لاحقاً بفتح
-- تفاصيل العملية أو التراجع عنها بأمان.
CREATE TABLE IF NOT EXISTS bulk_operation_batches (
  id TEXT PRIMARY KEY,
  operation_type TEXT NOT NULL CHECK (operation_type IN ('bulk_price_csv', 'bulk_price_adjustment')),
  created_by TEXT REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'rolled_back', 'partially_rolled_back')),
  total_rows INTEGER NOT NULL DEFAULT 0,
  successful_rows INTEGER NOT NULL DEFAULT 0,
  failed_rows INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

-- سجل تاريخ سعر البيع (منفصل تماماً عن product_cost_history الموجود بالفعل للتكلفة) —
-- نفس مبدأ الـ ledger غير القابل للتعديل: أي تغيير سعر بيكوّن صف جديد دايماً، والتراجع نفسه
-- (rollback) بيسجّل كصف جديد بمصدر 'rollback'، مش حذف/تعديل للصف الأصلي.
CREATE TABLE IF NOT EXISTS product_price_history (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_id TEXT REFERENCES product_variants(id) ON DELETE SET NULL,
  old_price NUMERIC(12,2) NOT NULL,
  new_price NUMERIC(12,2) NOT NULL,
  old_old_price NUMERIC(12,2),
  new_old_price NUMERIC(12,2),
  source TEXT NOT NULL CHECK (source IN ('manual_edit', 'bulk_csv', 'bulk_adjustment', 'rollback')),
  admin_user_id TEXT REFERENCES users(id),
  bulk_batch_id TEXT REFERENCES bulk_operation_batches(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_product_price_history_product ON product_price_history(product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_product_price_history_batch ON product_price_history(bulk_batch_id);

-- نفس مبدأ ربط دفعة العملية على تكلفة المنتج (لدعم التراجع الآمن لتغييرات التكلفة بالجملة
-- كمان، مش السعر بس) — old_cost إضافي عشان التراجع يعرف يرجع لأنهي قيمة بالظبط، بدل ما
-- يحتاج يفتّش عن الصف السابق في السجل كل مرة.
ALTER TABLE product_cost_history ADD COLUMN IF NOT EXISTS old_cost NUMERIC(12,2);
ALTER TABLE product_cost_history ADD COLUMN IF NOT EXISTS bulk_batch_id TEXT REFERENCES bulk_operation_batches(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_product_cost_history_batch ON product_cost_history(bulk_batch_id);
