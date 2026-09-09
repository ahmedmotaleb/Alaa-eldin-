import { Preferences } from '@capacitor/preferences'
import { isNative } from './platform'

// تخزين token الجلسة لتطبيق الأندرويد بس — الويب يفضل معتمد على كوكيز httpOnly زي ما هو
// تماماً، ومحتاجش أي تخزين هنا خالص.
//
// التخزين الدائم بقى في @capacitor/preferences (تخزين خاص بالتطبيق على مستوى النظام) بدل
// localStorage بتاع الـ WebView: تخزين الـ WebView بيدخل ضمن نسخة Android الاحتياطية
// التلقائية (Google Drive)، يعني توكن جلسة عميل كان ممكن ينسخ ويترجّع على جهاز تاني.
// ملحوظة مهمة: Preferences تخزين خاص بالتطبيق، مش تشفير — هو بيقفل مسار النسخ الاحتياطي
// ده، مش بديل عن تشفير فعلي لو اتطلب لاحقاً.
//
// الواجهة هنا فضلت متزامنة (sync) عن قصد لأن api.ts بيقرأ التوكن في كل طلب: القيمة
// بتتحمّل مرة واحدة وقت الإقلاع في ذاكرة الموديول، والكتابة/المسح بيحصلوا في الذاكرة فوراً
// وعلى القرص بشكل غير متزامن.
const KEY = 'alaaeldin_native_session_token'

let cachedToken: string | null = null

export function getNativeSessionToken(): string | null {
  return cachedToken
}

export function setNativeSessionToken(token: string) {
  cachedToken = token
  void Preferences.set({ key: KEY, value: token }).catch(() => {
    // التخزين الدائم فشل — الجلسة تفضل شغالة من الذاكرة لحد ما التطبيق يتقفل.
  })
}

export function clearNativeSessionToken() {
  cachedToken = null
  void Preferences.remove({ key: KEY }).catch(() => {})
}

// بتتنادى مرة واحدة قبل أول render (راجع main.tsx) — لازم تخلص قبل ما أي طلب API يتبعت،
// وإلا التطبيق هيفتح كأن المستخدم مش مسجّل دخول رغم إن التوكن متخزّن فعلاً.
export async function hydrateNativeSession(): Promise<void> {
  if (!isNative()) return
  try {
    const { value } = await Preferences.get({ key: KEY })
    if (value) {
      cachedToken = value
      return
    }
    // ترحيل لمرة واحدة للتطبيقات المثبّتة قبل التغيير ده: التوكن القديم بيتنقل من
    // localStorage للتخزين الجديد وبيتمسح من مكانه القديم، عشان النسخة الاحتياطية
    // ما تفضلش شايلة نسخة منه — والمستخدم ما يتسجّلش خروج بسبب الترقية.
    const legacy = localStorage.getItem(KEY)
    if (legacy) {
      cachedToken = legacy
      await Preferences.set({ key: KEY, value: legacy })
      localStorage.removeItem(KEY)
    }
  } catch {
    // مفيش تخزين متاح — التطبيق يفتح كزائر، والمستخدم يقدر يسجّل دخول عادي.
  }
}
