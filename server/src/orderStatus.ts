export const ORDER_STATUSES = ['placed', 'preparing', 'ready_for_delivery', 'out_for_delivery', 'delivered', 'cancelled'] as const
export type OrderStatus = typeof ORDER_STATUSES[number]

// حالتين نهائيتين: لما الطلب "تم التسليم" أو "ملغى"، مينفعش يرجع لأي حالة تانية —
// تحديداً بيمنع cancelled -> delivered وdelivered -> cancelled المذكورين صراحة.
const TERMINAL_STATUSES: OrderStatus[] = ['delivered', 'cancelled']

export function isValidOrderStatus(value: unknown): value is OrderStatus {
  return typeof value === 'string' && (ORDER_STATUSES as readonly string[]).includes(value)
}

export function canTransitionOrderStatus(from: OrderStatus, to: OrderStatus): boolean {
  if (from === to) return true
  return !TERMINAL_STATUSES.includes(from)
}
