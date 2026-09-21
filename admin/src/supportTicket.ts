export type TicketStatus = 'open' | 'in_progress' | 'waiting_customer' | 'resolved' | 'closed'
export type TicketPriority = 'low' | 'normal' | 'high' | 'urgent'
export type TicketCategory =
  | 'order_issue' | 'missing_item' | 'damaged_item' | 'wrong_item'
  | 'delivery_issue' | 'refund_request' | 'payment_issue' | 'account_issue'
  | 'suggestion' | 'other'

export const TICKET_STATUS_LABEL: Record<TicketStatus, string> = {
  open: 'مفتوحة',
  in_progress: 'قيد المتابعة',
  waiting_customer: 'بانتظار العميل',
  resolved: 'تم الحل',
  closed: 'مغلقة'
}

export const TICKET_STATUS_COLOR: Record<TicketStatus, [string, string]> = {
  open: ['#EAF2FF', '#1D4ED8'],
  in_progress: ['#FFF3E3', '#B45309'],
  waiting_customer: ['#F3EEFB', '#7C3AED'],
  resolved: ['#EAF8EF', '#12813C'],
  closed: ['#F1F4F2', '#68746B']
}

export const TICKET_STATUS_ORDER: TicketStatus[] = ['open', 'in_progress', 'waiting_customer', 'resolved', 'closed']

export const TICKET_PRIORITY_LABEL: Record<TicketPriority, string> = {
  low: 'منخفضة',
  normal: 'عادية',
  high: 'عالية',
  urgent: 'عاجلة'
}
export const TICKET_PRIORITY_ORDER: TicketPriority[] = ['low', 'normal', 'high', 'urgent']

export const TICKET_CATEGORY_LABEL: Record<TicketCategory, string> = {
  order_issue: 'مشكلة في الطلب',
  missing_item: 'منتج ناقص',
  damaged_item: 'منتج تالف',
  wrong_item: 'منتج خاطئ',
  delivery_issue: 'مشكلة في التوصيل',
  refund_request: 'استرجاع / استرداد',
  payment_issue: 'مشكلة في الدفع',
  account_issue: 'مشكلة في الحساب',
  suggestion: 'اقتراح',
  other: 'أخرى'
}
export const TICKET_CATEGORY_ORDER: TicketCategory[] = [
  'order_issue', 'missing_item', 'damaged_item', 'wrong_item',
  'delivery_issue', 'refund_request', 'payment_issue', 'account_issue', 'suggestion', 'other'
]
