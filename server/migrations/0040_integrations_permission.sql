-- صلاحية جديدة "إدارة التكاملات" (integrations.manage) — بتحكم في شاشة الإعدادات → التكاملات
-- (حالة الاتصال فقط، مفيش أي مفاتيح سرية بتتعرض) وزر اختبار اتصال واتساب اليدوي.
INSERT INTO role_permissions (role_id, permission)
SELECT 'role-manager', 'integrations.manage'
WHERE NOT EXISTS (SELECT 1 FROM role_permissions WHERE role_id = 'role-manager' AND permission = 'integrations.manage');
