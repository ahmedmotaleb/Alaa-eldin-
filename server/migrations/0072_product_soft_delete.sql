-- حذف آمن للمنتجات — soft delete فقط، أبداً مش DELETE فعلي من قاعدة البيانات. المنتج
-- مرتبط بجداول تاريخية كتير (order_items, goods_receiving_items, return_items,
-- cycle_count_items, purchase_order_items...) بدون ON DELETE CASCADE عليها عمداً، فأي
-- محاولة حذف فعلي هتفشل بـ FK violation لأي منتج سبق بيعه/استلامه أصلاً — ده المقصود، مش
-- مشكلة. "الحذف" هنا يعني بس: deleted_at + إخفاء فوري (available=0)، والصف نفسه فاضل زي ما
-- هو عشان كل الجداول التاريخية تقدر تكمل تربط عليه وتعرض اسمه/بياناته بشكل صحيح.
ALTER TABLE products ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- بيسرّع عرض "المنتجات المحذوفة" (شاشة الاستعادة) بدون ما يأثر على فهرسة المنتجات العادية
-- (deleted_at فاضي لمعظم الصفوف فعلياً، فالفهرس الجزئي ده صغير جداً).
CREATE INDEX IF NOT EXISTS idx_products_deleted_at ON products (deleted_at) WHERE deleted_at IS NOT NULL;

-- صلاحية حذف/استعادة منفصلة عن products.edit (نفس مبدأ فصل products.cost.bulk_update عن
-- products.edit) — عملية تدميرية (حتى لو soft) تستاهل صلاحية مستقلة قابلة للمنح/السحب
-- بدون التأثير على صلاحية التعديل العادية. ممنوحة لنفس الأدوار اللي عندها products.edit
-- بالفعل (role-manager, role-inventory-manager) — المدير الكامل (legacy) بياخدها تلقائياً
-- عن طريق ALL_PERMISSIONS في permissionService.ts.
INSERT INTO role_permissions (role_id, permission)
SELECT r, 'products.delete' FROM unnest(ARRAY['role-manager', 'role-inventory-manager']) AS r
ON CONFLICT DO NOTHING;
