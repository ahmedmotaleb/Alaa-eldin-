import crypto from 'node:crypto'
import { pool } from '../db.js'

// نفس مبدأ كلمة السر بالظبط: التوكن الفعلي معروض مرة واحدة بس وقت الإنشاء، ومفيش أي طريقة
// لاسترجاعه بعد كده — المخزّن هنا hash بس (SHA-256، مش bcrypt لأن ده مش كلمة سر بيكتبها
// إنسان، ده سر عشوائي بطول كافي أصلاً، ومقارنة hash ثابتة الوقت مش ضرورية هنا لأن التوكن
// نفسه عالي الإنتروبيا بما يكفي إن أي هجوم توقيت عليه غير عملي).
function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

export function generateBackupToken(): string {
  return crypto.randomBytes(32).toString('hex')
}

export interface BackupTokenRow {
  id: string
  name: string
  createdBy: string | null
  createdByEmail: string | null
  createdAt: string
  lastUsedAt: string | null
  revokedAt: string | null
}

interface BackupTokenDbRow {
  id: string
  name: string
  createdBy: string | null
  createdByEmail: string | null
  createdAt: string
  lastUsedAt: string | null
  revokedAt: string | null
}

const SELECT_TOKEN = `
  SELECT t.id, t.name, t.created_by as "createdBy", u.email as "createdByEmail",
         t.created_at as "createdAt", t.last_used_at as "lastUsedAt", t.revoked_at as "revokedAt"
  FROM backup_tokens t
  LEFT JOIN users u ON u.id = t.created_by
`

export async function listBackupTokens(): Promise<BackupTokenRow[]> {
  const { rows } = await pool.query<BackupTokenDbRow>(`${SELECT_TOKEN} ORDER BY t.created_at DESC`)
  return rows
}

export async function createBackupToken(params: { name: string, createdBy: string }): Promise<{ id: string, token: string }> {
  const token = generateBackupToken()
  const id = crypto.randomUUID()
  await pool.query(
    `INSERT INTO backup_tokens (id, token_hash, name, created_by, created_at) VALUES ($1, $2, $3, $4, now())`,
    [id, hashToken(token), params.name, params.createdBy]
  )
  return { id, token }
}

export async function revokeBackupToken(id: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE backup_tokens SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL`,
    [id]
  )
  return (rowCount ?? 0) > 0
}

export interface VerifiedBackupToken {
  id: string
  createdBy: string | null
}

// التوكن صالح بس لو: مش ملغي، ومنشئه لسه isAdmin = true دلوقتي. مفيش عمود "نشِط/متوقف"
// منفصل على users — is_admin هو المصدر الوحيد الموجود فعلاً لحالة "أدمن فعّال"، فترقية
// المستخدم لغير أدمن (أو حذف حسابه، ON DELETE SET NULL فوق) بتوقف التوكن تلقائياً.
export async function verifyBackupToken(token: string): Promise<VerifiedBackupToken | null> {
  const { rows } = await pool.query<{ id: string, createdBy: string | null, isAdmin: number | null }>(
    `SELECT t.id, t.created_by as "createdBy", u.is_admin as "isAdmin"
     FROM backup_tokens t
     LEFT JOIN users u ON u.id = t.created_by
     WHERE t.token_hash = $1 AND t.revoked_at IS NULL`,
    [hashToken(token)]
  )
  const row = rows[0]
  if (!row) return null
  // created_by NULL معناه إما التوكن اتعمل من غير مستخدم معروف (ما بيحصلش من الكود الحالي)
  // أو المستخدم المنشئ اتحذف (ON DELETE SET NULL) — الحالتين لازم يتعاملوا كـ "مش أدمن فعّال".
  if (!row.createdBy || !row.isAdmin) return null
  await pool.query(`UPDATE backup_tokens SET last_used_at = now() WHERE id = $1`, [row.id])
  return { id: row.id, createdBy: row.createdBy }
}
