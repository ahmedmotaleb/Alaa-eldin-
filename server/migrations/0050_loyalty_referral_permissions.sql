-- صلاحيات جديدة للولاء/الإحالة — بتتمنح تلقائياً بس للمدير الكامل (role-manager)، بنفس
-- المبدأ المتّبع في كل صلاحية جديدة سابقة (راجع 0039/0040/0048). مفيش منح تلقائي لأي دور
-- تاني (موظف تجهيز/مندوب توصيل/مسؤول مخزون فقط) — مطابق تماماً لمتطلبات هذه الدفعة.
INSERT INTO role_permissions (role_id, permission)
SELECT 'role-manager', p FROM unnest(ARRAY[
  'loyalty.view', 'loyalty.adjust', 'loyalty.settings', 'referrals.view', 'referrals.manage'
]) AS p
ON CONFLICT DO NOTHING;
