-- تذاكر دعم العملاء — الترقيم البشري بنفس نمط الطلبات/أوامر الشراء بالظبط (sequence حقيقي،
-- مش رقم متولّد في الواجهة). كل الجداول جديدة تماماً (إضافية) — مفيش أي تعديل على جداول
-- موجودة قبل كده.
CREATE SEQUENCE IF NOT EXISTS support_ticket_number_seq START 100001;

CREATE TABLE IF NOT EXISTS support_tickets (
  id TEXT PRIMARY KEY,
  ticket_number TEXT NOT NULL UNIQUE,
  customer_id TEXT NOT NULL REFERENCES users(id),
  -- مفاتيح داخلية ثابتة (مش عربي) — الترجمة العربية للعرض بس على الواجهة، عشان أي تغيير
  -- مستقبلي في نص التسمية ما يكسرش بيانات مخزّنة فعلاً.
  category TEXT NOT NULL CHECK (category IN (
    'order_issue', 'missing_item', 'damaged_item', 'wrong_item',
    'delivery_issue', 'refund_request', 'payment_issue', 'account_issue',
    'suggestion', 'other'
  )),
  subject TEXT NOT NULL,
  related_order_id TEXT REFERENCES orders(id),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'in_progress', 'waiting_customer', 'resolved', 'closed')),
  -- الأولوية بيحددها الأدمن بس (مش العميل) — العمود له قيمة افتراضية هنا للراحة، لكن مسار
  -- إنشاء تذكرة العميل ما بيدّيش الفرصة يبعت قيمة تانية غير الافتراضي أصلاً (السيرفر بيتجاهل
  -- أي priority مبعوت من العميل).
  priority TEXT NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  assigned_admin_id TEXT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_support_tickets_customer ON support_tickets(customer_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON support_tickets(status);
CREATE INDEX IF NOT EXISTS idx_support_tickets_assigned ON support_tickets(assigned_admin_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_created_at ON support_tickets(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_tickets_order ON support_tickets(related_order_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_ticket_number_trgm ON support_tickets USING gin (ticket_number gin_trgm_ops);

-- محادثة كل تذكرة — append-only فعلياً (مفيش أي مسار UPDATE/DELETE على الرسالة نفسها في
-- الكود، الجدول بيسمح تقنياً بس التطبيق هو اللي بيضمن السلوك ده). internal_note بيحدد
-- الرسائل اللي متاحة للأدمن بس ولازم متتفلترش أبداً من أي استجابة لواجهة العميل.
CREATE TABLE IF NOT EXISTS support_ticket_messages (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  sender_type TEXT NOT NULL CHECK (sender_type IN ('customer', 'admin')),
  sender_user_id TEXT NOT NULL REFERENCES users(id),
  message TEXT NOT NULL,
  internal_note INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_support_ticket_messages_ticket ON support_ticket_messages(ticket_id, created_at);

CREATE TABLE IF NOT EXISTS support_ticket_attachments (
  id TEXT PRIMARY KEY,
  message_id INTEGER NOT NULL REFERENCES support_ticket_messages(id) ON DELETE CASCADE,
  file_url TEXT NOT NULL,
  storage_key TEXT NOT NULL DEFAULT '',
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_support_ticket_attachments_message ON support_ticket_attachments(message_id);

-- صلاحيات الدعم — 'المدير' بياخد الأربعة كاملين، 'مدير الطلبات' مؤهل للرد والتعيين (التذاكر
-- مرتبطة بالطلبات غالباً) لكن مش صلاحية الإدارة الكاملة (زي حذف/تعديل إعدادات الدعم لاحقاً).
-- role-rider ومفيش أي عميل بيتاخد أي صلاحية دعم خالص عمداً.
INSERT INTO role_permissions (role_id, permission)
SELECT 'role-manager', p FROM unnest(ARRAY[
  'support.view', 'support.reply', 'support.assign', 'support.manage'
]) AS p
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission)
SELECT 'role-orders-manager', p FROM unnest(ARRAY[
  'support.view', 'support.reply', 'support.assign'
]) AS p
ON CONFLICT DO NOTHING;
