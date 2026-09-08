-- صفحات محتوى قابلة للتعديل من الإدارة (سياسة الاسترجاع والاستبدال، وأي صفحات مشابهة
-- لاحقاً — الشروط والأحكام، سياسة الخصوصية، إلخ). المحتوى نص عادي (TEXT) بيتعرض بالواجهة
-- مع الحفاظ على فواصل الأسطر (white-space: pre-wrap) — مفيش أي HTML بيتخزن أو يتعرض،
-- فمفيش احتياج لأي sanitization إضافية أو dangerouslySetInnerHTML.
CREATE TABLE IF NOT EXISTS content_pages (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_content_pages_slug ON content_pages(slug);

INSERT INTO content_pages (slug, title, content, active, sort_order)
VALUES (
  'refund-exchange-policy',
  'سياسة الاسترجاع والاستبدال',
  E'يمكن للعميل طلب استرجاع أو استبدال أي منتج خلال 24 ساعة من وقت الاستلام في الحالات التالية:\n\n- المنتج تالف أو منتهي الصلاحية عند الاستلام.\n- المنتج المستلم مختلف عما تم طلبه.\n- وجود نقص في الكمية المطلوبة.\n\nللتواصل بخصوص الاسترجاع أو الاستبدال، يرجى التواصل معنا عبر واتساب فور استلام الطلب مع توضيح المشكلة.\n\nيُرجى ملاحظة أن هذه السياسة قابلة للتحديث من قِبل إدارة المتجر.',
  1,
  0
)
ON CONFLICT (slug) DO NOTHING;
