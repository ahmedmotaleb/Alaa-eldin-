-- شطب المخزون بيحتاج سببين إضافيين ("منتهي الصلاحية" و"مرتجع لمورد") فوق الأنواع الموجودة
-- (damage/loss/adjustment بالفعل بتغطي تالف/فقد/تسوية يدوية). وبيحتاج نعرف مين اللي عمل
-- الحركة (كان مش متسجّل قبل كده خالص).
ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_type_check;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_type_check
  CHECK (type IN ('restock', 'return', 'damage', 'loss', 'adjustment', 'sale', 'cancel_restore', 'expired', 'supplier_return'));
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS created_by_user_id TEXT REFERENCES users(id);

-- سجل ربط بين حركة مخزون واحدة (بيع أو شطب) والدفعات اللي اتاخد منها فعلياً (FEFO) — ده
-- اللي بيخلّي إلغاء طلب يقدر يرجّع الكمية بالظبط لنفس الدفعات اللي اتاخدت منها، بدل ما
-- إجمالي الدفعات ينحرف عن products.stock بمرور الوقت (راجع مرحلة "فحص المخزون" لاحقاً).
CREATE TABLE IF NOT EXISTS batch_consumptions (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  stock_movement_id INTEGER NOT NULL REFERENCES stock_movements(id) ON DELETE CASCADE,
  batch_id TEXT NOT NULL REFERENCES inventory_batches(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0)
);
CREATE INDEX IF NOT EXISTS idx_batch_consumptions_movement ON batch_consumptions(stock_movement_id);
CREATE INDEX IF NOT EXISTS idx_batch_consumptions_batch ON batch_consumptions(batch_id);
