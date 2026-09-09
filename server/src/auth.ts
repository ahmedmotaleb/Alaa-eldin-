import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import type { Request, Response, NextFunction } from 'express'
import { pool } from './db.js'

export const SESSION_COOKIE = 'session_token'
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days
const RESET_TTL_MS = 60 * 60 * 1000 // ساعة واحدة

export function hashPassword(password: string) {
  return bcrypt.hashSync(password, 10)
}

export function verifyPassword(password: string, hash: string) {
  return bcrypt.compareSync(password, hash)
}

export async function createSession(userId: string) {
  const token = crypto.randomBytes(32).toString('hex')
  const now = new Date()
  const expires = new Date(now.getTime() + SESSION_TTL_MS)
  await pool.query(
    'INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES ($1, $2, $3, $4)',
    [token, userId, now.toISOString(), expires.toISOString()]
  )
  return { token, expires }
}

export async function destroySession(token: string) {
  await pool.query('DELETE FROM sessions WHERE token = $1', [token])
}

export async function createPasswordResetToken(userId: string) {
  const token = crypto.randomBytes(32).toString('hex')
  const now = new Date()
  const expires = new Date(now.getTime() + RESET_TTL_MS)
  // رمز واحد فعّال بحد أقصى لكل مستخدم — طلب استعادة جديد يلغي أي رمز سابق لسه شغال
  await pool.query('DELETE FROM password_resets WHERE user_id = $1', [userId])
  await pool.query(
    'INSERT INTO password_resets (token, user_id, created_at, expires_at) VALUES ($1, $2, $3, $4)',
    [token, userId, now.toISOString(), expires.toISOString()]
  )
  return token
}

export async function consumePasswordResetToken(token: string) {
  const { rows } = await pool.query<{ userId: string }>(
    'SELECT user_id as "userId" FROM password_resets WHERE token = $1 AND expires_at > $2',
    [token, new Date().toISOString()]
  )
  const row = rows[0]
  if (!row) return null
  await pool.query('DELETE FROM password_resets WHERE token = $1', [token])
  return row.userId
}

export interface AuthedUser {
  id: string
  email: string
  fullName: string
  mobile?: string
  createdAt: string
  isAdmin: boolean
}

async function getUserBySession(token: string): Promise<AuthedUser | null> {
  const { rows } = await pool.query<Omit<AuthedUser, 'isAdmin' | 'mobile'> & { isAdmin: number, mobile: string | null }>(`
    SELECT u.id as id, u.email as email, u.full_name as "fullName", u.mobile as "mobile", u.created_at as "createdAt", u.is_admin as "isAdmin"
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = $1 AND s.expires_at > $2
  `, [token, new Date().toISOString()])
  const row = rows[0]
  return row ? { ...row, mobile: row.mobile ?? undefined, isAdmin: !!row.isAdmin } : null
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthedUser
    }
  }
}

// تطبيق الأندرويد (Capacitor) بيكلّم الباك إند من أصل مختلف (cross-origin) — كوكيز
// SameSite=Lax (المطلوبة كحماية CSRF أساسية للويب) ما بتترجعش على طلبات cross-origin
// زي دي أصلاً، فمفيش داعي (ولا صح) نضعّف الكوكيز عشان نصلّح الأندرويد. بدل كده، العميل
// الأصلي (native) وحده بيستقبل نفس token الجلسة في جسم رد تسجيل الدخول (راجع routes/auth.ts)
// ويبعته كـ "Authorization: Bearer <token>" — نفس جدول sessions، نفس الصلاحية والانتهاء
// بالظبط، غير مصدر القراءة بس. قبول هيدر Authorization هنا آمن دايماً (على عكس الكوكيز،
// المتصفح ما بيرفقش هيدر زي ده تلقائياً في أي طلب cross-site، فمفيش خطر CSRF إضافي).
export function extractSessionToken(req: Request): string | undefined {
  const cookieToken = req.cookies?.[SESSION_COOKIE]
  if (cookieToken) return cookieToken
  const authHeader = req.headers.authorization
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    return authHeader.slice('Bearer '.length).trim() || undefined
  }
  return undefined
}

export async function attachUser(req: Request, _res: Response, next: NextFunction) {
  const token = extractSessionToken(req)
  if (token) {
    const user = await getUserBySession(token)
    if (user) req.user = user
  }
  next()
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    res.status(401).json({ error: 'unauthorized' })
    return
  }
  next()
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    res.status(401).json({ error: 'unauthorized' })
    return
  }
  if (!req.user.isAdmin) {
    res.status(403).json({ error: 'forbidden' })
    return
  }
  next()
}
