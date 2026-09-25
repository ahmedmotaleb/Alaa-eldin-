# WhatsApp — Webhook تأكيد التسليم/القراءة الحقيقي

هذا الملف بيوضّح إزاي تفعّل webhook حقيقي من Meta يدّي تأكيد فعلي إن رسالة واتساب
(تأكيد الطلب أو أي رسالة تانية) **اتسلّمت فعلياً لجهاز العميل** أو **اتقرت** — مش بس إن
Meta API قبلت طلب الإرسال (وده الفرق اللي موضّح في كل مكان تاني في المشروع: "acceptance
≠ delivery").

## الحالة الحالية

❌ **NOT CONFIGURED** — `WHATSAPP_WEBHOOK_VERIFY_TOKEN` و`WHATSAPP_APP_SECRET` غير
موجودين ضمن متغيرات بيئة الإنتاج وقت كتابة هذا الملف. الكود جاهز بالكامل ومنشور
(`GET`/`POST /api/webhooks/whatsapp`)، لكن لازم تضبط المتغيرين دول + رابط الـ webhook في
Meta for Developers قبل ما تبدأ تستقبل أي حدث حقيقي.

## إيه اللي بيحصل لما يتفعّل

- `GET /api/webhooks/whatsapp` — مصافحة التحقق لمرة واحدة اللي Meta بتعملها وقت ما تضبط
  رابط الـ webhook في لوحة تحكم Meta.
- `POST /api/webhooks/whatsapp` — كل حدث حالة (`sent`/`delivered`/`read`/`failed`) لأي
  رسالة اتبعتت من السيرفر (تأكيد طلب تلقائي أو إعادة إرسال يدوية من الأدمن) بيتسجّل في
  جدول append-only (`whatsapp_message_status_events`)، وبعدين `whatsapp_messages.delivery_status`
  بيتحدّث بأحدث حالة فعلية — ده اللي بتشوفه في درج الطلب بلوحة التحكم.

## خطوات التفعيل

1. **ولّد قيمتين سريتين محليتين** (مش لازم أي حساب خارجي):
   - `WHATSAPP_WEBHOOK_VERIFY_TOKEN`: أي نص عشوائي طويل (مثال: `openssl rand -hex 32`).
   - استخدم **App Secret** الحقيقي بتاع تطبيق Meta for Developers المرتبط بحساب واتساب
     Business (`WHATSAPP_APP_SECRET`) — موجود في إعدادات التطبيق نفسه، مش قيمة تتولّد.
2. أضف المتغيرين لخدمة الويب على Railway، وأعد النشر.
3. في Meta for Developers → منتج WhatsApp → Configuration → Webhooks:
   - Callback URL: `https://<رابط الإنتاج الفعلي>/api/webhooks/whatsapp`
   - Verify Token: نفس قيمة `WHATSAPP_WEBHOOK_VERIFY_TOKEN` اللي ضبطتها فوق.
   - اشترك في حقل `messages` (ده اللي بيحمل أحداث `statuses`).
4. تأكد إن لوج الإقلاع بعد إعادة النشر بيعرض `whatsapp_delivery_webhook` جوه `configured`
   (راجع `startup_config_summary`).
5. افحص فعلياً: ابعت رسالة اختبار حقيقية (راجع `server/docs/` لضوابط رقم الاختبار)، وتأكد
   إن `delivery_status` بيتحدّث في درج الطلب بعد شوية (وصول/قراءة فعلية على الهاتف).

## ملاحظات أمان

- كل طلب `POST` بيتفحص توقيعه (`X-Hub-Signature-256`، HMAC-SHA256 بمفتاح `WHATSAPP_APP_SECRET`
  على البايتات الخام للجسم) قبل أي معالجة — أي طلب بتوقيع غلط أو من غير توقيع خالص بيترفض
  بـ 401 فوراً.
- لو المتغيرين ناقصين، المسار كله بيرجع 404 بدل أي سلوك جزئي — مفيش خطر قبول حدث بدون
  تحقق توقيع فعلي.
- الجدول (`whatsapp_message_status_events`) محمي من إعادة تسليم Meta لنفس الحدث (Meta
  بتوعد بس بـ at-least-once delivery) بقيد فريد على (رسالة، حالة، وقت الحدث).
