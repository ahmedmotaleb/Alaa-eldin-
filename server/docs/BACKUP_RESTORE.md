# النسخ الاحتياطي واستعادة قاعدة البيانات

قاعدة البيانات الوحيدة في المشروع هي PostgreSQL على Railway (نفس القاعدة لكل من السيرفر
والمتجر ولوحة التحكم — لا يوجد قاعدة بيانات ثانية). لا تعتمد فقط على النسخ الاحتياطي
التلقائي من Railway — نفّذ نسخة يدوية إضافية دورياً (أو قبل أي عملية خطرة زي migration
كبيرة) بالخطوات دي.

## 1. نسخ احتياطي يدوي (pg_dump)

```bash
# من جهازك، بمتغير DATABASE_URL بتاع بيئة الإنتاج (من Railway → Variables)
pg_dump "$DATABASE_URL" -Fc -f backup_$(date +%Y%m%d_%H%M%S).dump
```

- الصيغة `-Fc` (custom format) مضغوطة وتسمح باستعادة انتقائية (جدول واحد بس مثلاً) عكس
  ملف `.sql` نصي عادي.
- خزّن الملف الناتج في مكان بره Railway نفسه (تخزين سحابي، أو جهازك) — نسخة احتياطية
  متخزنة على نفس البنية التحتية للإنتاج مش نسخة احتياطية حقيقية.

## 2. الاستعادة (pg_restore)

```bash
# على قاعدة بيانات فاضية جديدة (لا تستعيد فوق قاعدة شغالة بدون تأكد إنك عايز كده)
createdb -h <host> -U <user> alaa_eldin_restored
pg_restore -h <host> -U <user> -d alaa_eldin_restored backup_XXXXXXXX.dump
```

بعد الاستعادة، تأكد من التطابق قبل التبديل الفعلي لـ `DATABASE_URL`:

```sql
SELECT (SELECT count(*) FROM users) AS users,
       (SELECT count(*) FROM products) AS products,
       (SELECT count(*) FROM orders) AS orders;
```

قارن الأرقام بقاعدة الإنتاج الأصلية (أو بالعدد المتوقع وقت أخذ النسخة).

## 3. جدول تتبع الترحيلات (migrations)

جدول `schema_migrations` بيتسجل فيه كل ملف ترحيل اتنفذ فعلاً (اسم الملف + وقت التنفيذ).
بعد أي استعادة، تأكد إن آخر صف فيه بيطابق آخر ملف في `server/migrations/` — لو الاستعادة
من نسخة أقدم من آخر ترحيل، شغّل `npm run db:migrate` (production) أو
`npm run db:migrate:dev` (تطوير) عشان تكمّل الترحيلات الناقصة قبل تشغيل السيرفر ضدها
(السيرفر أصلاً بيرفض يقلع لو فيه ترحيلات ناقصة — `assertMigrationsUpToDate` في
`src/index.ts`).

## 4. تجربة استعادة فعلية (restore drill) — نُفذت وتم التحقق منها

كجزء من هذه الدفعة (Batch L14)، اتنفذت تجربة استعادة حقيقية على قاعدة التطوير المحلية:

```bash
pg_dump -h localhost -U postgres -d alaa_eldin -Fc -f drill.dump
createdb -h localhost -U postgres alaa_eldin_restore_drill
pg_restore -h localhost -U postgres -d alaa_eldin_restore_drill drill.dump
```

النتيجة: أعداد الصفوف (`users`, `products`, `orders`) طابقت الأصل تماماً بعد الاستعادة،
والقاعدة المستعادة اتحذفت بعد التأكد (كانت لمرة واحدة للتحقق فقط، مش بيئة دائمة).

## 5. نسخ احتياطي تلقائي من Railway

Railway بيوفر نسخ احتياطي دوري لخدمات Postgres المُدارة على الخطط المدفوعة (Volume/DB
snapshots) — راجع إعدادات خدمة Postgres في لوحة Railway نفسها (Settings → Backups) لتفعيل
الجدولة وتحديد مدة الاحتفاظ. الخطوات اليدوية فوق دي إضافة (defense in depth)، مش بديل عن
تفعيل النسخ الاحتياطي المدمج من Railway.
