-- صورة اختيارية للقسم — الإيموجي (categories.emoji) يفضل موجود كاحتياط. أولوية العرض
-- للعميل: صورة القسم لو موجودة، وإلا الإيموجي، وإلا أيقونة افتراضية عامة.
ALTER TABLE categories ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE categories ADD COLUMN IF NOT EXISTS image_storage_key TEXT NOT NULL DEFAULT '';
