import { isNative } from './platform'
import { getNativeSessionToken, setNativeSessionToken, clearNativeSessionToken } from './nativeSession'

// الويب (تطوير وإنتاج) بيستخدم مسار نسبي (/api) على نفس الأصل دايماً — مفيش أي تغيير هنا.
// تطبيق الأندرويد (Capacitor) بيحمّل الواجهة من ملفات محلية جوه الـ APK (مش من نفس أصل
// السيرفر)، فلازم رابط API مطلق بصيغة HTTPS كامل. القيمة دي بتتحدد وقت البناء عن طريق
// VITE_API_BASE_URL (راجع .env.example) — مفيش أي رابط localhost مثبّت هنا لبيئة الإنتاج.
const BASE = isNative()
  ? `${(import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')}/api`
  : '/api'

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
  // على الأندرويد، الكوكيز اللي بيحطها السيرفر (أصل مختلف تماماً) ما بترجعش على طلبات
  // JS تالية أصلاً — فبنعتمد بدلها على Authorization: Bearer <token> المخزّن محلياً بعد
  // تسجيل الدخول. الويب يفضل زي ما هو تماماً (كوكيز httpOnly، من غير أي Authorization header).
  const nativeHeaders: Record<string, string> = {}
  if (isNative()) {
    nativeHeaders['X-Client-Platform'] = 'android'
    const token = getNativeSessionToken()
    if (token) nativeHeaders.Authorization = `Bearer ${token}`
  }

  let res: Response
  try {
    res = await fetch(BASE + path, {
      credentials: 'include',
      ...options,
      headers: { 'Content-Type': 'application/json', ...nativeHeaders, ...(options.headers ?? {}) }
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
  orderNumber: string
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
  primaryImage?: string
  primaryImageAlt?: string
}

export interface ApiContentPage {
  slug: string
  title: string
  content: string
}

export interface ApiAlternativeProduct {
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
    request<{ user: ApiUser, token?: string }>('/auth/register', { method: 'POST', body: JSON.stringify(body) })
      .then(res => { if (isNative() && res.token) setNativeSessionToken(res.token); return res }),
  login: (body: { email: string, password: string }) =>
    request<{ user: ApiUser, token?: string }>('/auth/login', { method: 'POST', body: JSON.stringify(body) })
      .then(res => { if (isNative() && res.token) setNativeSessionToken(res.token); return res }),
  logout: () => request<void>('/auth/logout', { method: 'POST' }).finally(() => { if (isNative()) clearNativeSessionToken() }),
  me: () => request<{ user: ApiUser }>('/auth/me'),
  forgotPassword: (email: string) => request<void>('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) }),
  resetPassword: (token: string, password: string) =>
    request<void>('/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, password }) }),
  listCategories: () => request<{ categories: ApiCategory[] }>('/categories'),
  listProducts: () => request<{ products: ApiProduct[] }>('/products'),
  listBanners: () => request<{ banners: ApiBanner[] }>('/banners'),
  getSettings: () => request<{ settings: ApiSettings }>('/settings'),
  getPage: (slug: string) => request<{ page: ApiContentPage }>(`/pages/${encodeURIComponent(slug)}`),
  getAlternatives: (productId: string) => request<{ alternatives: ApiAlternativeProduct[] }>(`/products/${encodeURIComponent(productId)}/alternatives`),
  listOrders: () => request<{ orders: ApiOrder[], pagination: { page: number, limit: number, total: number, pages: number } }>('/orders'),
  getOrder: (orderNumber: string) => request<{ order: ApiOrder }>(`/orders/${encodeURIComponent(orderNumber)}`),
  // السيرفر هو اللي بيحسب كل حاجة (سعر الوحدة، الإجمالي الفرعي، الخصم، التوصيل، الإجمالي
  // النهائي) وبيولّد id ورقم الطلب — العميل بيبعت بس المعلومات الأساسية المطلوبة فعلاً.
  // idempotencyKey ثابت لكل محاولة دفع (مش بيتغيّر لو نفس الطلب اتبعت تاني بسبب retry/timeout)
  // عشان لو نفس الطلب اتنفذ فعلياً على السيرفر قبل كده، يرجعله نفس الطلب بدل ما يتكرر.
  createOrder: (body: {
    deliverySlot: string
    paymentMethod: string
    customer: { fullName: string, mobile: string, governorate: string, address: string }
    items: { productId: string, quantity: number }[]
    discountCode?: string
  }, idempotencyKey: string) =>
    request<{ order: ApiOrder }>('/orders', {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(body)
    }),
  validateDiscount: (code: string, subtotal: number) =>
    request<{ discount: ApiDiscount }>('/discounts/validate', { method: 'POST', body: JSON.stringify({ code, subtotal }) })
}
