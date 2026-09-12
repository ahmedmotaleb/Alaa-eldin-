#!/usr/bin/env bash
# نسخ احتياطي يدوي لقاعدة البيانات — راجع server/docs/BACKUP_RESTORE.md للتفاصيل الكاملة.
set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL غير موجود في البيئة" >&2
  exit 1
fi

OUT="${1:-backup_$(date +%Y%m%d_%H%M%S).dump}"
pg_dump "$DATABASE_URL" -Fc -f "$OUT"
echo "تم إنشاء النسخة الاحتياطية: $OUT"
