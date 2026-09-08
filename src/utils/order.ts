import { getSettings } from '../store/settingsStore'
import { deliverySlots } from '../data/deliverySlots'
import type { Order } from '../types/models'
import { formatMoney } from './money'
import { ar } from '../i18n/ar'

function slotLabel(slotId: Order['deliverySlot']) {
  return deliverySlots.find(s => s.id === slotId)?.label ?? slotId
}

export function buildWhatsAppOrderMessage(order: Order) {
  const msg = ar.order.whatsappMessage
  const items = order.items
    .map((item, index) =>
      `${index + 1}. ${item.name} — ${item.quantity} × ${formatMoney(item.unitPrice)} = ${formatMoney(item.lineTotal)}`
    )
    .join('\n')

  return [
    msg.newOrderFrom(getSettings().name),
    msg.orderNumber(order.orderNumber),
    '',
    msg.productsHeading,
    items,
    '',
    msg.subtotal(formatMoney(order.subtotal)),
    order.discountCode ? msg.discount(order.discountCode, formatMoney(order.discountAmount)) : '',
    msg.delivery(order.deliveryFee === 0 ? msg.free : formatMoney(order.deliveryFee)),
    msg.total(formatMoney(order.total)),
    '',
    msg.name(order.customer.fullName),
    msg.mobile(order.customer.mobile),
    msg.governorate(order.customer.governorate),
    msg.address(order.customer.address),
    msg.deliverySlot(slotLabel(order.deliverySlot)),
    msg.payment
  ].filter(Boolean).join('\n')
}

export function buildWhatsAppUrl(order: Order) {
  const text = buildWhatsAppOrderMessage(order)
  return `https://wa.me/${getSettings().whatsappNumber}?text=${encodeURIComponent(text)}`
}
