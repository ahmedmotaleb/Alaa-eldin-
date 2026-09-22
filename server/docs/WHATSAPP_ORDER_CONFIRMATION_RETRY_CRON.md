# جدولة معالج إعادة محاولة تأكيد الطلب عبر واتساب (Railway Cron)

هذا الملف توثيق وتوصية فقط — **مفيش جدولة (Railway Cron Job أو غيرها) اتضافت أو
اتفعّلت تلقائياً كجزء من هذا التغيير**. أمر `npm run whatsapp:retry-confirmations`
موجود وجاهز، لكنه مجرد سكريبت يدوي حتى يتم ربطه فعلياً بجدولة خارجية بمعرفة صاحب
المشروع.

## لماذا مفيش scheduler جوه التطبيق نفسه

نفس مبدأ `loyalty:expire` و`notify:abandoned-cart` بالظبط — راجع
[`LOYALTY_EXPIRY_CRON.md`](./LOYALTY_EXPIRY_CRON.md) لشرح كامل للمبدأ ده.

## إعداد Railway Cron Job (خطوات يدوية)

1. من لوحة تحكم Railway → المشروع → أضف خدمة جديدة من نوع "Cron Job" (منفصلة عن خدمة
   الويب الأساسية، بس بتشارك نفس الـ repo/environment variables زي `DATABASE_URL`
   ومتغيرات واتساب `WHATSAPP_ACCESS_TOKEN`/`WHATSAPP_PHONE_NUMBER_ID`/
   `WHATSAPP_ORDER_CONFIRMATION_TEMPLATE`).
2. Build command: نفس أمر بناء السيرفر الحالي (`npm install && npm run build --prefix server`).
3. Start command: `npm run whatsapp:retry-confirmations --prefix server`
4. **الجدولة**: التوصية **مرة كل 15-30 دقيقة**. الفشل المؤقت (شبكة/429/5xx من Meta)
   نادر عملياً، فمفيش داعي لتشغيل كل دقيقة؛ في نفس الوقت العميل ما ينفعش ينتظر ساعات
   لتأكيد طلبه لو حصل عطل مؤقت في المزوّد وقت إنشاء الطلب. مثال: `*/15 * * * *`.
5. `WHATSAPP_RETRY_BATCH_SIZE` (اختياري، افتراضي 20) — أقصى عدد إشعارات فاشلة تتعالج
   في تشغيلة واحدة، عشان تشغيلة واحدة ما تاخدش وقت طويل لو فيه عدد كبير من الفشل دفعة
   واحدة (مثال: انقطاع مؤقت طويل في اتصال Meta نفسه).

## أي فشل قابل لإعادة المحاولة تحديداً (ومش أي فشل)

السكريبت ده بيعيد محاولة الإشعارات الفاشلة القابلة لإعادة المحاولة فقط —
`whatsapp_notification_deliveries.status = 'failed'` مع `last_error` مش بادئ بـ
`permanent:` (خطأ إعدادي زي توكن غلط أو قالب غير معتمد أصلاً — إعادة المحاولة مش
هتحله) ومع `attempt_count` لسه أقل من `MAX_AUTOMATIC_ATTEMPTS` (5 — راجع
`whatsappNotificationDeliveryService.ts`). لو الإشعار وصل لأقصى عدد محاولات، بيفضل
`failed` نهائياً وبيحتاج تدخّل يدوي من الأدمن (زر "إعادة الإرسال" في لوحة التحكم، اللي
بيتخطى نظام الملكية دي بالكامل عمداً — راجع تعليق `sendOrderConfirmationWhatsApp`).

## الأمان تحت التداخل والتزامن (Overlapping Runs / Multi-Instance)

كل عنصر في الدفعة بيمر على **نفس** مسار `claimAutomaticNotification` الذرّي اللي
بيستخدمه أول محاولة إرسال تلقائي بالظبط — مفيش أي منطق منفصل أو "مختصر" هنا. يعني:

- تشغيلة يدوية فوق تشغيلة Railway cron جارية، أو تشغيلتين cron متداخلتين (تأخير في
  تشغيلة سابقة)، آمنتين تماماً من غير أي تنسيق إضافي في كود السكريبت نفسه — الضمان
  كله جوه PostgreSQL (`UPDATE ... WHERE status='failed' AND attempt_count < ...`
  ذرّية، راجع `whatsappNotificationDeliveryService.ts`).
- لو عملية تانية (مثلاً نسخة سيرفر Railway تانية بتعالج نفس الطلب من مسار مختلف)
  ادّعت الملكية في نفس اللحظة، الطرف الخاسر بيرجع `active_owner` من غير أي إرسال Meta
  فعلي مكرر.

## التحقق من إن المعالج شغّال صح فعلاً

السكريبت بيطبع سطر واحد واضح زي:
```
whatsapp order-confirmation retry: attempted 3, sent 2, still failed 1
```

## الحالة الحالية

- **الكود جاهز (CODE READY)**: السكريبت مبني، بيطلع exit code صفر عند النجاح وواحد
  عند الفشل، بدون أي unhandled promise rejection.
- **Railway Cron: غير مُفعّل (NOT CONFIGURED)** — نفس التحقق اللي تم في
  `LOYALTY_EXPIRY_CRON.md`/`ABANDONED_CART_CRON.md`: قائمة خدمات مشروع Railway
  الفعلية بها خدمتين بس (قاعدة البيانات وخدمة الويب الأساسية)، **لا توجد أي خدمة من
  نوع Cron Job**. أي ادعاء بأن إعادة المحاولة التلقائية "شغّالة فعلياً في الإنتاج"
  غير صحيح حالياً حتى يتم إعداد الخدمة دي فعلياً من صاحب المشروع.
