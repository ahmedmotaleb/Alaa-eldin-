import { pool } from '../db.js'
import { NORMALIZE_SQL } from '../textSearch.js'
import type { Permission } from './permissionService.js'

export type SearchEntityType = 'products' | 'orders' | 'customers' | 'suppliers' | 'purchase_orders' | 'support_tickets'

export const ALL_SEARCH_ENTITY_TYPES: SearchEntityType[] =
  ['products', 'orders', 'customers', 'suppliers', 'purchase_orders', 'support_tickets']

// أي صلاحية محتاجة عشان النوع ده يظهر في نتائج البحث الشامل — السيرفر هو اللي بيقرر مش
// الواجهة، وأي نوع مش مسموح بيه المستخدم بيتشال من الاستعلامات خالص (مش بس يتخفي في العرض).
export const ENTITY_PERMISSION: Record<SearchEntityType, Permission> = {
  products: 'products.view',
  orders: 'orders.view',
  customers: 'customers.view',
  suppliers: 'purchases.view',
  purchase_orders: 'purchases.view',
  support_tickets: 'support.view'
}

export const MIN_QUERY_LENGTH = 2
const RESULT_LIMIT = 5

export interface ProductSearchResult {
  type: 'products'
  id: string
  name: string
  price: number
  stock: number
  categoryName: string
  url: string
}

export interface OrderSearchResult {
  type: 'orders'
  id: string
  orderNumber: string
  status: string
  customerFullName: string
  total: number
  createdAt: string
  url: string
}

export interface CustomerSearchResult {
  type: 'customers'
  id: string
  fullName: string
  email: string
  mobile: string | null
  url: string
}

export interface SupplierSearchResult {
  type: 'suppliers'
  id: string
  name: string
  mobile: string
  url: string
}

export interface PurchaseOrderSearchResult {
  type: 'purchase_orders'
  id: string
  poNumber: string
  supplierName: string
  status: string
  total: number
  createdAt: string
  url: string
}

export interface SupportTicketSearchResult {
  type: 'support_tickets'
  id: string
  ticketNumber: string
  customerFullName: string
  status: string
  relatedOrderNumber: string | null
  url: string
}

export type SearchResultItem =
  | ProductSearchResult | OrderSearchResult | CustomerSearchResult | SupplierSearchResult | PurchaseOrderSearchResult
  | SupportTicketSearchResult

// $1 = تطابق تام (بدون % — case-insensitive عن طريق ILIKE)، $2 = "يبدأ بـ"، $3 = "يحتوي على".
// الترتيب المطلوب: تطابق تام > بادئة > نص مُطبَّع > أي مطابقة تانية (fuzzy عن طريق فهارس trgm).
function termParams(term: string): [string, string, string] {
  return [term, `${term}%`, `%${term}%`]
}

async function searchProducts(term: string): Promise<ProductSearchResult[]> {
  const { rows } = await pool.query<Omit<ProductSearchResult, 'type' | 'url'> & { id: string }>(
    `SELECT p.id, p.name, p.price, p.stock, c.name as "categoryName"
     FROM products p
     JOIN categories c ON c.id = p.category_id
     WHERE p.barcode ILIKE $3 OR p.sku ILIKE $3
        OR ${NORMALIZE_SQL('p.name')} ILIKE ${NORMALIZE_SQL('$3')}
        OR ${NORMALIZE_SQL('p.brand')} ILIKE ${NORMALIZE_SQL('$3')}
        OR EXISTS (
          SELECT 1 FROM product_variants v
          WHERE v.product_id = p.id
            AND (v.barcode ILIKE $3 OR v.sku ILIKE $3 OR ${NORMALIZE_SQL('v.name')} ILIKE ${NORMALIZE_SQL('$3')})
        )
     ORDER BY
       CASE
         WHEN p.barcode ILIKE $1 OR p.sku ILIKE $1 THEN 0
         WHEN p.barcode ILIKE $2 OR p.sku ILIKE $2 THEN 1
         WHEN ${NORMALIZE_SQL('p.name')} ILIKE ${NORMALIZE_SQL('$2')} THEN 2
         ELSE 3
       END ASC,
       p.name ASC
     LIMIT ${RESULT_LIMIT}`,
    termParams(term)
  )
  return rows.map(r => ({ type: 'products', ...r, url: `/products/edit/${r.id}` }))
}

async function searchOrders(term: string): Promise<OrderSearchResult[]> {
  const { rows } = await pool.query<Omit<OrderSearchResult, 'type' | 'url'> & { id: string }>(
    `SELECT o.id, o.order_number as "orderNumber", o.status, o.customer_full_name as "customerFullName",
            o.total, o.created_at as "createdAt"
     FROM orders o
     WHERE o.order_number ILIKE $3 OR o.customer_mobile ILIKE $3
        OR ${NORMALIZE_SQL('o.customer_full_name')} ILIKE ${NORMALIZE_SQL('$3')}
     ORDER BY
       CASE
         WHEN o.order_number ILIKE $1 OR o.customer_mobile ILIKE $1 THEN 0
         WHEN o.order_number ILIKE $2 THEN 1
         WHEN ${NORMALIZE_SQL('o.customer_full_name')} ILIKE ${NORMALIZE_SQL('$2')} THEN 2
         ELSE 3
       END ASC,
       o.created_at DESC
     LIMIT ${RESULT_LIMIT}`,
    termParams(term)
  )
  return rows.map(r => ({ type: 'orders', ...r, url: `/orders/all?highlight=${r.id}` }))
}

async function searchCustomers(term: string): Promise<CustomerSearchResult[]> {
  const { rows } = await pool.query<Omit<CustomerSearchResult, 'type' | 'url'> & { id: string }>(
    `SELECT u.id, u.full_name as "fullName", u.email, u.mobile
     FROM users u
     WHERE u.is_admin = 0
       AND (u.mobile ILIKE $3 OR u.email ILIKE $3 OR ${NORMALIZE_SQL('u.full_name')} ILIKE ${NORMALIZE_SQL('$3')})
     ORDER BY
       CASE
         WHEN u.mobile ILIKE $1 OR u.email ILIKE $1 THEN 0
         WHEN u.mobile ILIKE $2 OR u.email ILIKE $2 THEN 1
         WHEN ${NORMALIZE_SQL('u.full_name')} ILIKE ${NORMALIZE_SQL('$2')} THEN 2
         ELSE 3
       END ASC,
       u.full_name ASC
     LIMIT ${RESULT_LIMIT}`,
    termParams(term)
  )
  return rows.map(r => ({ type: 'customers', ...r, url: `/customers/${r.id}` }))
}

async function searchSuppliers(term: string): Promise<SupplierSearchResult[]> {
  const { rows } = await pool.query<Omit<SupplierSearchResult, 'type' | 'url'> & { id: string }>(
    `SELECT s.id, s.name, s.mobile
     FROM suppliers s
     WHERE s.mobile ILIKE $3 OR s.whatsapp ILIKE $3 OR ${NORMALIZE_SQL('s.name')} ILIKE ${NORMALIZE_SQL('$3')}
     ORDER BY
       CASE
         WHEN s.mobile ILIKE $1 THEN 0
         WHEN s.mobile ILIKE $2 THEN 1
         WHEN ${NORMALIZE_SQL('s.name')} ILIKE ${NORMALIZE_SQL('$2')} THEN 2
         ELSE 3
       END ASC,
       s.name ASC
     LIMIT ${RESULT_LIMIT}`,
    termParams(term)
  )
  return rows.map(r => ({ type: 'suppliers', ...r, url: `/purchasing/suppliers/edit/${r.id}` }))
}

async function searchPurchaseOrders(term: string): Promise<PurchaseOrderSearchResult[]> {
  const { rows } = await pool.query<Omit<PurchaseOrderSearchResult, 'type' | 'url'> & { id: string }>(
    `SELECT po.id, po.po_number as "poNumber", s.name as "supplierName", po.status, po.total,
            po.created_at as "createdAt"
     FROM purchase_orders po
     JOIN suppliers s ON s.id = po.supplier_id
     WHERE po.po_number ILIKE $3 OR ${NORMALIZE_SQL('s.name')} ILIKE ${NORMALIZE_SQL('$3')}
     ORDER BY
       CASE
         WHEN po.po_number ILIKE $1 THEN 0
         WHEN po.po_number ILIKE $2 THEN 1
         WHEN ${NORMALIZE_SQL('s.name')} ILIKE ${NORMALIZE_SQL('$2')} THEN 2
         ELSE 3
       END ASC,
       po.created_at DESC
     LIMIT ${RESULT_LIMIT}`,
    termParams(term)
  )
  return rows.map(r => ({ type: 'purchase_orders', ...r, url: `/purchasing/orders/edit/${r.id}` }))
}

async function searchSupportTickets(term: string): Promise<SupportTicketSearchResult[]> {
  const { rows } = await pool.query<Omit<SupportTicketSearchResult, 'type' | 'url'> & { id: string }>(
    `SELECT t.id, t.ticket_number as "ticketNumber", u.full_name as "customerFullName", t.status,
            o.order_number as "relatedOrderNumber"
     FROM support_tickets t
     JOIN users u ON u.id = t.customer_id
     LEFT JOIN orders o ON o.id = t.related_order_id
     WHERE t.ticket_number ILIKE $3 OR o.order_number ILIKE $3
        OR ${NORMALIZE_SQL('u.full_name')} ILIKE ${NORMALIZE_SQL('$3')}
     ORDER BY
       CASE
         WHEN t.ticket_number ILIKE $1 OR o.order_number ILIKE $1 THEN 0
         WHEN t.ticket_number ILIKE $2 THEN 1
         WHEN ${NORMALIZE_SQL('u.full_name')} ILIKE ${NORMALIZE_SQL('$2')} THEN 2
         ELSE 3
       END ASC,
       t.created_at DESC
     LIMIT ${RESULT_LIMIT}`,
    termParams(term)
  )
  return rows.map(r => ({ type: 'support_tickets', ...r, url: `/support/tickets/${r.id}` }))
}

const SEARCH_FUNCTIONS: Record<SearchEntityType, (term: string) => Promise<SearchResultItem[]>> = {
  products: searchProducts,
  orders: searchOrders,
  customers: searchCustomers,
  suppliers: searchSuppliers,
  purchase_orders: searchPurchaseOrders,
  support_tickets: searchSupportTickets
}

export async function globalSearch(
  term: string,
  requestedTypes: SearchEntityType[],
  grantedPermissions: Set<Permission>
): Promise<Partial<Record<SearchEntityType, SearchResultItem[]>>> {
  if (term.length < MIN_QUERY_LENGTH) return {}

  const allowedTypes = requestedTypes.filter(t => grantedPermissions.has(ENTITY_PERMISSION[t]))
  const entries = await Promise.all(
    allowedTypes.map(async type => [type, await SEARCH_FUNCTIONS[type](term)] as const)
  )
  return Object.fromEntries(entries.filter(([, results]) => results.length > 0))
}
