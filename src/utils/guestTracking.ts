const STORAGE_KEY = 'alaaeldin_guest_tracking'

// بيسمح للزائر (من غير تسجيل دخول) إنه يرجع يتابع طلبه بعد ما يقفل صفحة التأكيد،
// من غير ما يحتاج يحتفظ بالرابط بنفسه — التوكن مخزّن محلياً على جهازه بس.
export function saveGuestTracking(orderNumber: string, token: string) {
  try {
    const map = readMap()
    map[orderNumber] = token
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
  } catch {
    // localStorage غير متاح — تجاهل، مش حاجة حرجة
  }
}

export function getGuestTrackingToken(orderNumber: string): string | null {
  try {
    return readMap()[orderNumber] ?? null
  } catch {
    return null
  }
}

function readMap(): Record<string, string> {
  const raw = localStorage.getItem(STORAGE_KEY)
  return raw ? JSON.parse(raw) as Record<string, string> : {}
}
