export type ProductUnit = string

export interface Category {
  id: string
  name: string
  emoji: string
  tint: string
  image?: string
  productCount: number
}

export type StockState = 'in_stock' | 'low_stock' | 'out_of_stock'

// نسخة خفيفة من المنتج (بيانات الكارت فقط) — من غير الوصف الكامل، ده بيوصل بس من خلال
// صفحة تفاصيل المنتج (ProductDetail) عشان مانحملش بيانات زيادة عن اللازم في القوائم/الشبكة.
export interface Product {
  id: string
  slug: string
  categoryId: string
  name: string
  price: number
  oldPrice?: number
  unit: ProductUnit
  available: boolean
  stockState: StockState
  lowStockRemaining?: number
  emoji: string
  bestseller?: boolean
  offer?: boolean
  orderCount?: number
  primaryImage?: string
  primaryImageAlt?: string
  brand?: string
}

export interface ProductGalleryImage {
  id: string
  url: string
  altText: string
  isPrimary: boolean
  sortOrder: number
}

export interface ProductDetail {
  id: string
  slug: string
  categoryId: string
  categoryName: string
  name: string
  description: string
  price: number
  oldPrice?: number
  unit: ProductUnit
  emoji: string
  brand: string
  available: boolean
  stockState: StockState
  lowStockRemaining?: number
  gallery: ProductGalleryImage[]
  similarProducts: Product[]
}

export interface CartItem {
  productId: string
  quantity: number
}

// المواعيد بقت مُدارة من السيرفر (جدول delivery_slots) بدل قايمة ثابتة في الكود — أي معرّف
// نصي ممكن يبقى ميعاد فعلي حالياً أو في المستقبل، مفيش قايمة مغلقة من 3 قيم تحديداً بعد كده.
export type DeliverySlotId = string

export interface DeliverySlot {
  id: DeliverySlotId
  label: string
  note: string
  available: boolean
}

export interface DeliveryZone {
  governorate: string
  deliveryFee: number
}

export interface CustomerDetails {
  fullName: string
  mobile: string
  governorate: string
  address: string
}

export type PickedStatus = 'pending' | 'picked' | 'substituted' | 'unavailable'

export interface OrderLine {
  productId: string
  name: string
  unit: string
  unitPrice: number
  quantity: number
  lineTotal: number
  pickedStatus: PickedStatus
  pickedNote: string
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
  deliveryInstructions?: string
}
