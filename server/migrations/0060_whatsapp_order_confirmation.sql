-- تمييز نوع كل رسالة واتساب مُرسلة تلقائياً (مثال: 'order_confirmation') — يسمح بمعرفة هل
-- تم إرسال تأكيد تلقائي لطلب معيّن من قبل من غير الاعتماد على قراءة المحتوى. الإرسال اليدوي
-- من الأدمن (عبر /admin/whatsapp/orders/:id/send الموجودة بالفعل) يفضل notification_type له
-- NULL زي ما كان الحال دايماً — مفيش أي قيد فريد هنا يمنع أي إرسال يدوي مستقبلي، القيد
-- ده مجرد عمود تصنيف إضافي.
ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS notification_type TEXT;
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_order_notification ON whatsapp_messages(order_id, notification_type);

-- ترقية محتوى قالب "تأكيد الطلب" الافتراضي (المُنشأ في migration 0030) ليشمل التفاصيل
-- الكاملة (الإجمالي، طريقة الدفع، موعد التوصيل، العنوان، رابط التتبع) بدل النص المختصر
-- الأصلي — بس لو لسه بمحتواه الأصلي غير المعدّل، عشان أي تعديل يدوي سابق من الأدمن على
-- هذا القالب بالذات يفضل زي ما هو (نفس مبدأ عدم الكتابة فوق تعديل يدوي المُتّبع في نظام
-- التسعير المجدول — migration 0056).
UPDATE whatsapp_templates
SET content = 'مرحباً {{customerName}} 👋

تم استلام طلبك من علاء الدين بنجاح ✅

رقم الطلب:
{{orderNumber}}

إجمالي الطلب:
{{orderTotal}} ج.م

طريقة الدفع:
{{paymentMethod}}

موعد التوصيل:
{{deliveryDate}}
{{deliverySlot}}

عنوان التوصيل:
{{customerAddress}}

يمكنك متابعة طلبك من خلال:
{{trackingUrl}}

شكراً لاختيارك علاء الدين 💚',
    updated_at = now()
WHERE id = 'wa-tpl-order-confirmed'
  AND content = 'مرحباً {{customerName}}، تم استلام طلبك رقم {{orderNumber}} وجاري تجهيزه. شكراً لتسوقك من علاء الدين.';
