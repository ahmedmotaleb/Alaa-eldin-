-- بانرات موجودة بالفعل بتفضل تظهر في الكاروسيل الرئيسي زي ما هي (القيمة الافتراضية
-- 'hero') — البانر الوحيد اللي هيظهر كـ popup تسويقي هو اللي الإدارة تحدده صراحة كده.
ALTER TABLE banners ADD COLUMN placement TEXT NOT NULL DEFAULT 'hero';
ALTER TABLE banners ADD CONSTRAINT banners_placement_check CHECK (placement IN ('hero', 'popup'));
