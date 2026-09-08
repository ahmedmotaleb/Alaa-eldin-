// التصميم الأصلي للوحة التحكم يعرض الأرقام بأرقام إنجليزية (en-US) خلافاً لتطبيق العميل،
// وهو اختيار شائع في أدوات التشغيل/المحاسبة حتى داخل واجهة عربية بالكامل.
export function formatMoney(value: number) {
  return `${Math.round(value).toLocaleString('en-US')} ج.م`
}
