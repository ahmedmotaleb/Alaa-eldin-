// فحص إعداد بيئة واحد ومركزي وقت الإقلاع. الهدف: أي متكامل خارجي (Cloudinary/WhatsApp/VAPID)
// مُعدّ جزئياً بس (بعض المتغيرات موجودة والباقي ناقص) بيفضل يتصرف كـ "غير مُفعّل" بصمت في كود
// كل خدمة (وده صح — أفضل من نص اتصال يفشل)، لكن من غير سطر لوج واضح وقت الإقلاع، ده غلط شائع
// (متغير بيئة اتكتب اسمه غلط في Railway) هيفضل مكتشف بس لما مستخدم حقيقي يجرب الميزة ويفشل.
// مفيش هنا أي قيمة سر بتتقرا أو بتترجع — بس أسماء المتغيرات الموجودة/الناقصة.
import { logEvent, logWarn } from './logger.js'

interface IntegrationCheck {
  name: string
  required: string[]
  optional?: string[]
}

const INTEGRATIONS: IntegrationCheck[] = [
  { name: 'cloudinary', required: ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'] },
  { name: 'whatsapp', required: ['WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID'] },
  // فرع مستقل عن 'whatsapp' فوق عمداً — الوصول لـ API نفسه ممكن يكون شغال (إرسال نص يدوي
  // من الأدمن) حتى لو اسم قالب تأكيد الطلب التلقائي (المعتمد من Meta) لسه مش مضبوط؛ التفرقة
  // دي هي اللي بتخلي رسالة التحذير تحديداً "واتساب متصل لكن قالب تأكيد الطلب غير مضبوط"
  // بدل ما تختلط مع حالة عدم الاتصال بالكامل.
  { name: 'whatsapp_order_confirmation', required: ['WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_ORDER_CONFIRMATION_TEMPLATE'] },
  { name: 'web_push', required: ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY'] },
  { name: 'email', required: ['RESEND_API_KEY'] },
  { name: 'turnstile', required: ['TURNSTILE_SITE_KEY', 'TURNSTILE_SECRET_KEY'] }
]

export function logStartupConfigSummary() {
  const configured: string[] = []
  const notConfigured: string[] = []

  for (const integration of INTEGRATIONS) {
    const present = integration.required.filter(name => !!process.env[name])
    if (present.length === integration.required.length) {
      configured.push(integration.name)
    } else if (present.length === 0) {
      notConfigured.push(integration.name)
    } else {
      // بعض المتغيرات موجودة والبعض ناقص — على الأغلب غلط كتابة أو نسيان متغير واحد،
      // مش قرار متعمّد بتعطيل الميزة بالكامل.
      const missing = integration.required.filter(name => !process.env[name])
      logWarn('startup_config_partial_warning', { integration: integration.name, missingVars: missing })
      notConfigured.push(integration.name)
    }
  }

  logEvent('startup_config_summary', { configured, notConfigured })
}
