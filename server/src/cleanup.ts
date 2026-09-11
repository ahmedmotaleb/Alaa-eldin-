// أداة صيانة دورية — بتمسح الصفوف المنتهية بس (جلسات وتوكنات استعادة كلمة مرور منتهية
// الصلاحية فعلاً)، عشان الجدولين دول ما يكبروش من غير حد أقصى. جلسة/توكن لسه صالح (سواء
// نشط دلوقتي أو لأ) ما بيتمسحش أبداً — الشرط الوحيد هو expires_at اللي فات فعلاً.
//
// طريقة التشغيل: يدوي وقت الحاجة (npm run db:cleanup)، أو مجدول دورياً (Railway cron job/
// scheduled task خارجي بيشغّل نفس الأمر — مفيش داعي لـ scheduler إضافي جوه التطبيق نفسه
// لحاجة بالبساطة دي). راجع README.md لتفاصيل الاستخدام.
import { pool } from './db.js'

export async function cleanupExpiredRows() {
  const sessions = await pool.query('DELETE FROM sessions WHERE expires_at <= now()')
  const passwordResets = await pool.query('DELETE FROM password_resets WHERE expires_at <= now()')
  return { sessionsDeleted: sessions.rowCount ?? 0, passwordResetsDeleted: passwordResets.rowCount ?? 0 }
}

async function main() {
  const { sessionsDeleted, passwordResetsDeleted } = await cleanupExpiredRows()
  console.log(`cleaned up ${sessionsDeleted} expired session(s) and ${passwordResetsDeleted} expired password reset token(s)`)
}

// شغّل main() بس لو الملف ده اتنفذ مباشرة (node dist/cleanup.js) — مش لو استوردته أداة/اختبار تاني.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMainModule) {
  main()
    .then(() => pool.end())
    .catch(async err => {
      console.error(err)
      await pool.end()
      process.exit(1)
    })
}
