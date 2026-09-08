import type { DeliverySlot } from '../types/models'

export const deliverySlots: DeliverySlot[] = [
  { id: 'now', label: 'أقرب وقت (خلال ساعتين)', note: 'اليوم قبل 8 مساءً' },
  { id: 'evening', label: 'اليوم مساءً — 6:00 إلى 9:00', note: 'مناسب لو مش موجود دلوقتي' },
  { id: 'tomorrow', label: 'بكرة صباحاً — 9:00 إلى 12:00', note: 'توصيل مجاني على الطلبات فوق 500 ج.م' }
]
