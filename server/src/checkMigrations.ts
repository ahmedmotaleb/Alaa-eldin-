// فحص للقراءة فقط عند إقلاع التطبيق — بيتأكد إن كل الترحيلات (migrations) المطلوبة
// اتطبقت فعلاً على قاعدة البيانات، من غير ما يعمل أي CREATE/ALTER بنفسه. لو فيه ترحيل
// ناقص، السيرفر بيرفض يقلع بدل ما يشتغل على مخطط قديم/ناقص بصمت — الترحيل الفعلي مسؤولية
// خطوة نشر منفصلة وصريحة (npm run db:migrate)، مش مسؤولية عملية الـ Express نفسها.
import { getAppliedVersions, getMigrationFiles } from './migrate.js'

export async function assertMigrationsUpToDate() {
  let applied: Set<string>
  try {
    applied = await getAppliedVersions()
  } catch (err) {
    console.error('تعذّر التحقق من جدول schema_migrations — تأكد إن قاعدة البيانات متاحة وإن npm run db:migrate اتشغّل قبل كده.')
    throw err
  }

  const files = getMigrationFiles()
  const missing = files.filter(f => {
    const version = f.match(/^(\d+)_/)?.[1] ?? f
    return !applied.has(version)
  })

  if (missing.length > 0) {
    console.error(
      `قاعدة البيانات ناقصة ${missing.length} ترحيل (migration) لسه ما اتطبقش: ${missing.join(', ')}.\n` +
      'شغّل "npm run db:migrate --prefix server" قبل ما تشغّل السيرفر.'
    )
    throw new Error('pending_migrations')
  }
}
