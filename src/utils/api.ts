const BASE = '/api'

export class ApiError extends Error {
  code: string
  status: number
  data: Record<string, unknown>
  constructor(code: string, status: number, data: Record<string, unknown> = {}) {
    super(code)
    this.code = code
    this.status = status
    this.data = data
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
  if (!res.ok) throw new ApiError(data?.error ?? 'server_error', res.status, data ?? {})
  return data as T
}

export interface ApiUser {
  id: string
  email: string
  fullName: string
  createdAt: string
  isAdmin: boolean
}

export interface ApiOrderItem {
  productId: string
  name: string
  unit: string
  unitPrice: number
  quantity: number
  lineTotal: number
}

export interface ApiOrder {
  id: string
  createdAt: string
  deliverySlot: string
  paymentMethod: string
  customer: { fullName: string, mobile: string, governorate: string, address: string }
  items: ApiOrderItem[]
  subtotal: number
  deliveryFee: number
  total: number
  status: 'placed' | 'preparing' | 'ready_for_delivery' | 'out_for_delivery' | 'delivered' | 'cancelled'
  discountCode?: string
  discountAmount: number
}

export interface ApiCategory {
  id: string
  name: string
  emoji: string
  tint: string
}

export interface ApiDiscount {
  code: string
  type: 'percentage' | 'fixed'
  value: number
  amount: number
}

export interface ApiProduct {
  id: string
  slug: string
  categoryId: string
  name: string
  description: string
  price: number
  oldPrice?: number
  unit: string
  emoji: string
  available: boolean
  bestseller: boolean
  offer: boolean
  orderCount: number
}

export interface ApiBanner {
  id: number
  kicker: string
  title: string
  note: string
  emoji: string
  ctaLabel: string
  link: string
}

export interface ApiSettings {
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
  register: (body: { email: string, password: string, fullName: string }) =>
    request<{ user: ApiUser }>('/auth/register', { method: 'POST', body: JSON.stringify(body) }),
  login: (body: { email: string, password: string }) =>
    request<{ user: ApiUser }>('/auth/login', { method: 'POST', body: JSON.stringify(body) }),
  logout: () => request<void>('/auth/logout', { method: 'POST' }),
  me: () => request<{ user: ApiUser }>('/auth/me'),
  forgotPassword: (email: string) => request<void>('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) }),
  resetPassword: (token: string, password: string) =>
    request<void>('/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, password }) }),
  listCategories: () => request<{ categories: ApiCategory[] }>('/categories'),
  listProducts: () => request<{ products: ApiProduct[] }>('/products'),
  listBanners: () => request<{ banners: ApiBanner[] }>('/banners'),
  getSettings: () => request<{ settings: ApiSettings }>('/settings'),
  listOrders: () => request<{ orders: ApiOrder[] }>('/orders'),
  getOrder: (id: string) => request<{ order: ApiOrder }>(`/orders/${encodeURIComponent(id)}`),
  createOrder: (body: Omit<ApiOrder, 'createdAt' | 'status' | 'discountAmount'>) =>
    request<{ order: ApiOrder }>('/orders', { method: 'POST', body: JSON.stringify(body) }),
  validateDiscount: (code: string, subtotal: number) =>
    request<{ discount: ApiDiscount }>('/discounts/validate', { method: 'POST', body: JSON.stringify({ code, subtotal }) })
}
