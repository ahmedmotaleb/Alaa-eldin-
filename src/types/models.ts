export type ProductUnit = string

export interface Category {
  id: string
  name: string
  emoji: string
  tint: string
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
  emoji: string
  bestseller?: boolean
  offer?: boolean
  orderCount?: number
}

export interface CartItem {
  productId: string
  quantity: number
}

export type DeliverySlotId = 'now' | 'evening' | 'tomorrow'

export interface DeliverySlot {
  id: DeliverySlotId
  label: string
  note: string
}

export interface CustomerDetails {
  fullName: string
  mobile: string
  governorate: string
  address: string
}

export interface OrderLine {
  productId: string
  name: string
  unit: string
  unitPrice: number
  quantity: number
  lineTotal: number
}

export type OrderStatus = 'placed' | 'preparing' | 'ready_for_delivery' | 'out_for_delivery' | 'delivered' | 'cancelled'

export interface Order {
  id: string
  orderNumber: string
  createdAt: string
  customer: CustomerDetails
  deliverySlot: DeliverySlotId
  paymentMethod: string
  items: OrderLine[]
  subtotal: number
  deliveryFee: number
  total: number
  status: OrderStatus
  discountCode?: string
  discountAmount: number
}
