# خريطة المكونات والبيانات

## المكونات

- `Layout`: الهيدر (هيدر الرئيسية بالبحث والعنوان، أو هيدر فرعي برجوع وعنوان) + شريط تنقل سفلي بـ ٥ عناصر (الرئيسية، الأقسام، طلباتي، السلة، حسابي).
- `ProductArt`: مربع الإيموجي الملوّن لكل منتج (مع شارة الخصم وتغطية "غير متوفر" عند الحاجة).
- `AddControl`: زر "+" لإضافة المنتج، يتحول تلقائياً إلى عداد كمية (+/-) بعد الإضافة.
- `ProductGridCard` / `ProductGrid`: بطاقة/شبكة المنتجات (تدعم عرض شبكي أو صف أفقي قابل للتمرير).
- `ProductListScreen`: شاشة قائمة منتجات مشتركة (فرز + حالة تحميل هيكلية) تُستخدم في صفحات القسم/العروض/الأكثر مبيعاً.
- `StickyActionBar`: الشريط السفلي الثابت لزر الإجراء الأساسي (أضف للسلة / إتمام الطلب).
- `Section`: عناوين أقسام الرئيسية مع رابط/زر إجراء اختياري.
- `CartContext`: عمليات السلة والحسابات والحفظ المحلي.
- `ToastContext`: رسائل تأكيد سريعة (مثل "تمت الإضافة إلى السلة").
- `AuthContext` (`src/store/AuthContext.tsx`): حالة تسجيل الدخول الحقيقية (`user`/`loading`/`register`/`login`/`logout`) عبر `src/utils/api.ts`، وهو نداء `fetch` مركزي لكل `/api/*` مع كوكي الجلسة.
- `useRequireAuth` (`src/hooks/useRequireAuth.ts`): يحوّل تلقائياً لصفحة `/login` مع حفظ الصفحة الأصلية إذا لم يكن هناك تسجيل دخول. تُستخدم فقط في `/track/:id` الآن — تتبع الطلب يبقى ميزة حصرية للمستخدم المسجّل عمداً، لأنه لا توجد طريقة آمنة تسمح لزائر بإعادة الدخول لمتابعة طلب سابق دون كشف بيانات عملاء آخرين.
- `/checkout` و`/confirmation/:id` يستخدمان `useAuth()` العادي (بدون تحويل قسري) — تسجيل الدخول اختياري فيهما. لو فيه `user`، الطلب يترتبط بحسابه؛ لو لأ، الطلب يتسجّل بدون حساب (زائر). `/confirmation/:id` تقرأ تفاصيل الطلب من `location.state.order` (المُمرَّر من `CheckoutPage` مباشرة بعد الإنشاء عبر `navigate(path, { state: { order } })`) بدل أي `fetch` جديد — فمفيش endpoint عام يكشف تفاصيل طلب أي عميل تاني لمجرد معرفة رقم الطلب. لو حصل تحديث للصفحة (refresh) أو فُتحت لاحقاً بدون `state`: مستخدم مسجّل دخوله يُعاد جلب طلبه عبر `api.getOrder()` (لأنه مصرّح له أصلاً)، أما الزائر فيشوف رسالة توضيحية بدل أي محاولة جلب. زر "تتبع الطلب" لا يظهر في صفحة التأكيد إلا لو فيه `user` مسجّل دخوله، لتفادي تحويل الزائر لصفحة تتطلب تسجيل دخول لا داعي له.
- `CatalogContext` (`src/store/CatalogContext.tsx`): يجلب `categories`/`products`/`settings` مرة واحدة من `/api/categories`، `/api/products`، `/api/settings` عند إقلاع التطبيق (نفس `Promise.all`) ويوزّع `categories`/`products` لكل الصفحات عبر `useCatalog()`، ويخزّن `settings` في `src/store/settingsStore.ts` (singleton بسيط بره React، `getSettings()`/`setSettings()`). `App.tsx` يمنع رسم `<Routes>` (عبر `CatalogGate`) لحد ما يخلص التحميل أو تظهر رسالة خطأ بزر إعادة محاولة — وده اللي بيضمن إن `getSettings()` ترجع قيم حقيقية فعلاً (مش الافتراضية) بحلول أي render لأي صفحة جوه `<Layout />` (كل الصفحات اللي بتستخدم `formatMoney`/`STORE_CONFIG` القديم). `/onboarding` بس هي الصفحة الوحيدة برّه الـ Gate، ومفيهاش أي استخدام لـ `getSettings()`.
  - **ملاحظة تصحيح مهمة**: `CartContext` يحتاج `products` (من `useCatalog()`) داخل `useMemo` الخاص بـ `detailedItems` ضمن مصفوفة الاعتماديات (`[items, products]`)، وليس `[items]` فقط. لو اعتمدت على `items` وحدها، سيناريو عميل عائد لديه سلة محفوظة بالفعل في `localStorage` (فـ`items` غير فارغة من أول render) بينما الكتالوج لسه بيحمّل (`products` لسه `[]`) يخلي النتيجة المحسوبة أول مرة فارغة، وتفضل عالقة كده لحد ما تتغيّر `items` تاني — أي السلة تظهر فاضية دايماً لهذا العميل رغم وجود المنتجات فعلياً.
- `CartContext`: بالإضافة للسلة، يحمل حالة كود الخصم المطبّق (`discount`) ويعيد التحقق منه تلقائياً من السيرفر كل ما تغيّر إجمالي السلة (`subtotal`)، ويلغيه بصمت لو صار غير صالح (تغيّر الحد الأدنى مثلاً).

## الخادم (`server/`)

Express + PostgreSQL (عبر `pg`، بدون ORM) منفصل عن الواجهة. الاتصال عبر `DATABASE_URL` (افتراضياً `postgresql://postgres:postgres@localhost:5432/alaa_eldin`)، `server/src/db.ts` يصدّر `pool` (اتصال pg.Pool) و`withTransaction()` (مساعد `BEGIN`/`COMMIT`/`ROLLBACK` حول عميل واحد من الـ pool). كل الاستعلامات async (`await pool.query(...)`)، placeholders بصيغة `$1, $2, ...`، والحصول على id السطر المُدرَج عبر `INSERT ... RETURNING id`. الجداول: `users`, `sessions`, `password_resets`, `orders`, `order_items`, `categories`, `products`, `discounts`, `stock_movements`, `banners`, `store_settings` (صف واحد ثابت `id=1`)، `riders`, `settlements`, `expenses`, بالإضافة لجدول تتبع الترحيلات `schema_migrations`. أعمدة `is_admin`/`available`/`bestseller`/`offer`/`active`/`show_todays_offers`/`show_best_sellers`/`cod_enabled` تبقى `INTEGER` (0/1) بدل `BOOLEAN` الحقيقي — قرار متعمّد قديم لتقليل التغييرات في كود الـ routes (`!!row.field` عند القراءة، `field ? 1 : 0` عند الكتابة).

**`db.ts` ما بيعملش أي `CREATE TABLE`/`ALTER TABLE` أبداً — ده كان سلوكها قديماً (`initDb()`) واتشال نهائياً.** بدله نظام ترحيل حقيقي:
- `server/migrations/000N_*.sql` — ملفات SQL مرقّمة، كل واحد تغيير واحد على المخطط (`0001_init` الأساس، `0002` تحويل أعمدة الفلوس لـ `NUMERIC(12,2)`، `0003` إضافة نوعي حركة مخزون `sale`/`cancel_restore` + أعمدة `order_id`/`quantity_before`/`quantity_after` على `stock_movements`، `0004` عمودي `order_number`/`idempotency_key` على `orders` + `order_number_seq`، `0005` تحويل التواريخ لـ `TIMESTAMPTZ`/`DATE`، `0006` قيود `CHECK`، `0007` فهارس، `0008` عمود `request_fingerprint`).
- `server/src/migrate.ts` — أداة التشغيل: بتنشئ/تقرأ جدول `schema_migrations` (version/name/applied_at)، وبتطبّق أي ملف لسه مش مسجّل فيه، كل ملف جوه معاملة واحدة. `npm run db:migrate` (أو `db:migrate:dev` بـ `tsx` بدون build).
- `server/src/checkMigrations.ts` — بيتنفذ عند إقلاع السيرفر (`index.ts`)، قراءة بس بدون أي كتابة: بيتأكد إن كل ملفات الترحيل الموجودة على القرص مسجّلة كمُطبَّقة في `schema_migrations`؛ لو فيه نقص، بيرمي استثناء يمنع السيرفر من الإقلاع أصلاً (بدل ما يشتغل على مخطط ناقص بصمت).
- `server/src/seed.ts` — بذر البيانات التجريبية (`SEED_CATEGORIES`/`SEED_PRODUCTS` من `seedData.ts`، بانر افتراضي، `store_settings` افتراضي) — أمر صريح منفصل تماماً (`npm run db:seed`)، **لا يعمل تلقائياً من أي مكان** (لا من إقلاع السيرفر ولا من الترحيلات نفسها)، وآمن التكرار (كل خطوة بتتحقق إن الجدول فاضي الأول).
- `npm run start` (الجذر) بقى فعلياً `npm run db:migrate --prefix server && node server/dist/index.js` — الترحيل بيحصل كخطوة نشر منفصلة وصريحة قبل ما عملية Express نفسها تشتغل، مش جزء من منطق الطلب/الاستجابة العادي.

المسارات:
- `POST /api/auth/{register,login,logout}`, `GET /api/auth/me`
- `POST /api/auth/forgot-password` — عامة، بدون تسجيل دخول. `{email}` → دايماً `204` بغض النظر عن وجود الإيميل (منع user enumeration). لو موجود فعلاً: `createPasswordResetToken()` (`server/src/auth.ts`) يمسح أي رمز سابق للمستخدم ده ويُنشئ رمز جديد (32 بايت عشوائي، صالح ساعة واحدة) في جدول `password_resets`، ثم `sendPasswordResetEmail()` (`server/src/email.ts`) يبعت البريد عبر Resend API (`fetch` مباشر، بدون SDK) — لو `RESEND_API_KEY` مش مضبوط، بيكتفي بطباعة رابط الاستعادة في الـ server logs (fallback للتطوير المحلي، مذكور في README).
- `POST /api/auth/reset-password` — عامة. `{token, password}` → `consumePasswordResetToken()` يتحقق من الرمز وصلاحيته ويحذفه فوراً (استخدام لمرة واحدة)، يحدّث `password_hash`، ويحذف كل صفوف `sessions` الخاصة بالمستخدم (يبطل أي جلسة قديمة بعد تغيير كلمة المرور).
- `GET /api/orders` (ترقيم اختياري `?page&limit`, افتراضياً 1/20، أقصى 100 — يرجع `{orders, pagination}`)، `GET /api/orders/:orderNumber` — تتطلب جلسة صالحة (`requireAuth`) وتتحقق أن الطلب يخص نفس المستخدم؛ البحث بـ `order_number` (الرقم المعروض للعميل، مثال `ALA-100001`) مش `id` الداخلي.
- **`POST /api/orders`** — لا يتطلب تسجيل دخول (طلب الزائر مسموح)، لكن أصبح **راوت رفيع بالكامل**: بيتحقق من الشكل الأساسي فقط عبر `validateCheckoutInput()` (`server/src/checkoutValidation.ts`) وبينادي `orderService.createOrder()` (`server/src/services/orderService.ts`) اللي بيعمل كل المنطق الفعلي جوه معاملة واحدة:
  1. **مفيش أي قيمة فلوس بتتقبل من العميل أصلاً** — شكل الطلب المتوقع بس `{deliverySlot, paymentMethod, customer, items: [{productId, quantity}], discountCode?}`. أي `unitPrice`/`subtotal`/`deliveryFee`/`total` في جسم الطلب الخام بيتجاهل تماماً (مش موجود في النوع أصلاً، فمفيش أي مسار كود يقرأه).
  2. `store_settings` بتتقرأ وقت الطلب (`cod_enabled`, `minimum_order`, `free_shipping_threshold`, `delivery_fee`) — رفض فوري بـ `cod_disabled` لو الدفع عند الاستلام متوقف.
  3. لو فيه `discountCode`: الصف بيتقفل (`SELECT ... FOR UPDATE`) عبر `findDiscountForUpdate()` (`server/src/discounts.ts`) قبل أي حساب — يمنع تجاوز `max_uses` تحت تزامن حقيقي (طلبين في نفس اللحظة).
  4. كل المنتجات المطلوبة بتتقفل مع بعض بترتيب ثابت (بالـ id، `ORDER BY id FOR UPDATE`) عبر `lockProductsForOrder()` (`server/src/services/inventoryService.ts`) — ترتيب ثابت يمنع deadlock بين عمليتي دفع متزامنتين على نفس المنتجات. كل صنف بيتحقق منه (`validateItemAgainstProduct`): موجود، متاح (`available`)، الكمية عدد صحيح موجب ومعقول (`MAX_QUANTITY_PER_ITEM = 999`)، والمخزون كافي — أي فشل يلغي الطلب كله بكود مناسب (`product_not_found`/`product_unavailable`/`invalid_quantity` بـ 400، `insufficient_stock` بـ 409 مع `available`/`requested`).
  5. الإجمالي الفرعي، الخصم، رسوم التوصيل، والإجمالي النهائي بتتحسب بالكامل من `server/src/services/pricingService.ts` (بالقرش الصحيح، مش float مباشر — `toPiastres`/`toEgp`). الحد الأدنى للطلب بيتحقق قبل أي كتابة (`minimum_order_not_met` مع `minimumOrder`/`currentAmount` الفعليين).
  6. الطلب و`order_items` بتتسجل بقيم الاسم/الوحدة/السعر المُقفولة من `products` (لقطة تاريخية، مش من العميل). `id` = UUID عشوائي (`crypto.randomUUID()`)، `order_number` = `'ALA-' || nextval('order_number_seq')` (ذرّي، بدون تضارب حتى تحت تزامن).
  7. المخزون بيتخصم ذرّياً (`UPDATE products SET stock = stock - $1 WHERE stock >= $1`) مع تسجيل حركة `'sale'` في `stock_movements` (مرتبطة بـ `order_id`) — عبر `deductStockForOrder()`.
  8. لو اتطبّق خصم، `used_count` بتتزود بشرط ذرّي (`incrementDiscountUsageAtomic`: `WHERE active AND (max_uses IS NULL OR used_count < max_uses)`) — فشل هنا (سباق نادر جداً) يلغي الطلب كله بـ `discount_max_uses`.
  - **Idempotency**: العميل بيبعت `Idempotency-Key` (header). لو نفس المفتاح موجود بالفعل مرتبط بطلب، الرد بيرجّع نفس الطلب (200، مش إنشاء جديد) بعد ما يتأكد إن "بصمة" الطلب (`request_fingerprint` — hash لمحتوى الطلب الأساسي) مطابقة؛ لو مختلفة فعلياً، `409 idempotency_conflict`. سباق حقيقي على نفس المفتاح (طلبين بالظبط في نفس اللحظة) بيتصالح عبر معالجة unique-violation على `idx_orders_idempotency_key`: اللي يخسر السباق بيرجّع نفس الطلب اللي كسبه بدل ما يفشل.
  - **لا يوجد `PATCH /api/orders/:id/status` للعميل** — تغيير الحالة حصراً عبر `PATCH /api/admin/orders/:id/status` (يتطلب `is_admin`). **ومفيش أي endpoint عام يسمح بجلب تفاصيل طلب بدون تسجيل دخول** — الزائر بيشوف تفاصيل طلبه فقط من رد الإنشاء نفسه.
- `GET /api/admin/orders` — تتطلب `is_admin`، `LEFT JOIN` على `users` (طلبات الزوّار تفضل ظاهرة، `accountEmail: null`). ترقيم اختياري بنفس منطق العميل، لكن **بدون تأثير لو `page`/`limit` مش موجودين في الطلب أصلاً** — بيرجع كل الطلبات المطابقة للفلاتر زي ما كان الحال دايماً، عشان صفحات التحليلات/المحفظة/الرئيسية بتحسب إجماليات من كل الطلبات التاريخية ومينفعش تتقطع بصمت. فلاتر اختيارية: `status`, `riderId`, `from`/`to` (تاريخ)، `search` (اسم/موبايل/رقم طلب). لا N+1: عناصر كل الطلبات المرجعة بتتجاب باستعلام واحد (`WHERE order_id = ANY($1)`) مش استعلام منفصل لكل طلب — `server/src/orderItems.ts`، مُستخدم من نفس الراوت وراوت العميل.
- `PATCH /api/admin/orders/:id/status` — يتحقق من صحة الانتقال (`canTransitionOrderStatus`، `server/src/orderStatus.ts`): حالتين نهائيتين (`delivered`, `cancelled`) مينفعش تتغيّر لأي حالة تانية. الانتقال لـ `cancelled` تحديداً بينفّذ عبر `orderService.cancelOrder()`: جوه معاملة واحدة، بيقفل صف الطلب، يحدّث الحالة، وبيرجّع المخزون لكل صنف (`restoreStockForCancelledOrder`) مع تسجيل حركة `'cancel_restore'` — **idempotent فعلياً**: بيتحقق الأول من عدم وجود حركة `cancel_restore` سابقة لنفس الطلب قبل ما يرجّع أي مخزون، فإلغاء نفس الطلب مرتين ما يرجّعش المخزون مرتين.
- `GET /api/categories`, `GET /api/products` — عامة، بدون تسجيل دخول (كتالوج العميل).
- `POST /api/discounts/validate` — عامة، بدون تسجيل دخول (تُستخدم من صفحة `/cart`). تأخذ `{code, subtotal}` وترجع مبلغ الخصم المحسوب فعلياً، أو أحد أكواد الخطأ: `discount_not_found` (404)، `discount_inactive`, `discount_expired`, `discount_min_order` (مع `minOrder`), `discount_max_uses` (400).
- `GET/POST /api/admin/products`, `GET/PATCH /api/admin/products/:id` — تتطلب `is_admin` (`requireAdmin`)، تتحقق من تفرّد الـ slug.
  - **ملاحظة تصحيح**: `PATCH` يدمج جسم الطلب فوق المنتج الحالي لدعم التحديث الجزئي (`Partial<AdminProductInput>`). لازم الدمج يبقى فوق نسخة الصف بعد `serialize()` (القيم المنطقية `available`/`bestseller`/`offer` كـ `boolean` حقيقي)، مش فوق الصف الخام من قاعدة البيانات (فيه `0`/`1` كأرقام) — وإلا أي تحديث جزئي بيغفل عن إرسال هذه الحقول هيفشل بـ `missing_fields` لأن `typeof 0 !== 'boolean'`.
- `GET/POST /api/admin/categories` — تتطلب `is_admin`، تتحقق من تفرّد الـ id.
- `GET /api/admin/customers`, `GET /api/admin/customers/:id` — تتطلب `is_admin`، تجمع بيانات كل عميل من `users` مع `LEFT JOIN` على `orders` (عدد الطلبات، إجمالي الإنفاق، تاريخ آخر طلب، آخر رقم موبايل استُخدم)، وتستثني حسابات `is_admin = 1`. شرط الـ`JOIN` نفسه يستثني الطلبات الملغاة (`AND o.status != 'cancelled'`) حتى لا تُحسب ضمن عدد الطلبات أو إجمالي الإنفاق.
- `GET/POST /api/admin/discounts`, `PATCH /api/admin/discounts/:code` — تتطلب `is_admin`، تتحقق من تفرّد الكود عند الإنشاء. الكود نفسه (المفتاح الأساسي) لا يتغيّر عبر `PATCH`.
- منطق التحقق من الخصم منفصل عن جلب الصف: `validateDiscountAgainstSubtotal()` (دالة نقية، قابلة للاختبار بدون قاعدة بيانات) مشتركة بين `findDiscount()` (بدون قفل، لـ `POST /api/discounts/validate` كمعاينة قبل الدفع) و`findDiscountForUpdate()` (بقفل `FOR UPDATE`، لـ `POST /api/orders` الفعلي) — نفس القواعد بالضبط في المكانين (نشِط، غير منتهي [`DATE`، مش `TIMESTAMPTZ` — تاريخ بدون وقت]، فوق الحد الأدنى، تحت حد الاستخدام)، لكن زيادة `used_count` نفسها ذرّية دايماً (`incrementDiscountUsageAtomic`) بغض النظر عن مين نادى عليها.
- `GET /health` — عامة تماماً، بدون أي مصادقة، برّه بادئة `/api`. فحص سريع (`SELECT 1`) يرجع `{"status":"ok"}` (200) أو `{"status":"error"}` (503) — `railway.json` مربوطه كـ `deploy.healthcheckPath`.
- `GET/POST /api/admin/stock-movements` — تتطلب `is_admin`. `POST` يأخذ `{productId, type, quantityChange, note?}` (`type`: `restock`|`return`|`damage`|`loss`|`adjustment`)، يرفض لو `stock` الناتج سالب (`insufficient_stock`)، ويحدّث `products.stock` مع إدراج سطر في `stock_movements` داخل نفس المعاملة. `PATCH /api/admin/products/:id` نفسه يسجّل حركة `adjustment` تلقائياً لو الفرق بين المخزون القديم والجديد ≠ 0 — أي تغيير في رقم المخزون، من أي مكان، ينتج عنه سطر في السجل.
- `GET /api/admin/users`, `PATCH /api/admin/users/:id/admin` — تتطلب `is_admin`. `PATCH` يرفض إلغاء صلاحية المدير عن نفس الحساب المسجّل دخوله حالياً (`cannot_demote_self`) لتفادي قفل الوصول للوحة التحكم بالخطأ.
- `GET /api/banners` — عامة، بدون تسجيل دخول. ترجع البنرات الفعّالة فقط (`active = 1`) مرتبة حسب `sort_order`، تُستخدم في بانر الصفحة الرئيسية للعميل.
- `GET/POST /api/admin/banners`, `GET/PATCH /api/admin/banners/:id` — تتطلب `is_admin`. `POST` يحط البانر الجديد آخر الترتيب تلقائياً (`sort_order` = أعلى قيمة حالية + 1).
- `GET /api/settings` — عامة، بدون تسجيل دخول. صف `store_settings` كامل، تُستخدم من `CatalogContext` في تطبيق العميل.
- `GET/PATCH /api/admin/settings` — تتطلب `is_admin`. `PATCH` يدمج الجسم فوق الصف الحالي (يدعم تحديث جزئي) قبل التحقق.
- `PATCH /api/admin/orders/:id/rider` — تتطلب `is_admin`. `{riderId: string|null}` — يربط الطلب بمندوب توصيل موجود فعلاً (يتحقق من وجوده أولاً) أو يلغي الربط (`null`).
- `GET/POST/PATCH /api/admin/riders` — تتطلب `is_admin`. مندوبي التوصيل: `name`, `phone`, `active`. لا يوجد `DELETE` — مندوب يتوقف عن العمل يُعطَّل (`active=false`) بدل حذفه، حفاظاً على تاريخ الطلبات/التسويات المرتبطة به.
- `GET/POST /api/admin/settlements` — تتطلب `is_admin`. `POST {riderId}` يحسب سيرفر-سايد (لا يثق بأي مبلغ من المتصفح) مجموع كل طلبات هذا المندوب "تم التسليم" التي لم تُسوَّ بعد (`settlement_id IS NULL`)، يرفض بـ `nothing_to_settle` لو مفيش مستحق، وإلا يُنشئ صف `settlements` ويربط كل تلك الطلبات به (`orders.settlement_id`) داخل معاملة واحدة — فمفيش طلب ممكن يتحسب في تسويتين.
- `GET/POST/PATCH/DELETE /api/admin/expenses` — تتطلب `is_admin`. سجل مصروفات حر (`category` نص حر، `amount`, `expenseDate`, `note?`) بدون فئات مقفولة أو ربط بأي جدول تاني.

## نماذج البيانات

### Product
- id, slug, categoryId
- name, description, unit
- price, oldPrice, cost
- available, emoji
- bestseller, offer (يُحسب تلقائياً من `oldPrice > price`, ليس مفتاح يدوي), orderCount
- stock, alertThreshold, barcode, brand

### Category
- id, name, emoji, tint (لون خلفية الإيموجي)

### CartItem
- productId, quantity

### DeliverySlot
- id, label, note (`src/data/deliverySlots.ts`)

### CustomerDetails
- fullName, mobile, governorate (من `src/data/governorates.ts`، ٢٧ محافظة), address

### StockMovement
- id, productId, type (`restock`|`return`|`damage`|`loss`|`adjustment`)
- quantityChange (عدد صحيح موجب أو سالب), note, createdAt

### Banner
- id, kicker, title, note, emoji, ctaLabel, link
- active, sortOrder

### StoreSettings (صف واحد فقط)
- name, whatsappNumber, currency
- minimumOrder, freeShippingThreshold, deliveryFee
- showTodaysOffers, showBestSellers (تحكم في ظهور قسمي "عروض اليوم" و"الأكثر مبيعاً" بالصفحة الرئيسية، بدون endpoint جديد — نفس `/api/settings` و`/api/admin/settings`)
- codEnabled (تحكم في قبول الدفع عند الاستلام؛ نفس الـ endpoints، وسيرفر `POST /api/orders` يتحقق منه بنفسه ويرفض الطلب بـ `cod_disabled` لو متوقف — مش مجرد تعطيل واجهة)

### Order
- id, createdAt, customer, deliverySlot, paymentMethod
- items (OrderLine[]), subtotal, deliveryFee, total
- status: `placed` | `preparing` | `ready_for_delivery` | `out_for_delivery` | `delivered` | `cancelled`
- discountCode?, discountAmount
- riderId, riderName (nullable — مندوب التوصيل المسؤول، يتحدد من لوحة تفاصيل الطلب في لوحة التحكم)
- settlementId (nullable — لو الطلب "تم التسليم" واتسوّى كاشه مع المندوب، يشير لصف في `Settlement`؛ `null` يعني الكاش لسه مستحق على المندوب لو كان له مندوب)

### Discount
- code (مفتاح أساسي، Uppercase دائماً)
- type: `percentage` | `fixed`, value
- minOrder, maxUses (nullable = بلا حدود), usedCount
- active, expiresAt (nullable)

### Rider (مندوب توصيل)
- id, name, phone, active, createdAt
- لا يوجد حذف — التعطيل (`active=false`) هو البديل، حفاظاً على تاريخ الطلبات/التسويات

### Settlement (تسوية كاش مندوب)
- id, riderId, riderName, amount (محسوب سيرفر-سايد وقت الإنشاء), orderCount, createdAt
- كل تسوية تقفل مجموعة طلبات "تم التسليم" غير مسوّاة سابقاً لنفس المندوب (تصبح `orders.settlement_id` = هذه التسوية)

### Expense (مصروف)
- id, category (نص حر، بدون فئات مقفولة), amount, note, expenseDate, createdAt

## أماكن التخصيص

- اسم المتجر والشحن والحد الأدنى ورقم واتساب: قاعدة البيانات (`store_settings`) — التعديل الفعلي من لوحة التحكم `/settings/store` و`/settings/delivery`، مش بتعديل ملف.
- الأقسام والمنتجات: قاعدة البيانات (`server/src/db.ts`)، البذرة الأولى في `server/src/seedData.ts` — التعديل الفعلي من لوحة التحكم (`admin/`)، وليس بتعديل ملف.
- مواعيد التوصيل:
  `src/data/deliverySlots.ts`
- التصميم:
  `src/styles.css`
