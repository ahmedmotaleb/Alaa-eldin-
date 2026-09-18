import { Router } from 'express'
import { requireAdmin } from '../auth.js'
import { isTwoFactorEnabled, countRemainingBackupCodes } from '../services/twoFactorService.js'

export const adminSecurityStatusRouter = Router()
adminSecurityStatusRouter.use(requireAdmin)

// حالة أمان تشخيصية بس — بدون أي قيم سرية (مفاتيح، متغيرات بيئة، رابط قاعدة بيانات، محتوى
// توكن). كل قيمة هنا إما true/false محسوبة من إعداد ثابت في الكود، أو نص وصفي عام، أو حالة
// المستخدم الحالي نفسه (2FA) — بالظبط نفس مبدأ adminIntegrationsRouter (حالة الاتصال فقط).
adminSecurityStatusRouter.get('/', async (req, res) => {
  // https فعلي بيتحقق من الطلب الحالي نفسه (هيدر x-forwarded-proto اللي بيحطه Railway
  // كـ proxy) — مش افتراض ثابت، ومش معتمد على إعداد trust proxy (الهيدر الخام مقروء دايماً
  // بغض النظر عن الإعداد ده).
  const forwardedProto = req.headers['x-forwarded-proto']
  const httpsDetected = req.secure || (typeof forwardedProto === 'string' && forwardedProto.split(',')[0].trim() === 'https')

  const enabled = await isTwoFactorEnabled(req.user!.id)
  const remainingBackupCodes = enabled ? await countRemainingBackupCodes(req.user!.id) : 0

  res.json({
    https: {
      // مبني على الطلب الحالي الفعلي، مش تخمين — لو السيرفر شغال محلياً (تطوير) من غير
      // بروكسي HTTPS هيظهر "يحتاج مراجعة" بشكل صحيح.
      detected: httpsDetected
    },
    headers: {
      // إعداد ثابت في server/src/index.ts (helmet + CSP صريح) — راجع الكود، مش قياس لحظي.
      contentSecurityPolicy: true,
      // افتراضي helmet 8 (مفيش override) — max-age سنة واحدة، بدون includeSubDomains إضافي أو preload.
      strictTransportSecurity: true,
      xContentTypeOptions: true,
      frameAncestorsDenied: true,
      referrerPolicy: true
    },
    twoFactor: {
      enabled,
      remainingBackupCodes
    },
    captcha: {
      // مفيش أي تكامل CAPTCHA/Turnstile في الكود حالياً — القيمة دي حقيقة، مش placeholder.
      configured: false
    },
    passwordPolicy: {
      // القيمة الفعلية المطبّقة في server/src/passwordPolicy.ts — نفسها لكل من الإدارة والعملاء،
      // لا يوجد سياسة أقوى خاصة بالإدارة حالياً.
      minLength: 8,
      requiresLetter: true,
      requiresDigit: true,
      sameForAdminAndCustomer: true
    },
    dependencySecurity: {
      // بيتم فحصه فعلياً كجزء من CI (npm audit) عند كل دفعة/طلب سحب — مش فحص لحظي هنا.
      status: 'checked_in_ci',
      note: 'يتم فحص التبعيات تلقائياً في CI عند كل دفعة أو طلب سحب — هذه الصفحة لا تجري فحصاً لحظياً'
    }
  })
})
