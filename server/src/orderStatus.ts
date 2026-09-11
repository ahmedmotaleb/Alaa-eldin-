export const ORDER_STATUSES = ['placed', 'preparing', 'ready_for_delivery', 'out_for_delivery', 'delivered', 'cancelled'] as const
export type OrderStatus = typeof ORDER_STATUSES[number]

// حالتين نهائيتين: لما الطلب "تم التسليم" أو "ملغى"، مينفعش يرجع لأي حالة تانية.
const TERMINAL_STATUSES: OrderStatus[] = ['delivered', 'cancelled']

// آلة حالات صريحة (state machine) — كل حالة نشطة بتحدد بالظبط الحالات المسموح تتحول لها:
// خطوة واحدة للأمام في المسار الطبيعي، أو إلغاء. مفيش تخطي خطوة (زي preparing مباشرة
// لـ out_for_delivery) ومفيش رجوع للخلف (زي out_for_delivery لـ preparing) — أي تصحيح
// لازم يبقى مسار موثّق منفصل (مفيش واحد حالياً)، مش مجرد قبول أي انتقال بين حالتين نشطتين.
const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  placed: ['preparing', 'cancelled'],
  preparing: ['ready_for_delivery', 'cancelled'],
  ready_for_delivery: ['out_for_delivery', 'cancelled'],
  // إلغاء طلب خرج بالفعل للتوصيل مسموح (المندوب ممكن يرجع بالطلب لأسباب تشغيلية) — قرار
  // عمل صريح، مش سهو، لحد ما تتغيّر سياسة التشغيل الفعلية.
  out_for_delivery: ['delivered', 'cancelled'],
  delivered: [],
  cancelled: []
}

export function isValidOrderStatus(value: unknown): value is OrderStatus {
  return typeof value === 'string' && (ORDER_STATUSES as readonly string[]).includes(value)
}

export function canTransitionOrderStatus(from: OrderStatus, to: OrderStatus): boolean {
  // نفس الحالة مسموحة كعملية بدون تأثير (idempotent) — بس مفيش سجل تاريخ جديد بيتكتب لها
  // (راجع orderStatusHistoryService.ts).
  if (from === to) return true
  if (TERMINAL_STATUSES.includes(from)) return false
  return ALLOWED_TRANSITIONS[from].includes(to)
}
