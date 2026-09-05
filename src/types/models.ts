export type ProductUnit = 'كيلو' | 'عبوة' | 'قطعة' | 'زجاجة' | 'كرتونة'

export interface Category {
  id: string
  name: string
  emoji: string
  image?: string
}

export interface Product {
  id: string
  slug: string
  categoryId: string
  name: string
  description: string
  price: number
  oldPrice?: number
  unit: ProductUnit
  available: boolean
  image: string
  bestseller?: boolean
  offer?: boolean
  newArrival?: boolean
  orderCount?: number
}

export interface CartItem {
  productId: string
  quantity: number
}

export type DeliverySlot = 'أقرب وقت' | 'اليوم مساءً' | 'غداً صباحاً'

export interface CustomerDetails {
  fullName: string
  mobile: string
  area: string
  address: string
  landmark?: string
  notes?: string
}

export interface OrderLine {
  productId: string
  name: string
  unit: string
  unitPrice: number
  quantity: number
  lineTotal: number
}

export interface Order {
  id: string
  createdAt: string
  customer: CustomerDetails
  deliverySlot: DeliverySlot
  paymentMethod: 'الدفع عند الاستلام'
  items: OrderLine[]
  subtotal: number
  deliveryFee: number
  total: number
}
