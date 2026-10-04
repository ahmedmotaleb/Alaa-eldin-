import type { StagedProductImage } from '../components/PendingProductImages'

// بعد إنشاء منتج جديد، أي صورة فشل رفعها بعد الحفظ لازم تتحمل لصفحة التعديل (الأدمن بيتنقل
// لها فوراً بعد الحفظ دايماً، سواء الصور اترفعت بنجاح أو لأ — راجع ProductFormPage.save()).
// الـ File objects نفسها (ومعاينتها المحلية blob URL) لازم تستمر عبر التنقل ده من غير أي
// serialization (مينفعش تتخزن في sessionStorage/localStorage) — متغيّر وحدة واحد في الذاكرة
// كافٍ تماماً لأن التنقل كله SPA من غير أي reload حقيقي للصفحة.
export interface PendingUploadOutcome {
  failed: StagedProductImage[]
  hadImages: boolean
}

const pending = new Map<string, PendingUploadOutcome>()

export function setPendingUploadOutcome(productId: string, outcome: PendingUploadOutcome) {
  pending.set(productId, outcome)
}

// بتُقرأ مرة واحدة بس — القراءة بتمسح القيمة فوراً، عشان أي mount تاني لاحق لنفس الصفحة
// (رجوع بالـ back button مثلاً) ما يكررش عرض نفس الحالة القديمة.
export function takePendingUploadOutcome(productId: string): PendingUploadOutcome | null {
  const outcome = pending.get(productId)
  if (outcome) pending.delete(productId)
  return outcome ?? null
}
