import type { AdminOrderStatus } from './utils/api'

export const ORDER_STATUS_LABEL: Record<AdminOrderStatus, string> = {
  placed: 'جديد',
  preparing: 'جاري التجهيز',
  ready_for_delivery: 'جاهز للتوصيل',
  out_for_delivery: 'خرج للتوصيل',
  delivered: 'تم التسليم',
  cancelled: 'ملغي'
}

export const ORDER_STATUS_COLOR: Record<AdminOrderStatus, [string, string]> = {
  placed: ['#EAF2FF', '#1D4ED8'],
  preparing: ['#FFF3E3', '#B45309'],
  ready_for_delivery: ['#F3EEFB', '#7C3AED'],
  out_for_delivery: ['#EAF8EF', '#12813C'],
  delivered: ['#F1F4F2', '#68746B'],
  cancelled: ['#FFF0EF', '#B42318']
}

export const ORDER_STATUS_ORDER: AdminOrderStatus[] = ['placed', 'preparing', 'ready_for_delivery', 'out_for_delivery', 'delivered', 'cancelled']
