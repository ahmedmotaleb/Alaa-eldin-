import { pool } from '../db.js'
import type { PickedStatus } from '../orderItems.js'

const VALID_STATUSES: PickedStatus[] = ['pending', 'picked', 'substituted', 'unavailable']

export function isValidPickedStatus(value: unknown): value is PickedStatus {
  return typeof value === 'string' && (VALID_STATUSES as string[]).includes(value)
}

// بتتحقق إن العنصر بالفعل تابع للطلب ده (مش أي order_item id عشوائي) قبل التحديث — حماية
// من تعديل عنصر طلب تاني بالغلط أو عمداً.
export async function setItemPickedStatus(
  orderId: string,
  itemId: number,
  status: PickedStatus,
  note: string
): Promise<{ ok: true } | { error: 'item_not_found' }> {
  const { rowCount } = await pool.query(
    'UPDATE order_items SET picked_status = $1, picked_note = $2 WHERE id = $3 AND order_id = $4',
    [status, note.trim(), itemId, orderId]
  )
  if (!rowCount) return { error: 'item_not_found' }
  return { ok: true }
}
