-- صور حقيقية للبانرات بدل الاعتماد على الإيموجي بس (اللي بيفضل احتياط للبانرات القديمة).
ALTER TABLE banners ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE banners ADD COLUMN IF NOT EXISTS image_storage_key TEXT NOT NULL DEFAULT '';
ALTER TABLE banners ADD COLUMN IF NOT EXISTS mobile_image_url TEXT;
ALTER TABLE banners ADD COLUMN IF NOT EXISTS mobile_image_storage_key TEXT NOT NULL DEFAULT '';
ALTER TABLE banners ADD COLUMN IF NOT EXISTS alt_text TEXT NOT NULL DEFAULT '';

-- الإيموجي بقى اختياري (مش شرط وجود صورة أو إيموجي مع بعض) — قديماً كان NOT NULL بدون
-- قيمة افتراضية، فبنديله قيمة افتراضية فاضية عشان يقبل صفوف جديدة من غير إيموجي.
ALTER TABLE banners ALTER COLUMN emoji SET DEFAULT '';

-- جدولة اختيارية لعرض البانر — لو NULL يبقى معتمد على "active" بس زي ما كان.
ALTER TABLE banners ADD COLUMN IF NOT EXISTS starts_at TIMESTAMPTZ;
ALTER TABLE banners ADD COLUMN IF NOT EXISTS ends_at TIMESTAMPTZ;
