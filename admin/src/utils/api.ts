const BASE = '/api'

export class ApiError extends Error {
  code: string
  status: number
  constructor(code: string, status: number) {
    super(code)
    this.code = code
    this.status = status
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(BASE + path, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
      ...options
    })
  } catch {
    throw new ApiError('network_error', 0)
  }

  if (res.status === 204) return undefined as T

  const data = await res.json().catch(() => null)
  if (!res.ok) throw new ApiError(data?.error ?? 'server_error', res.status)
  return data as T
}

export interface AdminUser {
  id: string
  email: string
  fullName: string
  createdAt: string
  isAdmin: boolean
}

export interface AdminOrderItem {
  productId: string
  name: string
  unit: string
  unitPrice: number
  quantity: number
  lineTotal: number
}

export type AdminOrderStatus = 'placed' | 'preparing' | 'ready_for_delivery' | 'out_for_delivery' | 'delivered' | 'cancelled'

export interface AdminOrder {
  id: string
  orderNumber: string
  createdAt: string
  deliverySlot: string
  paymentMethod: string
  customer: { fullName: string, mobile: string, governorate: string, address: string }
  accountEmail: string | null
  items: AdminOrderItem[]
  subtotal: number
  deliveryFee: number
  total: number
  status: AdminOrderStatus
  discountCode?: string
  discountAmount: number
  riderId: string | null
  riderName: string | null
  settlementId: number | null
}

export interface AdminRider {
  id: string
  name: string
  phone: string
  active: boolean
  createdAt: string
}

export interface AdminSettlement {
  id: number
  riderId: string
  riderName: string
  amount: number
  orderCount: number
  createdAt: string
}

export interface AdminExpense {
  id: number
  category: string
  amount: number
  note: string
  expenseDate: string
  createdAt: string
}

export type AdminExpenseInput = Omit<AdminExpense, 'id' | 'createdAt'>

export interface AdminCategory {
  id: string
  name: string
  emoji: string
  tint: string
  image?: string
  productCount: number
}

export interface AdminProduct {
  id: string
  slug: string
  categoryId: string
  name: string
  description: string
  price: number
  oldPrice?: number
  cost: number
  unit: string
  emoji: string
  available: boolean
  bestseller: boolean
  offer: boolean
  orderCount: number
  stock: number
  alertThreshold: number
  barcode: string
  brand: string
  primaryImage?: string
}

export type AdminProductInput = Omit<AdminProduct, 'orderCount'>

export interface AdminProductImage {
  id: string
  productId: string
  imageUrl: string
  altText: string
  sortOrder: number
  isPrimary: boolean
}

export interface AdminAuditLog {
  id: number
  adminUserId: string | null
  adminEmail: string | null
  action: string
  entityType: string
  entityId: string
  oldValues: unknown
  newValues: unknown
  createdAt: string
}

export interface AdminAlternativeProduct {
  id: string
  slug: string
  name: string
  price: number
  oldPrice?: number
  unit: string
  emoji: string
  available: boolean
  primaryImage?: string
}

export interface AdminContentPage {
  id: number
  slug: string
  title: string
  content: string
  active: boolean
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface AdminCustomer {
  id: string
  email: string
  fullName: string
  createdAt: string
  orderCount: number
  totalSpent: number
  lastOrderAt: string | null
  lastMobile: string | null
}

export interface AdminCustomerOrder {
  id: string
  createdAt: string
  total: number
  status: AdminOrderStatus
}

export interface AdminDiscount {
  code: string
  type: 'percentage' | 'fixed'
  value: number
  minOrder: number
  maxUses: number | null
  usedCount: number
  active: boolean
  expiresAt: string | null
  createdAt: string
}

export type AdminDiscountInput = Omit<AdminDiscount, 'usedCount' | 'createdAt'>

// 'sale' و'cancel_restore' مُنشآن تلقائياً فقط من نظام الطلبات (checkout / إلغاء طلب) —
// مش قيم قابلة للإنشاء اليدوي من نموذج "تسجيل حركة" في هذه اللوحة (راجع StockMovesPage).
export type StockMovementType = 'restock' | 'return' | 'damage' | 'loss' | 'adjustment' | 'sale' | 'cancel_restore'

export interface AdminStockMovement {
  id: number
  productId: string
  type: StockMovementType
  quantityChange: number
  note: string
  createdAt: string
  productName: string
  productEmoji: string
}

export interface AdminBanner {
  id: number
  kicker: string
  title: string
  note: string
  emoji: string
  imageUrl?: string
  mobileImageUrl?: string
  altText: string
  ctaLabel: string
  link: string
  active: boolean
  sortOrder: number
  startsAt?: string
  endsAt?: string
}

export type AdminBannerInput = Omit<AdminBanner, 'id' | 'sortOrder' | 'imageUrl' | 'mobileImageUrl'>

export interface AdminSettings {
  name: string
  whatsappNumber: string
  currency: string
  minimumOrder: number
  freeShippingThreshold: number
  deliveryFee: number
  showTodaysOffers: boolean
  showBestSellers: boolean
  codEnabled: boolean
  showExactLowStock: boolean
}

export interface AdminDeliveryZone {
  governorate: string
  deliveryFee: number
  isActive: boolean
  sortOrder: number
}

export interface AdminDeliverySlot {
  id: string
  label: string
  note: string
  isActive: boolean
  sortOrder: number
}

export const api = {
  login: (body: { email: string, password: string }) =>
    request<{ user: AdminUser }>('/auth/login', { method: 'POST', body: JSON.stringify(body) }),
  logout: () => request<void>('/auth/logout', { method: 'POST' }),
  me: () => request<{ user: AdminUser }>('/auth/me'),
  listOrders: () => request<{ orders: AdminOrder[] }>('/admin/orders'),
  getOrder: (id: string) => request<{ order: AdminOrder }>(`/admin/orders/${encodeURIComponent(id)}`),
  updateOrderStatus: (id: string, status: AdminOrderStatus) =>
    request<void>(`/admin/orders/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  setOrderRider: (id: string, riderId: string | null) =>
    request<void>(`/admin/orders/${encodeURIComponent(id)}/rider`, { method: 'PATCH', body: JSON.stringify({ riderId }) }),
  listProducts: () => request<{ products: AdminProduct[] }>('/admin/products'),
  getProduct: (id: string) => request<{ product: AdminProduct }>(`/admin/products/${encodeURIComponent(id)}`),
  createProduct: (body: AdminProductInput) =>
    request<{ product: AdminProduct }>('/admin/products', { method: 'POST', body: JSON.stringify(body) }),
  updateProduct: (id: string, body: Partial<AdminProductInput>) =>
    request<{ product: AdminProduct }>(`/admin/products/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }),
  listProductImages: (productId: string) =>
    request<{ images: AdminProductImage[] }>(`/admin/products/${encodeURIComponent(productId)}/images`),
  uploadProductImage: async (productId: string, file: File, altText?: string) => {
    const form = new FormData()
    form.append('image', file)
    if (altText) form.append('altText', altText)
    let res: Response
    try {
      res = await fetch(`${BASE}/admin/products/${encodeURIComponent(productId)}/images`, {
        method: 'POST',
        credentials: 'include',
        body: form
      })
    } catch {
      throw new ApiError('network_error', 0)
    }
    const data = await res.json().catch(() => null)
    if (!res.ok) throw new ApiError(data?.error ?? 'server_error', res.status)
    return data as { image: AdminProductImage }
  },
  setPrimaryProductImage: (productId: string, imageId: string) =>
    request<{ image: AdminProductImage }>(`/admin/products/${encodeURIComponent(productId)}/images/${encodeURIComponent(imageId)}`, {
      method: 'PATCH', body: JSON.stringify({ isPrimary: true })
    }),
  updateProductImageAlt: (productId: string, imageId: string, altText: string) =>
    request<{ image: AdminProductImage }>(`/admin/products/${encodeURIComponent(productId)}/images/${encodeURIComponent(imageId)}`, {
      method: 'PATCH', body: JSON.stringify({ altText })
    }),
  reorderProductImages: (productId: string, order: string[]) =>
    request<{ images: AdminProductImage[] }>(`/admin/products/${encodeURIComponent(productId)}/images/reorder`, {
      method: 'PUT', body: JSON.stringify({ order })
    }),
  deleteProductImage: (productId: string, imageId: string) =>
    request<void>(`/admin/products/${encodeURIComponent(productId)}/images/${encodeURIComponent(imageId)}`, { method: 'DELETE' }),
  listProductAlternatives: (productId: string) =>
    request<{ alternatives: AdminAlternativeProduct[] }>(`/admin/products/${encodeURIComponent(productId)}/alternatives`),
  addProductAlternative: (productId: string, alternativeProductId: string) =>
    request<{ alternatives: AdminAlternativeProduct[] }>(`/admin/products/${encodeURIComponent(productId)}/alternatives`, {
      method: 'POST', body: JSON.stringify({ alternativeProductId })
    }),
  removeProductAlternative: (productId: string, alternativeProductId: string) =>
    request<void>(`/admin/products/${encodeURIComponent(productId)}/alternatives/${encodeURIComponent(alternativeProductId)}`, { method: 'DELETE' }),
  listAuditLogs: (page = 1, limit = 20) =>
    request<{ logs: AdminAuditLog[], page: number, limit: number, total: number, totalPages: number }>(
      `/admin/audit-logs?page=${page}&limit=${limit}`
    ),
  listPages: () => request<{ pages: AdminContentPage[] }>('/admin/pages'),
  getPage: (id: number) => request<{ page: AdminContentPage }>(`/admin/pages/${id}`),
  updatePage: (id: number, body: { title: string, content: string, active: boolean }) =>
    request<{ page: AdminContentPage }>(`/admin/pages/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  listCategories: () => request<{ categories: AdminCategory[] }>('/admin/categories'),
  createCategory: (body: { id: string, name: string, emoji: string, tint: string }) =>
    request<{ category: AdminCategory }>('/admin/categories', { method: 'POST', body: JSON.stringify(body) }),
  uploadCategoryImage: async (categoryId: string, file: File) => {
    const form = new FormData()
    form.append('image', file)
    let res: Response
    try {
      res = await fetch(`${BASE}/admin/categories/${encodeURIComponent(categoryId)}/image`, {
        method: 'POST',
        credentials: 'include',
        body: form
      })
    } catch {
      throw new ApiError('network_error', 0)
    }
    const data = await res.json().catch(() => null)
    if (!res.ok) throw new ApiError(data?.error ?? 'server_error', res.status)
    return data as { image: string }
  },
  deleteCategoryImage: (categoryId: string) =>
    request<void>(`/admin/categories/${encodeURIComponent(categoryId)}/image`, { method: 'DELETE' }),
  listCustomers: () => request<{ customers: AdminCustomer[] }>('/admin/customers'),
  getCustomer: (id: string) =>
    request<{ customer: AdminCustomer, orders: AdminCustomerOrder[] }>(`/admin/customers/${encodeURIComponent(id)}`),
  listDiscounts: () => request<{ discounts: AdminDiscount[] }>('/admin/discounts'),
  createDiscount: (body: AdminDiscountInput) =>
    request<{ discount: AdminDiscount }>('/admin/discounts', { method: 'POST', body: JSON.stringify(body) }),
  updateDiscount: (code: string, body: Partial<AdminDiscountInput>) =>
    request<{ discount: AdminDiscount }>(`/admin/discounts/${encodeURIComponent(code)}`, { method: 'PATCH', body: JSON.stringify(body) }),
  listStockMovements: () => request<{ movements: AdminStockMovement[] }>('/admin/stock-movements'),
  createStockMovement: (body: { productId: string, type: StockMovementType, quantityChange: number, note?: string }) =>
    request<{ movement: AdminStockMovement, newStock: number }>('/admin/stock-movements', { method: 'POST', body: JSON.stringify(body) }),
  listUsers: () => request<{ users: AdminUser[] }>('/admin/users'),
  setUserAdmin: (id: string, isAdmin: boolean) =>
    request<{ user: AdminUser }>(`/admin/users/${encodeURIComponent(id)}/admin`, { method: 'PATCH', body: JSON.stringify({ isAdmin }) }),
  listBanners: () => request<{ banners: AdminBanner[] }>('/admin/banners'),
  getBanner: (id: number) => request<{ banner: AdminBanner }>(`/admin/banners/${id}`),
  createBanner: (body: AdminBannerInput) =>
    request<{ banner: AdminBanner }>('/admin/banners', { method: 'POST', body: JSON.stringify(body) }),
  updateBanner: (id: number, body: Partial<AdminBannerInput>) =>
    request<{ banner: AdminBanner }>(`/admin/banners/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  uploadBannerImage: async (id: number, file: File, variant: 'desktop' | 'mobile' = 'desktop') => {
    const form = new FormData()
    form.append('image', file)
    let res: Response
    try {
      res = await fetch(`${BASE}/admin/banners/${id}/image?variant=${variant}`, { method: 'POST', credentials: 'include', body: form })
    } catch {
      throw new ApiError('network_error', 0)
    }
    const data = await res.json().catch(() => null)
    if (!res.ok) throw new ApiError(data?.error ?? 'server_error', res.status)
    return data as { image: string }
  },
  deleteBannerImage: (id: number, variant: 'desktop' | 'mobile' = 'desktop') =>
    request<void>(`/admin/banners/${id}/image?variant=${variant}`, { method: 'DELETE' }),
  getSettings: () => request<{ settings: AdminSettings }>('/admin/settings'),
  updateSettings: (body: Partial<AdminSettings>) =>
    request<{ settings: AdminSettings }>('/admin/settings', { method: 'PATCH', body: JSON.stringify(body) }),
  listDeliveryZones: () => request<{ zones: AdminDeliveryZone[] }>('/admin/delivery/zones'),
  updateDeliveryZone: (governorate: string, body: { deliveryFee: number, isActive: boolean }) =>
    request<{ zone: AdminDeliveryZone }>(`/admin/delivery/zones/${encodeURIComponent(governorate)}`, { method: 'PATCH', body: JSON.stringify(body) }),
  listDeliverySlots: () => request<{ slots: AdminDeliverySlot[] }>('/admin/delivery/slots'),
  createDeliverySlot: (body: { id: string, label: string, note: string, isActive: boolean }) =>
    request<{ slot: AdminDeliverySlot }>('/admin/delivery/slots', { method: 'POST', body: JSON.stringify(body) }),
  updateDeliverySlot: (id: string, body: { label: string, note: string, isActive: boolean }) =>
    request<{ slot: AdminDeliverySlot }>(`/admin/delivery/slots/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }),
  listRiders: () => request<{ riders: AdminRider[] }>('/admin/riders'),
  createRider: (body: { name: string, phone?: string }) =>
    request<{ rider: AdminRider }>('/admin/riders', { method: 'POST', body: JSON.stringify(body) }),
  updateRider: (id: string, body: Partial<Pick<AdminRider, 'name' | 'phone' | 'active'>>) =>
    request<{ rider: AdminRider }>(`/admin/riders/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }),
  listSettlements: () => request<{ settlements: AdminSettlement[] }>('/admin/settlements'),
  createSettlement: (riderId: string) =>
    request<{ settlement: AdminSettlement }>('/admin/settlements', { method: 'POST', body: JSON.stringify({ riderId }) }),
  listExpenses: () => request<{ expenses: AdminExpense[] }>('/admin/expenses'),
  createExpense: (body: AdminExpenseInput) =>
    request<{ expense: AdminExpense }>('/admin/expenses', { method: 'POST', body: JSON.stringify(body) }),
  updateExpense: (id: number, body: Partial<AdminExpenseInput>) =>
    request<{ expense: AdminExpense }>(`/admin/expenses/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteExpense: (id: number) => request<void>(`/admin/expenses/${id}`, { method: 'DELETE' })
}
