import { Router } from 'express'
import { logWarn } from '../logger.js'
import { verifyWebhookVerifyToken, verifyWebhookSignature, processStatusWebhookPayload, whatsappWebhookConfigured } from '../services/whatsappWebhookService.js'

export const whatsappWebhookRouter = Router()

// مصافحة التحقق لمرة واحدة اللي Meta بتعملها وقت ما تضبط رابط الـ webhook في لوحة تحكم
// Meta for Developers — querystring hub.mode/hub.verify_token/hub.challenge، من غير أي جسم
// طلب. لو الميزة مش مُفعّلة (المتغيرات ناقصة)، بترجع 404 عادي بدل ما تدّي أي تلميح لوجود
// مسار حساس.
whatsappWebhookRouter.get('/', (req, res) => {
  if (!whatsappWebhookConfigured) { res.status(404).end(); return }
  const mode = req.query['hub.mode']
  const token = req.query['hub.verify_token']
  const challenge = req.query['hub.challenge']
  if (verifyWebhookVerifyToken(mode, token)) {
    res.status(200).type('text/plain').send(String(challenge ?? ''))
    return
  }
  res.status(403).end()
})

// أحداث الحالة الفعلية (sent/delivered/read/failed) بتوصل هنا. لازم توقيع صحيح
// (X-Hub-Signature-256، محسوب على البايتات الخام لجسم الطلب — راجع app.ts للتأكد إن
// rawBody بيتحفظ لهذا المسار تحديداً قبل أي body-parser عام). بنرجّع 200 دايماً بعد التحقق
// من التوقيع (حتى لو معالجة الحدث فشلت داخلياً) — توصية Meta الرسمية: فشل/تأخر في الرد
// بيخلي Meta تعيد المحاولة بعدوانية وتزود الحمل، من غير أي فايدة حقيقية للعميل.
whatsappWebhookRouter.post('/', async (req, res) => {
  if (!whatsappWebhookConfigured) { res.status(404).end(); return }

  const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody
  const signature = req.headers['x-hub-signature-256']
  if (!rawBody || typeof signature !== 'string' || !verifyWebhookSignature(rawBody, signature)) {
    logWarn('whatsapp_webhook_signature_invalid', {})
    res.status(401).json({ error: 'invalid_signature' })
    return
  }

  try {
    await processStatusWebhookPayload(req.body)
  } catch {
    // الخطأ اتسجّل جوه processStatusWebhookPayload نفسها لو كان متوقع؛ أي استثناء غير متوقع
    // هنا لازم برضه يرجع 200 لـ Meta (راجع التعليق فوق) — التشخيص الداخلي مسؤولية اللوج.
  }
  res.status(200).json({ received: true })
})
