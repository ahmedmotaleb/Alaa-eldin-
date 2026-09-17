import { pool } from './db.js'

export type PickedStatus = 'pending' | 'picked' | 'substituted' | 'unavailable'
export type SubstitutionStatus = 'none' | 'proposed' | 'approved' | 'rejected'

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
  substitutionStatus: SubstitutionStatus
  replacementProductId: string | null
  replacementName: string | null
  replacementUnit: string | null
  replacementQuantity: number | null
  replacementUnitPrice: number | null
  replacementLineTotal: number | null
  variantId: string | null
  variantName: string | null
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
            picked_status as "pickedStatus", picked_note as "pickedNote", substitution_status as "substitutionStatus",
            replacement_product_id as "replacementProductId", NULLIF(replacement_name, '') as "replacementName",
            NULLIF(replacement_unit, '') as "replacementUnit", replacement_quantity as "replacementQuantity",
            replacement_unit_price as "replacementUnitPrice", replacement_line_total as "replacementLineTotal",
            variant_id as "variantId", variant_name as "variantName"
     FROM order_items WHERE order_id = ANY($1::text[])`,
    [orderIds]
  )

  for (const { orderId, ...item } of rows) {
    if (!map.has(orderId)) map.set(orderId, [])
    map.get(orderId)!.push(item)
  }
  return map
}
