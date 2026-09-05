import { STORE_CONFIG } from '../config/store'
import type { Order } from '../types/models'
import { formatMoney } from './money'

export function createOrderId() {
  const stamp = Date.now().toString().slice(-7)
  return `ع-${stamp}`
}

export function buildWhatsAppOrderMessage(order: Order) {
  const items = order.items
    .map((item, index) =>
      `${index + 1}. ${item.name} — ${item.quantity} × ${formatMoney(item.unitPrice)} = ${formatMoney(item.lineTotal)}`
    )
    .join('\n')

  return [
    `طلب جديد من ${STORE_CONFIG.name}`,
    `رقم الطلب: ${order.id}`,
    '',
    'المنتجات:',
    items,
    '',
    `الإجمالي الفرعي: ${formatMoney(order.subtotal)}`,
    `التوصيل: ${order.deliveryFee === 0 ? 'مجاني' : formatMoney(order.deliveryFee)}`,
    `الإجمالي: ${formatMoney(order.total)}`,
    '',
    `الاسم: ${order.customer.fullName}`,
    `الموبايل: ${order.customer.mobile}`,
    `المنطقة: ${order.customer.area}`,
    `العنوان: ${order.customer.address}`,
    order.customer.landmark ? `علامة مميزة: ${order.customer.landmark}` : '',
    order.customer.notes ? `ملاحظات: ${order.customer.notes}` : '',
    `موعد التوصيل: ${order.deliverySlot}`,
    'الدفع: الدفع عند الاستلام'
  ].filter(Boolean).join('\n')
}

export function buildWhatsAppUrl(order: Order) {
  const text = buildWhatsAppOrderMessage(order)
  return `https://wa.me/${STORE_CONFIG.whatsappNumber}?text=${encodeURIComponent(text)}`
}
