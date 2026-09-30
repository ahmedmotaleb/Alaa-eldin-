const DISMISSED_KEY = 'alaa-eldin-dismissed-promo-banner-id'

// بيتفعّل مرة واحدة بس لكل حملة (معرّف البانر) لكل جهاز — لو الإدارة غيّرت البانر (id جديد)،
// البوب-أب بيظهر تاني حتى لو حملة سابقة اتقفلت قبل كده. نفس مبدأ hasOnboarded/markOnboarded.
export function isPromoBannerDismissed(bannerId: number): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === String(bannerId)
  } catch {
    return false
  }
}

export function markPromoBannerDismissed(bannerId: number) {
  try {
    localStorage.setItem(DISMISSED_KEY, String(bannerId))
  } catch {
    // مساحة التخزين مش متاحة، تجاهل — أسوأ حالة البوب-أب يظهر تاني، مش خطأ حرج
  }
}
