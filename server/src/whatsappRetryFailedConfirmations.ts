// إعادة محاولة إشعارات تأكيد الطلب التلقائية الفاشلة القابلة لإعادة المحاولة — أداة دورية زي
// sendAbandonedCartReminders.ts/loyaltyExpire.ts بالظبط: تشغيل يدوي (npm run
// whatsapp:retry-confirmations) أو مجدول خارجياً (Railway cron job)، مفيش scheduler إضافي جوه
// التطبيق نفسه. دفعة محدودة الحجم في كل تشغيلة (batchSize)، وكل عنصر بيمر على نفس نظام ملكية
// الإشعار الذرّي (claimAutomaticNotification) بالظبط زي أول محاولة — فتشغيلتين متداخلتين
// (تشغيل يدوي فوق تشغيلة Railway cron جارية) آمنتين تماماً من غير أي تنسيق إضافي في الكود هنا.
import { pool } from './db.js'
import { retryFailedOrderConfirmations } from './services/whatsappService.js'

async function main() {
  const batchSize = Number(process.env.WHATSAPP_RETRY_BATCH_SIZE ?? 20)
  const result = await retryFailedOrderConfirmations(batchSize)
  console.log(
    `whatsapp order-confirmation retry: attempted ${result.attempted}, ` +
    `sent ${result.sent}, still failed ${result.failed}`
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
