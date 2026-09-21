// تتبّع محاولات تسجيل الدخول الفاشلة لكل إيميل — أساس قرار "هل نطلب CAPTCHA للمحاولة
// دي؟" في مسار /login. مخزّن في قاعدة البيانات عمداً (مش Map في الذاكرة) عشان يفضل
// صحيح عبر إعادة تشغيل السيرفر أو أكتر من نسخة شغالة. نافذة الفشل (FAILURE_WINDOW_MS)
// بتخلي العداد يرجع صفر تلقائياً من غير أي مهمة تنظيف دورية منفصلة.
import { pool } from '../db.js'

const FAILURE_WINDOW_MS = 30 * 60 * 1000

export async function recordFailedLoginAttempt(email: string): Promise<void> {
  await pool.query(
    `INSERT INTO login_failure_tracking (email, failure_count, first_failure_at, last_failure_at)
     VALUES ($1, 1, now(), now())
     ON CONFLICT (email) DO UPDATE SET
       failure_count = CASE
         WHEN login_failure_tracking.last_failure_at < now() - interval '30 minutes' THEN 1
         ELSE login_failure_tracking.failure_count + 1
       END,
       first_failure_at = CASE
         WHEN login_failure_tracking.last_failure_at < now() - interval '30 minutes' THEN now()
         ELSE login_failure_tracking.first_failure_at
       END,
       last_failure_at = now()`,
    [email]
  )
}

export async function clearFailedLoginAttempts(email: string): Promise<void> {
  await pool.query('DELETE FROM login_failure_tracking WHERE email = $1', [email])
}

// بيرجع 0 لو مفيش سجل أصلاً أو لو آخر فشل كان قبل أكتر من نافذة الفشل (يعتبر منتهي/منسي) —
// من غير أي حذف فعلي للصف (هيتحدّث لوحده في أول INSERT ... ON CONFLICT جديد).
export async function getRecentFailedLoginCount(email: string): Promise<number> {
  const { rows } = await pool.query<{ failureCount: number, lastFailureAt: string }>(
    'SELECT failure_count as "failureCount", last_failure_at as "lastFailureAt" FROM login_failure_tracking WHERE email = $1',
    [email]
  )
  const row = rows[0]
  if (!row) return 0
  const lastFailureAt = new Date(row.lastFailureAt).getTime()
  if (Date.now() - lastFailureAt > FAILURE_WINDOW_MS) return 0
  return row.failureCount
}
