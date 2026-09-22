-- محرك عروض متقدم (اشترِ X واحصل على Y + باقات بسعر ثابت) — منفصل عمداً عن جدول discounts
-- الحالي بدل توسيعه، لأن discounts.type الحالي (percentage/fixed بقيمة رقمية واحدة) ما يقدرش
-- يمثّل منطق BOGO (كمية شراء/كمية هدية/نسبة خصم على الهدية) ولا منطق الباقات (مجموعات
-- منتجات/فئات لازم توجد كلها معاً بسعر إجمالي ثابت) من غير قلب معنى الأعمدة الحالية.
--
-- العروض دي تلقائية بالكامل (بتتفعّل من محتوى السلة نفسه، من غير ما العميل يكتب كود) —
-- فمبدأ "كود خصم واحد بس لكل طلب" (orders.discount_code) فضل زي ما هو من غير أي تغيير:
-- عرض تلقائي واحد أو أكتر ممكن يتطبقوا في نفس الطلب بجانب كود الخصم ونقاط الولاء (زي ما
-- نقاط الولاء أصلاً بتتراكم فوق كود الخصم دلوقتي)، لكن كل وحدة (قطعة) في السلة ما بتتحسبش
-- ضمن أكتر من تطبيق عرض واحد في نفس الطلب (تفاصيل منع الازدواج في promotionService.ts).
CREATE TABLE IF NOT EXISTS promotions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('buy_x_get_y', 'bundle_fixed_price')),
  active INTEGER NOT NULL DEFAULT 1,
  starts_at DATE,
  expires_at DATE,
  -- ترتيب التطبيق عند تعدد العروض المؤهّلة في نفس السلة (الأعلى الأول) — حاسم لضمان نتيجة
  -- حتمية (deterministic) بدل الاعتماد على ترتيب غير مضمون من القاعدة.
  priority INTEGER NOT NULL DEFAULT 0,
  -- حد أقصى لعدد مرات تكرار نفس العرض في الطلب الواحد (NULL = بلا حد، محكوم بس بكمية السلة).
  max_applications_per_order INTEGER CHECK (max_applications_per_order IS NULL OR max_applications_per_order > 0),

  -- حقول buy_x_get_y: المُحفِّز (منتج أو فئة) وكمية الشراء المطلوبة، مقابل الهدية (منتج أو
  -- فئة محدّدة، أو NULL يعني "نفس مجموعة المُحفِّز" — بيُختار وقتها أرخص صنف مؤهّل موجود
  -- فعلياً في السلة، حتمياً حسب السعر ثم معرّف المنتج كفاصل تعادل).
  trigger_product_id TEXT REFERENCES products(id) ON DELETE CASCADE,
  trigger_category_id TEXT REFERENCES categories(id) ON DELETE CASCADE,
  buy_quantity INTEGER CHECK (buy_quantity IS NULL OR buy_quantity > 0),
  get_quantity INTEGER CHECK (get_quantity IS NULL OR get_quantity > 0),
  get_discount_percent NUMERIC(5,2) CHECK (get_discount_percent IS NULL OR (get_discount_percent > 0 AND get_discount_percent <= 100)),
  reward_product_id TEXT REFERENCES products(id) ON DELETE CASCADE,
  reward_category_id TEXT REFERENCES categories(id) ON DELETE CASCADE,

  -- حقل bundle_fixed_price: السعر الإجمالي الثابت للباقة (مجموعات الشرط في promotion_bundle_items).
  bundle_price NUMERIC(12,2) CHECK (bundle_price IS NULL OR bundle_price > 0),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT REFERENCES users(id),

  CHECK (
    (type = 'buy_x_get_y' AND buy_quantity IS NOT NULL AND get_quantity IS NOT NULL AND get_discount_percent IS NOT NULL
       AND (trigger_product_id IS NOT NULL OR trigger_category_id IS NOT NULL) AND bundle_price IS NULL)
    OR
    (type = 'bundle_fixed_price' AND bundle_price IS NOT NULL
       AND trigger_product_id IS NULL AND trigger_category_id IS NULL AND buy_quantity IS NULL AND get_quantity IS NULL
       AND get_discount_percent IS NULL AND reward_product_id IS NULL AND reward_category_id IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_promotions_active_window ON promotions(active, starts_at, expires_at);

-- كل صف = "مجموعة" مطلوبة لتكوين الباقة (منتج محدّد أو أي منتج من فئة، بكمية مطلوبة) —
-- الباقة بتتكوّن من مجموعة واحدة أو أكتر (كل مجموعة منتج/فئة مختلفة)، وكل المجموعات لازم
-- تتحقق معاً عشان الباقة تتفعّل (راجع "multiple bundle groups" في مواصفة الدفعة).
CREATE TABLE IF NOT EXISTS promotion_bundle_items (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  promotion_id TEXT NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
  product_id TEXT REFERENCES products(id) ON DELETE CASCADE,
  category_id TEXT REFERENCES categories(id) ON DELETE CASCADE,
  required_quantity INTEGER NOT NULL DEFAULT 1 CHECK (required_quantity > 0),
  CHECK ((product_id IS NULL) != (category_id IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_promotion_bundle_items_promotion ON promotion_bundle_items(promotion_id);

-- سجل فعلي لكل تطبيق عرض حقيقي على طلب حقيقي — أساس عرض ملخص العروض على الإيصال/تفاصيل
-- الطلب في لوحة التحكم، ودليل تدقيق ثابت لا يتغيّر حتى لو العرض نفسه اتعدّل/اتشال لاحقاً.
CREATE TABLE IF NOT EXISTS order_promotion_applications (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  promotion_id TEXT REFERENCES promotions(id) ON DELETE SET NULL,
  promotion_name TEXT NOT NULL,
  promotion_type TEXT NOT NULL,
  applications_count INTEGER NOT NULL CHECK (applications_count > 0),
  discount_amount NUMERIC(12,2) NOT NULL CHECK (discount_amount >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_order_promotion_applications_order ON order_promotion_applications(order_id);

-- إجمالي خصم العروض التلقائية على الطلب — عمود منفصل عن discount_amount (كود الكوبون)
-- عشان ترتيب الحساب (subtotal -> كوبون -> عروض -> ولاء -> توصيل) يفضل واضح وقابل للتدقيق
-- في كل صف طلب من غير الرجوع لجدول order_promotion_applications في كل مرة.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS promotion_discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0;
