#!/usr/bin/env bash
# استعادة قاعدة البيانات من نسخة احتياطية — راجع server/docs/BACKUP_RESTORE.md للتفاصيل الكاملة.
# تحذير: بيستعيد فوق القاعدة اللي في DATABASE_URL مباشرة — تأكد إنها قاعدة فاضية أو إنك
# قاصد فعلاً الكتابة فوقها.
set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL غير موجود في البيئة" >&2
  exit 1
fi

FILE="${1:-}"
if [ -z "$FILE" ]; then
  echo "استخدام: DATABASE_URL=... ./restore.sh <backup_file.dump>" >&2
  exit 1
fi

pg_restore -d "$DATABASE_URL" --clean --if-exists "$FILE"
echo "تمت الاستعادة من: $FILE"
