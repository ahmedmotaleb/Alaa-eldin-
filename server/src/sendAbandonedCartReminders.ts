// تذكير بالسلة المهجورة — أداة دورية زي cleanup.ts بالظبط: تشغيل يدوي (npm run
// notify:abandoned-cart) أو مجدول خارجياً (Railway cron job)، مفيش scheduler إضافي جوه
// التطبيق نفسه. راجع README.md لتفاصيل الإعداد.
import { pool } from './db.js'
import { sendAbandonedCartReminders } from './services/abandonedCartService.js'

async function main() {
  const stats = await sendAbandonedCartReminders()
  console.log(
    `sent ${stats.reminded} abandoned-cart reminder(s), ` +
    `${stats.skippedConverted} skipped (already converted), ` +
    `${stats.skippedPreference} skipped (promotions disabled)`
  )
}

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
