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
- `useRequireAuth` (`src/hooks/useRequireAuth.ts`): يحوّل تلقائياً لصفحة `/login` مع حفظ الصفحة الأصلية إذا لم يكن هناك تسجيل دخول. تُستخدم في `/checkout`, `/confirmation/:id`, `/track/:id`.
- `CatalogContext` (`src/store/CatalogContext.tsx`): يجلب `categories`/`products`/`settings` مرة واحدة من `/api/categories`، `/api/products`، `/api/settings` عند إقلاع التطبيق (نفس `Promise.all`) ويوزّع `categories`/`products` لكل الصفحات عبر `useCatalog()`، ويخزّن `settings` في `src/store/settingsStore.ts` (singleton بسيط بره React، `getSettings()`/`setSettings()`). `App.tsx` يمنع رسم `<Routes>` (عبر `CatalogGate`) لحد ما يخلص التحميل أو تظهر رسالة خطأ بزر إعادة محاولة — وده اللي بيضمن إن `getSettings()` ترجع قيم حقيقية فعلاً (مش الافتراضية) بحلول أي render لأي صفحة جوه `<Layout />` (كل الصفحات اللي بتستخدم `formatMoney`/`STORE_CONFIG` القديم). `/onboarding` بس هي الصفحة الوحيدة برّه الـ Gate، ومفيهاش أي استخدام لـ `getSettings()`.
  - **ملاحظة تصحيح مهمة**: `CartContext` يحتاج `products` (من `useCatalog()`) داخل `useMemo` الخاص بـ `detailedItems` ضمن مصفوفة الاعتماديات (`[items, products]`)، وليس `[items]` فقط. لو اعتمدت على `items` وحدها، سيناريو عميل عائد لديه سلة محفوظة بالفعل في `localStorage` (فـ`items` غير فارغة من أول render) بينما الكتالوج لسه بيحمّل (`products` لسه `[]`) يخلي النتيجة المحسوبة أول مرة فارغة، وتفضل عالقة كده لحد ما تتغيّر `items` تاني — أي السلة تظهر فاضية دايماً لهذا العميل رغم وجود المنتجات فعلياً.
- `CartContext`: بالإضافة للسلة، يحمل حالة كود الخصم المطبّق (`discount`) ويعيد التحقق منه تلقائياً من السيرفر كل ما تغيّر إجمالي السلة (`subtotal`)، ويلغيه بصمت لو صار غير صالح (تغيّر الحد الأدنى مثلاً).

## الخادم (`server/`)

Express + SQLite (better-sqlite3) منفصل عن الواجهة. الجداول: `users`, `sessions`, `orders`, `order_items`, `categories`, `products`, `discounts`, `stock_movements`, `banners`, `store_settings` (صف واحد ثابت `id=1`، لا يوجد أكثر من متجر), `riders`, `settlements`, `expenses`. يُزرع `categories`/`products` تلقائياً من `server/src/seedData.ts`، وبانر افتراضي واحد في `banners`، عند أول تشغيل إذا كانت الجداول فارغة (`server/src/db.ts`). أعمدة `discount_code`/`discount_amount`/`rider_id`/`settlement_id` على `orders` تُضاف عبر `ALTER TABLE` بفحص `PRAGMA table_info` أولاً (ترقية آمنة لقاعدة بيانات موجودة من قبل بدون فقد بيانات).

المسارات:
- `POST /api/auth/{register,login,logout}`, `GET /api/auth/me`
- `GET/POST /api/orders`, `GET /api/orders/:id` — تتطلب جلسة صالحة (`requireAuth`) وتتحقق أن الطلب يخص نفس المستخدم. `POST /api/orders` يقبل `discountCode` اختياري، ويعيد التحقق منه بنفسه عبر `evaluateDiscount()` (لا يثق بأي مبلغ خصم يرسله المتصفح) قبل إدراج الطلب وزيادة `discounts.used_count`، كل ده داخل نفس معاملة قاعدة البيانات (`db.transaction`)، ويتحقق أيضاً من `cod_enabled` في `store_settings` ويرفض بـ `cod_disabled` لو الدفع عند الاستلام متوقف. `customer.governorate` حقل مطلوب (عمود `customer_governorate` على `orders`، أُضيف عبر `ALTER TABLE` بنفس نمط أعمدة الخصم — طلبات قديمة قبل الترقية تبقى بقيمة `''`). **لا يوجد `PATCH /api/orders/:id/status` للعميل** — كان موجوداً سابقاً ويسمح لأي عميل يغيّر حالة طلبه الخاص لأي قيمة بدون صلاحية إدارية (ثغرة حقيقية تكسر مصداقية "المحفظة")، اتشال نهائياً؛ تغيير الحالة الآن حصراً عبر `PATCH /api/admin/orders/:id/status` (يتطلب `is_admin`).
- `GET /api/categories`, `GET /api/products` — عامة، بدون تسجيل دخول (كتالوج العميل).
- `POST /api/discounts/validate` — عامة، بدون تسجيل دخول (تُستخدم من صفحة `/cart`). تأخذ `{code, subtotal}` وترجع مبلغ الخصم المحسوب فعلياً، أو أحد أكواد الخطأ: `discount_not_found` (404)، `discount_inactive`, `discount_expired`, `discount_min_order` (مع `minOrder`), `discount_max_uses` (400).
- `GET/POST /api/admin/products`, `GET/PATCH /api/admin/products/:id` — تتطلب `is_admin` (`requireAdmin`)، تتحقق من تفرّد الـ slug.
  - **ملاحظة تصحيح**: `PATCH` يدمج جسم الطلب فوق المنتج الحالي لدعم التحديث الجزئي (`Partial<AdminProductInput>`). لازم الدمج يبقى فوق نسخة الصف بعد `serialize()` (القيم المنطقية `available`/`bestseller`/`offer` كـ `boolean` حقيقي)، مش فوق الصف الخام من قاعدة البيانات (فيه `0`/`1` كأرقام) — وإلا أي تحديث جزئي بيغفل عن إرسال هذه الحقول هيفشل بـ `missing_fields` لأن `typeof 0 !== 'boolean'`.
- `GET/POST /api/admin/categories` — تتطلب `is_admin`، تتحقق من تفرّد الـ id.
- `GET /api/admin/customers`, `GET /api/admin/customers/:id` — تتطلب `is_admin`، تجمع بيانات كل عميل من `users` مع `LEFT JOIN` على `orders` (عدد الطلبات، إجمالي الإنفاق، تاريخ آخر طلب، آخر رقم موبايل استُخدم)، وتستثني حسابات `is_admin = 1`. شرط الـ`JOIN` نفسه يستثني الطلبات الملغاة (`AND o.status != 'cancelled'`) حتى لا تُحسب ضمن عدد الطلبات أو إجمالي الإنفاق.
- `GET/POST /api/admin/discounts`, `PATCH /api/admin/discounts/:code` — تتطلب `is_admin`، تتحقق من تفرّد الكود عند الإنشاء. الكود نفسه (المفتاح الأساسي) لا يتغيّر عبر `PATCH`.
- منطق التحقق من الخصم (`server/src/discounts.ts`, دالة `evaluateDiscount`) مشترك بين `POST /api/discounts/validate` و`POST /api/orders` — نفس القواعد بالضبط في المكانين (نشِط، غير منتهي، فوق الحد الأدنى، تحت حد الاستخدام).
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
