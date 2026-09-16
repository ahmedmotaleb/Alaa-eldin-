// تتبّع "شوهد مؤخراً" بالكامل محلي (localStorage) — يشتغل للزائر وللعميل المسجّل بنفس
// الطريقة، من غير ما يحتاج تسجيل دخول أو أي طلب سيرفر إضافي. السعر/التوفر الحالي بيتحقق
// منه دايماً وقت العرض عبر /api/products/resolve الموجود بالفعل (نفس الـ endpoint
// المستخدم لإعادة التحقق من السلة)، مش مخزّن هنا أبداً.
const STORAGE_KEY = 'recently_viewed_products_v1'
const MAX_ITEMS = 20

function readIds(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

function writeIds(ids: string[]) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids))
  } catch {
    // تخزين ممتلئ أو وضع خاص يمنع localStorage — الميزة اختيارية بحتة، تجاهل بصمت.
  }
}

// بيسجّل مشاهدة منتج: يحطه في الأول، يشيل أي تكرار سابق ليه، ويقصّ القايمة عند الحد
// الأقصى المعقول عشان القايمة متكبرش من غير حد.
export function recordProductView(productId: string) {
  const current = readIds()
  const next = [productId, ...current.filter(id => id !== productId)].slice(0, MAX_ITEMS)
  writeIds(next)
}

export function getRecentlyViewedIds(): string[] {
  return readIds()
}

// بيتنادى بعد استيثاق المنتجات من السيرفر — أي منتج مرجعش في الرد (يعني اتحذف فعلياً أو
// اتوقف بيعه نهائياً) بيتشال تلقائياً من القايمة المحلية، عشان مايفضلش يتحاول عرضه تاني.
export function pruneRecentlyViewed(stillExistingIds: Set<string>) {
  const current = readIds()
  const next = current.filter(id => stillExistingIds.has(id))
  if (next.length !== current.length) writeIds(next)
}
