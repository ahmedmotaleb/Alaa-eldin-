import { pool } from './db.js'

export interface OrderItemDTO {
  id: number
  productId: string
  name: string
  unit: string
  unitPrice: number
  quantity: number
  lineTotal: number
}

// استعلام واحد لكل عناصر أي عدد من الطلبات، بدل استعلام منفصل لكل طلب (N+1). بيُستخدم
// من قايمة طلبات العميل ولوحة التحكم، ولو طلب واحد بس (GET /orders/:id) — نفس الدالة،
// مصفوفة من عنصر واحد.
export async function fetchItemsForOrders(orderIds: string[]): Promise<Map<string, OrderItemDTO[]>> {
  const map = new Map<string, OrderItemDTO[]>()
  if (orderIds.length === 0) return map

  const { rows } = await pool.query<OrderItemDTO & { orderId: string }>(
    `SELECT id, order_id as "orderId", product_id as "productId", name, unit, unit_price as "unitPrice", quantity, line_total as "lineTotal"
     FROM order_items WHERE order_id = ANY($1::text[])`,
    [orderIds]
  )

  for (const { orderId, ...item } of rows) {
    if (!map.has(orderId)) map.set(orderId, [])
    map.get(orderId)!.push(item)
  }
  return map
}
