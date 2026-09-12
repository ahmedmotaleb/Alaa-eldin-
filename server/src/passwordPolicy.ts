// سياسة كلمة مرور موحّدة (تسجيل جديد + استعادة كلمة المرور) — 8 أحرف على الأقل، وفيها حرف
// ورقم على الأقل. تعقيد معقول بدون مبالغة (مفيش إجبار رموز خاصة) عشان يفضل عملي لعميل عادي.
export function isStrongPassword(password: string): boolean {
  return password.length >= 8 && /[a-zA-Z]/.test(password) && /[0-9]/.test(password)
}
