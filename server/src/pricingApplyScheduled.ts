// معالج تنفيذ جدولة الأسعار المستقبلية — أداة دورية زي loyaltyExpire.ts/cleanup.ts بالظبط:
// تشغيل يدوي (npm run pricing:apply-scheduled) أو مجدول خارجياً (Railway cron job)، مفيش
// scheduler إضافي جوه التطبيق نفسه. راجع docs/SCHEDULED_PRICING_CRON.md لتفاصيل الجدولة
// الموصى بها على Railway.
import { pool } from './db.js'
import { runApplyScheduledBatch } from './services/pricingScheduleService.js'

const BATCH_SIZE = 200
const MAX_BATCHES = 500

async function main() {
  let totalApplied = 0
  let totalConflicts = 0
  let batches = 0
  while (batches < MAX_BATCHES) {
    const { applied, conflicts } = await runApplyScheduledBatch(BATCH_SIZE)
    totalApplied += applied
    totalConflicts += conflicts
    batches++
    if (applied + conflicts < BATCH_SIZE) break
  }
  console.log(`scheduled pricing: applied ${totalApplied}, conflicts ${totalConflicts}, across ${batches} batch(es)`)
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
