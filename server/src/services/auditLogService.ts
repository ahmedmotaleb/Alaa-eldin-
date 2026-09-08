// سجل تدقيق دائم لإجراءات الإدارة — منفصل تماماً عن لوجات السيرفر الخام (اللي تفضل في
// Railway فقط وما بتتعرضش لفريق العمل). لا يوجد أي endpoint تعديل/حذف على audit_logs من
// واجهة الإدارة العادية — الإدراج هنا هو الطريقة الوحيدة للكتابة فيه.
import { pool } from '../db.js'

export async function recordAuditLog(params: {
  adminUserId: string | null
  action: string
  entityType: string
  entityId: string
  oldValues?: unknown
  newValues?: unknown
}) {
  await pool.query(
    `INSERT INTO audit_logs (admin_user_id, action, entity_type, entity_id, old_values, new_values, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      params.adminUserId,
      params.action,
      params.entityType,
      params.entityId,
      params.oldValues !== undefined ? JSON.stringify(params.oldValues) : null,
      params.newValues !== undefined ? JSON.stringify(params.newValues) : null,
      new Date().toISOString()
    ]
  )
}

export interface AuditLogRow {
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

export async function listAuditLogs(params: { page: number; limit: number }) {
  const offset = (params.page - 1) * params.limit
  const [{ rows }, { rows: countRows }] = await Promise.all([
    pool.query<AuditLogRow>(
      `SELECT a.id, a.admin_user_id as "adminUserId", u.email as "adminEmail", a.action,
              a.entity_type as "entityType", a.entity_id as "entityId",
              a.old_values as "oldValues", a.new_values as "newValues", a.created_at as "createdAt"
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.admin_user_id
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT $1 OFFSET $2`,
      [params.limit, offset]
    ),
    pool.query<{ count: string }>('SELECT COUNT(*) as count FROM audit_logs')
  ])
  return { rows, total: parseInt(countRows[0].count, 10) }
}
