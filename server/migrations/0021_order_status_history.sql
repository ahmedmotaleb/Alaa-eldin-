-- سجل تاريخ حالات الطلب — صف واحد لكل انتقال حالة فعلي (مش لكل تحديث حتى لو نفس الحالة).
-- from_status بيتسجّل NULL لصف "إنشاء الطلب" الأول (مفيش حالة سابقة له أصلاً).
CREATE TABLE IF NOT EXISTS order_status_history (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  changed_by_user_id TEXT REFERENCES users(id),
  source TEXT NOT NULL DEFAULT 'admin' CHECK (source IN ('admin', 'system', 'customer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_status_history_order ON order_status_history(order_id, created_at);
