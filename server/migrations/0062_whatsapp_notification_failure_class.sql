-- تصنيف صريح لسبب فشل إشعار واتساب التلقائي — منفصل عن last_error (تشخيص قابل للقراءة
-- البشرية فقط، مش مصدر قرار). قبل التغيير ده، سياسة إعادة المحاولة كانت بتعتمد على تحليل
-- بادئة نص last_error ('permanent:'/'unknown:') داخل listRetryableFailedNotifications فقط —
-- ده كان بيسمح لأي صف 'failed' (بما فيه نتائج 'unknown' الغامضة) إنه يترشح لإعادة محاولة
-- ذرّية عبر tryFailedRetryClaim من غير ما الـ UPDATE الذرّي نفسه يتحقق من نوع الفشل، وده خطر
-- حقيقي: نتيجة 'unknown' معناها إننا مش متأكدين إن Meta استلمت الطلب الأصلي أصلاً ولا لأ —
-- إعادة محاولة تلقائية عليها ممكن تنتج رسالة تأكيد مكررة فعلياً للعميل.
--
-- القيمة دلوقتي عمود مستقل ومُتحقق منه (CHECK)، ولازم تتفحص جوه شرط WHERE الخاص بـ
-- UPDATE الادّعاء الذرّي نفسه (tryFailedRetryClaim) — مش بس في استعلام المرشّحين للسكربت
-- الدوري — عشان قاعدة "لا إعادة محاولة تلقائية لنتيجة غير مؤكدة" تتفرض من طبقة الملكية نفسها،
-- مش من فلترة السكربت فقط.
ALTER TABLE whatsapp_notification_deliveries
  ADD COLUMN IF NOT EXISTS failure_class TEXT NULL
  CHECK (failure_class IS NULL OR failure_class IN ('retryable', 'permanent', 'unknown'));

-- تعبئة رجعية آمنة للصفوف الفاشلة الموجودة بالفعل (لو وُجدت) بناءً على بادئة last_error
-- القديمة — إنتاج فقط، إضافي بالكامل، ومفيش أي صف 'sent' بيتأثر. صف فاشل من غير بادئة
-- معروفة (خطأ مزوّد عادي قابل لإعادة المحاولة، الحالة الافتراضية القديمة) بيتصنّف 'retryable'
-- صراحة — تحفظاً، الأفضلية دايماً لعدم فقدان فرصة إعادة محاولة مشروعة على صف قديم كان
-- بالفعل بيُعاد محاولته بأمان قبل التغيير ده.
UPDATE whatsapp_notification_deliveries
SET failure_class = 'permanent'
WHERE status = 'failed' AND failure_class IS NULL AND last_error LIKE 'permanent:%';

UPDATE whatsapp_notification_deliveries
SET failure_class = 'unknown'
WHERE status = 'failed' AND failure_class IS NULL AND last_error LIKE 'unknown:%';

UPDATE whatsapp_notification_deliveries
SET failure_class = 'retryable'
WHERE status = 'failed' AND failure_class IS NULL;

CREATE INDEX IF NOT EXISTS idx_whatsapp_notification_deliveries_retryable
  ON whatsapp_notification_deliveries(status, failure_class, attempt_count) WHERE status = 'failed';
