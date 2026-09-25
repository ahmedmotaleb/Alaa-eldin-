import { Router } from 'express'
import { requireAdmin, requirePermission } from '../auth.js'
import { recordAuditLog } from '../services/auditLogService.js'
import { logEvent, maskPhone } from '../logger.js'
import { whatsappConfigured, sendWhatsAppMessage } from '../services/whatsappService.js'
import { whatsappWebhookConfigured } from '../services/whatsappWebhookService.js'
import { pushConfigured, countPushSubscriptions } from '../services/pushService.js'
import { emailConfigured } from '../email.js'
import { imageStorageConfigured } from '../services/imageStorageService.js'
import { isValidEgyptianMobile } from '../phone.js'

export const adminIntegrationsRouter = Router()
adminIntegrationsRouter.use(requireAdmin)

// حالة الاتصال فقط (متصل/غير مُعد) — مفيش أي مفتاح أو توكن سري بيتعرض هنا أبداً، بس أعلام
// true/false محسوبة من وجود متغيرات البيئة، بالإضافة لتشخيصات بسيطة غير حساسة (عدد الاشتراكات).
adminIntegrationsRouter.get('/', requirePermission('integrations.manage'), async (_req, res) => {
  const pushSubscriptionCount = pushConfigured ? await countPushSubscriptions() : 0
  res.json({
    whatsapp: { configured: whatsappConfigured, deliveryWebhookConfigured: whatsappWebhookConfigured },
    push: { configured: pushConfigured, subscriptionCount: pushSubscriptionCount },
    email: { configured: emailConfigured },
    cloudinary: { configured: imageStorageConfigured }
  })
})

// اختبار اتصال واتساب — بيتطلب رقم وجهة صريح دايماً (مفيش إرسال تلقائي لأي حد)، وبيستخدم
// نفس مسار الإرسال الحقيقي (sendWhatsAppMessage) عشان يعكس الحالة الفعلية بالظبط، مش محاكاة.
adminIntegrationsRouter.post('/whatsapp/test', requirePermission('integrations.manage'), async (req, res) => {
  const destination = typeof req.body?.destination === 'string' ? req.body.destination.trim() : ''
  if (!destination || !isValidEgyptianMobile(destination)) {
    res.status(400).json({ error: 'invalid_destination' })
    return
  }

  const result = await sendWhatsAppMessage({
    toNumber: destination,
    body: 'رسالة اختبار من لوحة تحكم علاء الدين — الاتصال بواتساب شغال.',
    createdByUserId: req.user!.id
  })

  logEvent('integration_test_connection', { integration: 'whatsapp', maskedDestination: maskPhone(destination), ok: result.ok })
  await recordAuditLog({
    adminUserId: req.user!.id,
    action: 'integration_whatsapp_test',
    entityType: 'integration',
    entityId: 'whatsapp',
    newValues: { maskedDestination: maskPhone(destination), result: result.ok ? (result.sent ? 'sent' : 'failed') : result.reason }
  })

  res.json(result)
})
