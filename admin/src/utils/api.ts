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
}

export type AdminProductInput = Omit<AdminProduct, 'orderCount'>

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

export type StockMovementType = 'restock' | 'return' | 'damage' | 'loss' | 'adjustment'

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
  ctaLabel: string
  link: string
  active: boolean
  sortOrder: number
}

export type AdminBannerInput = Omit<AdminBanner, 'id' | 'sortOrder'>

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
  listCategories: () => request<{ categories: AdminCategory[] }>('/admin/categories'),
  createCategory: (body: { id: string, name: string, emoji: string, tint: string }) =>
    request<{ category: AdminCategory }>('/admin/categories', { method: 'POST', body: JSON.stringify(body) }),
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
  getSettings: () => request<{ settings: AdminSettings }>('/admin/settings'),
  updateSettings: (body: Partial<AdminSettings>) =>
    request<{ settings: AdminSettings }>('/admin/settings', { method: 'PATCH', body: JSON.stringify(body) }),
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
