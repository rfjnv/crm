ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'SITE_ADMIN';

-- Учётки, созданные при входе по email (логин = email), ошибочно получили ADMIN
UPDATE users
SET role = 'SITE_ADMIN', permissions = '{}'
WHERE role = 'ADMIN'
  AND login ~ '^[^@]+@[^@]+\.[^@]+$'
  AND cardinality(permissions) = 0;
