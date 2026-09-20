// معالج انتهاء صلاحية نقاط الولاء — أداة دورية زي cleanup.ts/sendAbandonedCartReminders.ts
// بالظبط: تشغيل يدوي (npm run loyalty:expire) أو مجدول خارجياً (Railway cron job)، مفيش
// scheduler إضافي جوه التطبيق نفسه ولا الاعتماد على فتح العميل للتطبيق. راجع
// docs/LOYALTY_EXPIRY_CRON.md لتفاصيل إعداد الجدولة الموصى بها على Railway.
import { pool } from './db.js'
import { runLoyaltyExpiryBatch } from './services/loyaltyService.js'

const BATCH_SIZE = 200
// حد أقصى لعدد الدفعات في تشغيلة واحدة — حماية من حلقة مفتوحة نظرياً لو حصل تعارض غريب،
// مش سيناريو متوقع في الاستخدام العادي (كل دفعة بتصفّر remaining_points فوراً فمالهاش سبب
// تترجع تاني في نفس التشغيلة).
const MAX_BATCHES = 500

async function main() {
  let totalExpiredLots = 0
  let batches = 0
  while (batches < MAX_BATCHES) {
    const expired = await runLoyaltyExpiryBatch(BATCH_SIZE)
    totalExpiredLots += expired
    batches++
    if (expired < BATCH_SIZE) break
  }
  console.log(`loyalty expiry: processed ${totalExpiredLots} expired lot(s) across ${batches} batch(es)`)
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
