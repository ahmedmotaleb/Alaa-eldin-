import { pool } from './db.js'

export type PickedStatus = 'pending' | 'picked' | 'substituted' | 'unavailable'

export interface OrderItemDTO {
  id: number
  productId: string
  name: string
  unit: string
  unitPrice: number
  quantity: number
  lineTotal: number
  pickedStatus: PickedStatus
  pickedNote: string
}

// استعلام واحد لكل عناصر أي عدد من الطلبات، بدل استعلام منفصل لكل طلب (N+1). بيُستخدم
// من قايمة طلبات العميل ولوحة التحكم، ولو طلب واحد بس (GET /orders/:id) — نفس الدالة،
// مصفوفة من عنصر واحد. حالة التجهيز (pickedStatus/pickedNote) ظاهرة للعميل كمان عمداً —
// هي أساس "الإيصال الحقيقي" اللي بيوضح له لو حصل استبدال أو نقص فعلي وقت التجهيز.
export async function fetchItemsForOrders(orderIds: string[]): Promise<Map<string, OrderItemDTO[]>> {
  const map = new Map<string, OrderItemDTO[]>()
  if (orderIds.length === 0) return map

  const { rows } = await pool.query<OrderItemDTO & { orderId: string }>(
    `SELECT id, order_id as "orderId", product_id as "productId", name, unit, unit_price as "unitPrice", quantity, line_total as "lineTotal",
            picked_status as "pickedStatus", picked_note as "pickedNote"
     FROM order_items WHERE order_id = ANY($1::text[])`,
    [orderIds]
  )

  for (const { orderId, ...item } of rows) {
    if (!map.has(orderId)) map.set(orderId, [])
    map.get(orderId)!.push(item)
  }
  return map
}
