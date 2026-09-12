import { pool } from '../db.js'

export interface OrderNote {
  id: number
  orderId: string
  note: string
  createdByUserId: string | null
  createdByName: string | null
  createdAt: string
}

// ملاحظات داخلية بين فريق التشغيل — مش مرئية للعميل أبداً (عكس delivery_instructions اللي
// العميل نفسه بيكتبها). بترجع دايماً من الأحدث للأقدم.
export async function listOrderNotes(orderId: string): Promise<OrderNote[]> {
  const { rows } = await pool.query<OrderNote>(
    `SELECT n.id, n.order_id as "orderId", n.note, n.created_by_user_id as "createdByUserId",
            u.full_name as "createdByName", n.created_at as "createdAt"
     FROM order_notes n LEFT JOIN users u ON u.id = n.created_by_user_id
     WHERE n.order_id = $1
     ORDER BY n.created_at DESC`,
    [orderId]
  )
  return rows
}

export async function addOrderNote(orderId: string, note: string, userId: string): Promise<OrderNote | { error: 'order_not_found' }> {
  const { rows: orderRows } = await pool.query('SELECT id FROM orders WHERE id = $1', [orderId])
  if (!orderRows[0]) return { error: 'order_not_found' }

  const { rows } = await pool.query<{ id: number; createdAt: string }>(
    'INSERT INTO order_notes (order_id, note, created_by_user_id, created_at) VALUES ($1, $2, $3, now()) RETURNING id, created_at as "createdAt"',
    [orderId, note.trim(), userId]
  )
  const { rows: userRows } = await pool.query<{ fullName: string }>('SELECT full_name as "fullName" FROM users WHERE id = $1', [userId])
  return {
    id: rows[0].id,
    orderId,
    note: note.trim(),
    createdByUserId: userId,
    createdByName: userRows[0]?.fullName ?? null,
    createdAt: rows[0].createdAt
  }
}
