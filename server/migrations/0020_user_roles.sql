ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'staff';

UPDATE users SET role = 'admin' WHERE is_admin = 1 AND role <> 'admin';

ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('staff', 'admin'));
