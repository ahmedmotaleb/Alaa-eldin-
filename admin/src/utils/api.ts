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

export type UserRole = 'staff' | 'admin'

export interface AdminUser {
  id: string
  email: string
  fullName: string
  createdAt: string
  isAdmin: boolean
  role: UserRole
}

export interface PageInfo {
  page: number
  limit: number
  total: number
  totalPages: number
}

function buildQuery(params: Record<string, string | number | undefined>): string {
  const qs = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') qs.set(key, String(value))
  }
  const query = qs.toString()
  return query ? `?${query}` : ''
}

export interface AdminOrderItem {
  id: number
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
  tracksExpiry: boolean
  defaultShelfLifeDays: number | null
  sku: string | null
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

export interface AdminSupplier {
  id: string
  name: string
  contactPerson: string
  mobile: string
  whatsapp: string
  email: string
  address: string
  taxNumber: string
  notes: string
  active: boolean
  createdAt: string
  updatedAt: string
}

export type AdminSupplierInput = Omit<AdminSupplier, 'id' | 'active' | 'createdAt' | 'updatedAt'>

export interface AdminSupplierProduct {
  id: string
  supplierId: string
  productId: string
  supplierSku: string
  lastCost: number | null
  leadTimeDays: number | null
  minimumOrderQty: number | null
  preferred: boolean
  createdAt: string
  updatedAt: string
}

export type PurchaseOrderStatus = 'draft' | 'submitted' | 'partially_received' | 'received' | 'cancelled'

export interface AdminPurchaseOrder {
  id: string
  poNumber: string
  supplierId: string
  supplierName: string
  status: PurchaseOrderStatus
  expectedDate: string | null
  notes: string
  subtotal: number
  discount: number
  shippingCost: number
  total: number
  createdByUserId: string | null
  createdAt: string
  updatedAt: string
}

export interface AdminPurchaseOrderItem {
  id: string
  purchaseOrderId: string
  productId: string
  productName: string
  orderedQty: number
  receivedQty: number
  unitCost: number
  lineTotal: number
}

export interface PurchaseOrderItemInput {
  productId: string
  orderedQty: number
  unitCost: number
}

export interface PurchaseOrderInput {
  supplierId: string
  expectedDate?: string | null
  notes?: string
  discount?: number
  shippingCost?: number
  items: PurchaseOrderItemInput[]
}

export interface AdminGoodsReceipt {
  id: string
  receiptNumber: string
  purchaseOrderId: string
  poNumber: string
  supplierId: string
  supplierName: string
  receivedByUserId: string | null
  receivedAt: string
  notes: string
}

export interface AdminGoodsReceiptItem {
  id: string
  goodsReceiptId: string
  productId: string
  productName: string
  quantity: number
  unitCost: number
  batchNumber: string | null
  expiryDate: string | null
  manufacturedDate: string | null
}

export interface ReceiveItemInput {
  productId: string
  quantity: number
  unitCost: number
  batchNumber?: string | null
  expiryDate?: string | null
  manufacturedDate?: string | null
}

export interface ReceiveGoodsInput {
  purchaseOrderId: string
  items: ReceiveItemInput[]
  notes?: string
}

export interface ExpiryBatchRow {
  batchId: string
  productId: string
  productName: string
  batchNumber: string | null
  quantityRemaining: number
  unitCost: number
  expiryDate: string
  daysRemaining: number
  costValueAtRisk: number
}

export interface ExpiryDashboard {
  expired: ExpiryBatchRow[]
  within7Days: ExpiryBatchRow[]
  within30Days: ExpiryBatchRow[]
  within60Days: ExpiryBatchRow[]
}

export type WriteOffReason = 'expired' | 'damaged' | 'lost' | 'inventory_adjustment' | 'supplier_return'

export type SupplierReturnStatus = 'draft' | 'approved' | 'sent' | 'completed' | 'cancelled'

export interface AdminSupplierReturn {
  id: string
  returnNumber: string
  supplierId: string
  supplierName: string
  purchaseOrderId: string | null
  status: SupplierReturnStatus
  reason: string
  createdByUserId: string | null
  createdAt: string
  updatedAt: string
}

export interface AdminSupplierReturnItem {
  id: string
  supplierReturnId: string
  productId: string
  productName: string
  batchId: string | null
  quantity: number
  unitCost: number
}

export interface SupplierReturnItemInput {
  productId: string
  batchId?: string | null
  quantity: number
  unitCost?: number
}

export interface SupplierReturnInput {
  supplierId: string
  purchaseOrderId?: string | null
  reason?: string
  items: SupplierReturnItemInput[]
}

export type CustomerReturnStatus = 'requested' | 'approved' | 'received' | 'refunded' | 'rejected' | 'cancelled'
export type ReturnItemCondition = 'return_to_stock' | 'damaged' | 'expired' | 'discard'

export interface AdminCustomerReturn {
  id: string
  returnNumber: string
  orderId: string
  orderNumber: string
  customerId: string | null
  status: CustomerReturnStatus
  reason: string
  notes: string
  refundAmount: number
  createdByUserId: string | null
  createdAt: string
  updatedAt: string
}

export interface AdminCustomerReturnItem {
  id: string
  customerReturnId: string
  productId: string
  productName: string
  orderItemId: number
  quantity: number
  condition: ReturnItemCondition
  refundAmount: number
}

export interface CustomerReturnItemInput {
  orderItemId: number
  productId: string
  quantity: number
  condition?: ReturnItemCondition
}

export interface CustomerReturnInput {
  orderId: string
  reason?: string
  notes?: string
  items: CustomerReturnItemInput[]
}

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

export interface AnalyticsRevenueDay {
  date: string
  revenue: number
  orderCount: number
}

export interface AnalyticsCategoryRevenue {
  categoryId: string
  categoryName: string
  revenue: number
}

export interface AnalyticsProductRevenue {
  productId: string
  name: string
  qty: number
  revenue: number
}

export interface AnalyticsSlotRevenue {
  slot: string
  count: number
  revenue: number
}

export interface AnalyticsRegionRevenue {
  governorate: string
  count: number
  revenue: number
}

export interface AnalyticsStatusCount {
  status: string
  count: number
}

export interface AnalyticsOverview {
  totalRevenue: number
  totalOrders: number
  avgOrderValue: number
  revenueByDay: AnalyticsRevenueDay[]
  revenueByCategory: AnalyticsCategoryRevenue[]
}

export interface AnalyticsSales {
  totalRevenue: number
  avgOrderValue: number
  maxOrderValue: number
  revenueByDay: AnalyticsRevenueDay[]
  revenueBySlot: AnalyticsSlotRevenue[]
}

export interface AnalyticsProducts {
  soldProductCount: number
  totalProductCount: number
  topProducts: AnalyticsProductRevenue[]
  revenueByCategory: AnalyticsCategoryRevenue[]
}

export interface AnalyticsRegions {
  regions: AnalyticsRegionRevenue[]
}

export interface AnalyticsOrdersBreakdown {
  totalOrders: number
  cancelledCount: number
  avgItemsPerOrder: number
  statusCounts: AnalyticsStatusCount[]
}

export interface AnalyticsHomeSummary {
  todayRevenue: number
  todayOrderCount: number
  totalOrders: number
  newOrdersCount: number
  revenueByDay: AnalyticsRevenueDay[]
  topProducts: AnalyticsProductRevenue[]
}

export const api = {
  login: (body: { email: string, password: string }) =>
    request<{ user: AdminUser }>('/auth/login', { method: 'POST', body: JSON.stringify(body) }),
  logout: () => request<void>('/auth/logout', { method: 'POST' }),
  me: () => request<{ user: AdminUser }>('/auth/me'),
  listOrders: (params: { limit?: number } = {}) =>
    request<{ orders: AdminOrder[] }>(`/admin/orders${params.limit ? `?limit=${params.limit}` : ''}`),
  getOrder: (id: string) => request<{ order: AdminOrder }>(`/admin/orders/${encodeURIComponent(id)}`),
  updateOrderStatus: (id: string, status: AdminOrderStatus) =>
    request<void>(`/admin/orders/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  setOrderRider: (id: string, riderId: string | null) =>
    request<void>(`/admin/orders/${encodeURIComponent(id)}/rider`, { method: 'PATCH', body: JSON.stringify({ riderId }) }),
  listProducts: (params: { page?: number, limit?: number, search?: string, categoryId?: string } = {}) =>
    request<{ products: AdminProduct[] } & Partial<PageInfo>>(`/admin/products${buildQuery(params)}`),
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
  listCustomers: (params: { page?: number, limit?: number, search?: string } = {}) =>
    request<{ customers: AdminCustomer[] } & Partial<PageInfo>>(`/admin/customers${buildQuery(params)}`),
  getCustomer: (id: string) =>
    request<{ customer: AdminCustomer, orders: AdminCustomerOrder[] }>(`/admin/customers/${encodeURIComponent(id)}`),
  listDiscounts: (params: { page?: number, limit?: number, search?: string } = {}) =>
    request<{ discounts: AdminDiscount[] } & Partial<PageInfo>>(`/admin/discounts${buildQuery(params)}`),
  createDiscount: (body: AdminDiscountInput) =>
    request<{ discount: AdminDiscount }>('/admin/discounts', { method: 'POST', body: JSON.stringify(body) }),
  updateDiscount: (code: string, body: Partial<AdminDiscountInput>) =>
    request<{ discount: AdminDiscount }>(`/admin/discounts/${encodeURIComponent(code)}`, { method: 'PATCH', body: JSON.stringify(body) }),
  listSuppliers: (params: { search?: string, activeOnly?: boolean } = {}) =>
    request<{ suppliers: AdminSupplier[] }>(`/admin/suppliers${buildQuery({ search: params.search, activeOnly: params.activeOnly ? 'true' : undefined })}`),
  getSupplier: (id: string) =>
    request<{ supplier: AdminSupplier, products: AdminSupplierProduct[] }>(`/admin/suppliers/${encodeURIComponent(id)}`),
  createSupplier: (body: AdminSupplierInput) =>
    request<{ supplier: AdminSupplier }>('/admin/suppliers', { method: 'POST', body: JSON.stringify(body) }),
  updateSupplier: (id: string, body: AdminSupplierInput) =>
    request<{ supplier: AdminSupplier }>(`/admin/suppliers/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }),
  setSupplierActive: (id: string, active: boolean) =>
    request<{ supplier: AdminSupplier }>(`/admin/suppliers/${encodeURIComponent(id)}/active`, { method: 'PATCH', body: JSON.stringify({ active }) }),
  linkSupplierProduct: (supplierId: string, productId: string, body: Partial<Omit<AdminSupplierProduct, 'id' | 'supplierId' | 'productId' | 'createdAt' | 'updatedAt'>>) =>
    request<{ link: AdminSupplierProduct }>(`/admin/suppliers/${encodeURIComponent(supplierId)}/products/${encodeURIComponent(productId)}`, { method: 'PUT', body: JSON.stringify(body) }),
  unlinkSupplierProduct: (supplierId: string, productId: string) =>
    request<void>(`/admin/suppliers/${encodeURIComponent(supplierId)}/products/${encodeURIComponent(productId)}`, { method: 'DELETE' }),
  listPurchaseOrders: (params: { status?: PurchaseOrderStatus, supplierId?: string, search?: string } = {}) =>
    request<{ orders: AdminPurchaseOrder[] }>(`/admin/purchase-orders${buildQuery(params)}`),
  getPurchaseOrder: (id: string) =>
    request<{ order: AdminPurchaseOrder, items: AdminPurchaseOrderItem[] }>(`/admin/purchase-orders/${encodeURIComponent(id)}`),
  createPurchaseOrder: (body: PurchaseOrderInput) =>
    request<{ order: AdminPurchaseOrder }>('/admin/purchase-orders', { method: 'POST', body: JSON.stringify(body) }),
  updatePurchaseOrder: (id: string, body: PurchaseOrderInput) =>
    request<{ order: AdminPurchaseOrder }>(`/admin/purchase-orders/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }),
  setPurchaseOrderStatus: (id: string, status: PurchaseOrderStatus) =>
    request<{ order: AdminPurchaseOrder }>(`/admin/purchase-orders/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  listGoodsReceipts: (params: { purchaseOrderId?: string } = {}) =>
    request<{ receipts: AdminGoodsReceipt[] }>(`/admin/goods-receipts${buildQuery(params)}`),
  getGoodsReceipt: (id: string) =>
    request<{ receipt: AdminGoodsReceipt, items: AdminGoodsReceiptItem[] }>(`/admin/goods-receipts/${encodeURIComponent(id)}`),
  receiveGoods: (body: ReceiveGoodsInput) =>
    request<{ receipt: AdminGoodsReceipt, items: AdminGoodsReceiptItem[] }>('/admin/goods-receipts', { method: 'POST', body: JSON.stringify(body) }),
  getExpiryDashboard: () => request<ExpiryDashboard>('/admin/inventory-batches/expiry'),
  setProductExpirySettings: (id: string, body: { tracksExpiry: boolean, defaultShelfLifeDays: number | null }) =>
    request<{ product: AdminProduct }>(`/admin/products/${encodeURIComponent(id)}/expiry-settings`, { method: 'PATCH', body: JSON.stringify(body) }),
  setProductSku: (id: string, sku: string | null) =>
    request<{ id: string, sku: string | null }>(`/admin/products/${encodeURIComponent(id)}/sku`, { method: 'PATCH', body: JSON.stringify({ sku }) }),
  generateProductSku: (id: string) =>
    request<{ id: string, sku: string | null }>(`/admin/products/${encodeURIComponent(id)}/generate-sku`, { method: 'POST' }),
  findProductByBarcode: (barcode: string) =>
    request<{ product: { id: string, name: string, barcode: string, sku: string | null, stock: number, price: number, emoji: string } }>(`/admin/products/by-barcode/${encodeURIComponent(barcode)}`),
  writeOffStock: (body: { productId: string, quantity: number, reason: WriteOffReason, note?: string, batchId?: string }) =>
    request<{ newStock: number }>('/admin/stock-write-offs', { method: 'POST', body: JSON.stringify(body) }),
  listSupplierReturns: (params: { status?: SupplierReturnStatus, supplierId?: string } = {}) =>
    request<{ returns: AdminSupplierReturn[] }>(`/admin/supplier-returns${buildQuery(params)}`),
  getSupplierReturn: (id: string) =>
    request<{ supplierReturn: AdminSupplierReturn, items: AdminSupplierReturnItem[] }>(`/admin/supplier-returns/${encodeURIComponent(id)}`),
  createSupplierReturn: (body: SupplierReturnInput) =>
    request<{ supplierReturn: AdminSupplierReturn }>('/admin/supplier-returns', { method: 'POST', body: JSON.stringify(body) }),
  setSupplierReturnStatus: (id: string, status: SupplierReturnStatus) =>
    request<{ supplierReturn: AdminSupplierReturn }>(`/admin/supplier-returns/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  listCustomerReturns: (params: { status?: CustomerReturnStatus, orderId?: string } = {}) =>
    request<{ returns: AdminCustomerReturn[] }>(`/admin/customer-returns${buildQuery(params)}`),
  getCustomerReturn: (id: string) =>
    request<{ customerReturn: AdminCustomerReturn, items: AdminCustomerReturnItem[] }>(`/admin/customer-returns/${encodeURIComponent(id)}`),
  createCustomerReturn: (body: CustomerReturnInput) =>
    request<{ customerReturn: AdminCustomerReturn }>('/admin/customer-returns', { method: 'POST', body: JSON.stringify(body) }),
  setCustomerReturnStatus: (id: string, status: CustomerReturnStatus) =>
    request<{ customerReturn: AdminCustomerReturn }>(`/admin/customer-returns/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  listStockMovements: (params: { page?: number, limit?: number, search?: string, productId?: string, type?: StockMovementType } = {}) =>
    request<{ movements: AdminStockMovement[] } & Partial<PageInfo>>(`/admin/stock-movements${buildQuery(params)}`),
  createStockMovement: (body: { productId: string, type: StockMovementType, quantityChange: number, note?: string }) =>
    request<{ movement: AdminStockMovement, newStock: number }>('/admin/stock-movements', { method: 'POST', body: JSON.stringify(body) }),
  listUsers: (params: { page?: number, limit?: number, search?: string } = {}) =>
    request<{ users: AdminUser[] } & Partial<PageInfo>>(`/admin/users${buildQuery(params)}`),
  setUserAdmin: (id: string, isAdmin: boolean) =>
    request<{ user: AdminUser }>(`/admin/users/${encodeURIComponent(id)}/admin`, { method: 'PATCH', body: JSON.stringify({ isAdmin }) }),
  setUserRole: (id: string, role: UserRole) =>
    request<{ user: AdminUser }>(`/admin/users/${encodeURIComponent(id)}/role`, { method: 'PATCH', body: JSON.stringify({ role }) }),
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
  getAnalyticsOverview: () => request<AnalyticsOverview>('/admin/analytics/overview'),
  getAnalyticsSales: () => request<AnalyticsSales>('/admin/analytics/sales'),
  getAnalyticsProducts: () => request<AnalyticsProducts>('/admin/analytics/products'),
  getAnalyticsRegions: () => request<AnalyticsRegions>('/admin/analytics/regions'),
  getAnalyticsOrdersBreakdown: () => request<AnalyticsOrdersBreakdown>('/admin/analytics/orders-breakdown'),
  getAnalyticsHomeSummary: () => request<AnalyticsHomeSummary>('/admin/analytics/home-summary'),
  listRiders: () => request<{ riders: AdminRider[] }>('/admin/riders'),
  createRider: (body: { name: string, phone?: string }) =>
    request<{ rider: AdminRider }>('/admin/riders', { method: 'POST', body: JSON.stringify(body) }),
  updateRider: (id: string, body: Partial<Pick<AdminRider, 'name' | 'phone' | 'active'>>) =>
    request<{ rider: AdminRider }>(`/admin/riders/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }),
  listSettlements: (params: { page?: number, limit?: number } = {}) =>
    request<{ settlements: AdminSettlement[] } & Partial<PageInfo>>(`/admin/settlements${buildQuery(params)}`),
  createSettlement: (riderId: string) =>
    request<{ settlement: AdminSettlement }>('/admin/settlements', { method: 'POST', body: JSON.stringify({ riderId }) }),
  listExpenses: (params: { page?: number, limit?: number } = {}) =>
    request<{ expenses: AdminExpense[] } & Partial<PageInfo>>(`/admin/expenses${buildQuery(params)}`),
  createExpense: (body: AdminExpenseInput) =>
    request<{ expense: AdminExpense }>('/admin/expenses', { method: 'POST', body: JSON.stringify(body) }),
  updateExpense: (id: number, body: Partial<AdminExpenseInput>) =>
    request<{ expense: AdminExpense }>(`/admin/expenses/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteExpense: (id: number) => request<void>(`/admin/expenses/${id}`, { method: 'DELETE' })
}
