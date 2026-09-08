// تخزين token الجلسة لتطبيق الأندرويد بس — الويب يفضل معتمد على كوكيز httpOnly زي ما هو
// تماماً، ومحتاجش أي تخزين هنا خالص. ملحوظة: localStorage هنا مؤقت وبسيط (نفس أسلوب تخزين
// السلة المستخدم بالفعل في المشروع) — لو الأمان الإضافي مطلوب لاحقاً، يُستبدل بـ
// @capacitor/preferences (تخزين مخصص للنظام) من غير ما يتغيّر أي حاجة تانية في التطبيق.
const KEY = 'alaaeldin_native_session_token'

export function getNativeSessionToken(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

export function setNativeSessionToken(token: string) {
  try {
    localStorage.setItem(KEY, token)
  } catch {
    // تخزين غير متاح (وضع خاص، إلخ) — الجلسة هتفضل شغالة لمدة الجلسة الحالية بس من غير حفظ.
  }
}

export function clearNativeSessionToken() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // لا شيء نعمله لو التخزين مش متاح أصلاً.
  }
}
