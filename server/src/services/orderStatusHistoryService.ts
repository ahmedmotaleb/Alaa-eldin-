import type { PoolClient } from 'pg'
import { pool } from '../db.js'
import type { OrderStatus } from '../orderStatus.js'

export type StatusChangeSource = 'admin' | 'system' | 'customer'

export interface RecordStatusChangeInput {
  orderId: string
  fromStatus: OrderStatus | null
  toStatus: OrderStatus
  changedByUserId?: string | null
  source: StatusChangeSource
}

// بيتسجّل جوه نفس معاملة تحديث حالة الطلب (client) — عشان تحديث الحالة وسجل التاريخ يبقوا
// عملية واحدة ذرّية. مفيش سجل جديد لعملية بدون تأثير فعلي (نفس الحالة القديمة والجديدة).
export async function recordOrderStatusChange(client: PoolClient, input: RecordStatusChangeInput): Promise<void> {
  if (input.fromStatus === input.toStatus) return
  await client.query(
    `INSERT INTO order_status_history (order_id, from_status, to_status, changed_by_user_id, source, created_at)
     VALUES ($1, $2, $3, $4, $5, now())`,
    [input.orderId, input.fromStatus, input.toStatus, input.changedByUserId ?? null, input.source]
  )
}

export interface OrderStatusHistoryEntry {
  fromStatus: string | null
  toStatus: string
  source: StatusChangeSource
  createdAt: string
}

export async function listOrderStatusHistory(orderId: string): Promise<OrderStatusHistoryEntry[]> {
  const { rows } = await pool.query<OrderStatusHistoryEntry>(
    `SELECT from_status as "fromStatus", to_status as "toStatus", source, created_at as "createdAt"
     FROM order_status_history WHERE order_id = $1 ORDER BY created_at ASC, id ASC`,
    [orderId]
  )
  return rows
}

export async function listOrderStatusHistoryForOrders(orderIds: string[]): Promise<Map<string, OrderStatusHistoryEntry[]>> {
  const map = new Map<string, OrderStatusHistoryEntry[]>()
  if (orderIds.length === 0) return map
  const { rows } = await pool.query<OrderStatusHistoryEntry & { orderId: string }>(
    `SELECT order_id as "orderId", from_status as "fromStatus", to_status as "toStatus", source, created_at as "createdAt"
     FROM order_status_history WHERE order_id = ANY($1) ORDER BY created_at ASC, id ASC`,
    [orderIds]
  )
  for (const row of rows) {
    const { orderId, ...entry } = row
    const list = map.get(orderId) ?? []
    list.push(entry)
    map.set(orderId, list)
  }
  return map
}
