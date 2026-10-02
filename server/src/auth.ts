import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import type { Request, Response, NextFunction } from 'express'
import { pool } from './db.js'
import { userHasPermission, type Permission } from './services/permissionService.js'

export const SESSION_COOKIE = 'session_token'
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days
const RESET_TTL_MS = 60 * 60 * 1000 // ساعة واحدة
// حد أدنى بين تحديثات last_seen_at لنفس الجلسة — أي عدد طلبات عادي من نفس الجهاز في أقل من
// ربع ساعة ما بيعملش أي UPDATE إضافي، عشان مانحملش قاعدة البيانات بكتابة على كل request.
const SESSION_ACTIVITY_THROTTLE_MS = 15 * 60 * 1000
// السر ده بيتأكد من env، وإلا بيتولّد عشوائي لكل عملية تشغيل — كافي لأن ip_hash مش مطلوب
// يفضل ثابت بين إعادة تشغيل السيرفر (مستخدم بس لتدقيق أمني داخلي، مش لأي منطق يعتمد عليه).
const IP_HASH_SALT = process.env.SESSION_IP_HASH_SALT || crypto.randomBytes(16).toString('hex')

export function hashPassword(password: string) {
  return bcrypt.hashSync(password, 10)
}

export function verifyPassword(password: string, hash: string) {
  return bcrypt.compareSync(password, hash)
}

// معرّف الجلسة العام (يتعرض في الـ API) — نفس تعبير العمود المحسوب id في جدول sessions
// (md5(token))، عشان الراوت يقدر يقارن التوكن الحالي بالـ id الراجع من القايمة من غير ما
// يرجّع التوكن السري نفسه في أي رد.
export function sessionIdFromToken(token: string): string {
  return crypto.createHash('md5').update(token).digest('hex')
}

function hashIp(ip: string): string {
  return crypto.createHash('sha256').update(IP_HASH_SALT + ip).digest('hex').slice(0, 32)
}

// وصف مختصر للجهاز/المتصفح من الـ User-Agent — تحليل بسيط بالأنماط الشائعة بس (مش مكتبة
// fingerprinting)، والهدف عرض تعريف مفيد للمستخدم زي "Chrome على أندرويد" مش تتبّع دقيق.
export function deriveDeviceName(userAgent: string | undefined | null): string {
  if (!userAgent) return 'جهاز غير معروف'
  const ua = userAgent
  let os = 'جهاز'
  if (/iPhone/.test(ua)) os = 'iPhone'
  else if (/iPad/.test(ua)) os = 'iPad'
  else if (/Android/.test(ua)) os = 'أندرويد'
  else if (/Windows/.test(ua)) os = 'ويندوز'
  else if (/Macintosh/.test(ua)) os = 'ماك'
  else if (/Linux/.test(ua)) os = 'لينكس'

  let browser = ''
  if (/Edg\//.test(ua)) browser = 'Edge'
  else if (/CriOS/.test(ua)) browser = 'Chrome'
  else if (/Chrome\//.test(ua) && !/Chromium/.test(ua)) browser = 'Chrome'
  else if (/Firefox\//.test(ua)) browser = 'Firefox'
  else if (/Version\/.*Safari\//.test(ua)) browser = 'Safari'

  return browser ? `${browser} على ${os}` : os
}

export interface SessionMeta {
  userAgent?: string
  ip?: string
}

export async function createSession(userId: string, meta: SessionMeta = {}) {
  const token = crypto.randomBytes(32).toString('hex')
  const now = new Date()
  const expires = new Date(now.getTime() + SESSION_TTL_MS)
  const userAgent = meta.userAgent ? meta.userAgent.slice(0, 300) : null
  const deviceName = deriveDeviceName(meta.userAgent)
  const ipHash = meta.ip ? hashIp(meta.ip) : null
  await pool.query(
    `INSERT INTO sessions (token, user_id, created_at, expires_at, user_agent, device_name, ip_hash, last_seen_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $3)`,
    [token, userId, now.toISOString(), expires.toISOString(), userAgent, deviceName, ipHash]
  )
  return { token, expires }
}

export async function destroySession(token: string) {
  await pool.query('DELETE FROM sessions WHERE token = $1', [token])
}

// بتتنادى من attachUser على كل طلب فيه جلسة صالحة — بس بتعمل UPDATE فعلي لو مر أكتر من
// SESSION_ACTIVITY_THROTTLE_MS من آخر تحديث (أو الجلسة لسه ما اتحدثتش خالص)، عشان تفضل
// "آخر نشاط" دقيقة بما يكفي من غير ما تبقى كتابة على كل request.
async function touchSessionActivity(token: string, lastSeenAt: string | null) {
  const now = Date.now()
  if (lastSeenAt && now - new Date(lastSeenAt).getTime() < SESSION_ACTIVITY_THROTTLE_MS) return
  await pool.query('UPDATE sessions SET last_seen_at = $1 WHERE token = $2', [new Date(now).toISOString(), token])
}

export interface SessionSummary {
  id: string
  deviceName: string | null
  userAgent: string | null
  createdAt: string
  lastSeenAt: string | null
}

export async function listUserSessions(userId: string): Promise<SessionSummary[]> {
  const { rows } = await pool.query<SessionSummary>(
    `SELECT id, device_name as "deviceName", user_agent as "userAgent", created_at as "createdAt", last_seen_at as "lastSeenAt"
     FROM sessions WHERE user_id = $1 AND expires_at > $2
     ORDER BY COALESCE(last_seen_at, created_at) DESC`,
    [userId, new Date().toISOString()]
  )
  return rows
}

// بيتأكد إن الجلسة المطلوب حذفها ملك المستخدم الحالي فعلاً (فلترة user_id إجبارية) —
// من غير كده أي مستخدم عارف يخمّن id جلسة حد تاني كان يقدر يمسحها.
export async function deleteUserSession(userId: string, sessionId: string): Promise<boolean> {
  const { rowCount } = await pool.query('DELETE FROM sessions WHERE user_id = $1 AND id = $2', [userId, sessionId])
  return (rowCount ?? 0) > 0
}

export async function deleteOtherUserSessions(userId: string, currentSessionId: string): Promise<number> {
  const { rowCount } = await pool.query('DELETE FROM sessions WHERE user_id = $1 AND id != $2', [userId, currentSessionId])
  return rowCount ?? 0
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

export type UserRole = 'staff' | 'admin'

export interface AuthedUser {
  id: string
  email: string
  fullName: string
  mobile?: string
  createdAt: string
  isAdmin: boolean
  role: UserRole
  roleId: string | null
  active: boolean
  mustChangePassword: boolean
}

async function getUserBySession(token: string): Promise<{ user: AuthedUser, lastSeenAt: string | null } | null> {
  const { rows } = await pool.query<Omit<AuthedUser, 'isAdmin' | 'mobile' | 'active' | 'mustChangePassword'> & { isAdmin: number, mobile: string | null, active: number, mustChangePassword: number, lastSeenAt: string | null }>(`
    SELECT u.id as id, u.email as email, u.full_name as "fullName", u.mobile as "mobile", u.created_at as "createdAt", u.is_admin as "isAdmin", u.role as "role", u.role_id as "roleId", u.active as "active", u.must_change_password as "mustChangePassword", s.last_seen_at as "lastSeenAt"
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = $1 AND s.expires_at > $2 AND u.active = 1
  `, [token, new Date().toISOString()])
  const row = rows[0]
  if (!row) return null
  const { lastSeenAt, ...userRow } = row
  return { user: { ...userRow, mobile: userRow.mobile ?? undefined, isAdmin: !!userRow.isAdmin, active: !!userRow.active, mustChangePassword: !!userRow.mustChangePassword }, lastSeenAt }
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthedUser
    }
  }
}

export function extractSessionToken(req: Request): string | undefined {
  return req.cookies?.[SESSION_COOKIE]
}

export async function attachUser(req: Request, _res: Response, next: NextFunction) {
  const token = extractSessionToken(req)
  if (token) {
    const result = await getUserBySession(token)
    if (result) {
      req.user = result.user
      touchSessionActivity(token, result.lastSeenAt).catch(() => {})
    }
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
  // حساب إداري اتعمله أدمن بكلمة مرور مؤقتة ولازم يغيّرها — كل مسارات لوحة التحكم الأخرى
  // محجوبة لحد ما يغيّرها عن طريق POST /auth/change-required-password (المسار ده نفسه بيعدي
  // عن طريق requireAuth مش requireAdmin، عشان ميقعش في نفس القفلة).
  if (req.user.mustChangePassword) {
    res.status(403).json({ error: 'password_change_required' })
    return
  }
  next()
}

// بوابة أدق من requireAdmin: تسمح لأي دور من الأدوار المُمرَّرة بس. تُستخدم لتقييد إجراءات
// حساسة مالياً/إدارياً (زي إدارة المستخدمين والصلاحيات، أو تسوية الدليفري) على 'admin' بس،
// بينما باقي لوحة التحكم تفضل متاحة لأي مستخدم isAdmin (سواء 'staff' أو 'admin').
export function requireRole(...allowed: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: 'unauthorized' })
      return
    }
    if (!allowed.includes(req.user.role)) {
      res.status(403).json({ error: 'forbidden' })
      return
    }
    next()
  }
}

// بوابة صلاحيات دقيقة (RBAC) — بتتحقق من الصلاحية الفعلية للمستخدم (من role_id لو موجود،
// أو من is_admin/role القديمين كـ fallback) بدل الاكتفاء بـ isAdmin العام. لازم تيجي بعد
// requireAdmin على نفس المسار (مستخدم مش isAdmin أصلاً هيتوقف قبل ما يوصل هنا).
//
// ملاحظة مهمة: getUserPermissions بتاعة permissionService بترجّع LEGACY_ADMIN_PERMISSIONS
// (كل الصلاحيات) لأي مستخدم legacy (roleId=null) عنده isAdmin=true — بغض النظر عن role
// النصي القديم ('staff' مقابل 'admin'). يعني requirePermission لوحدها مش كافية لحماية
// أقسام كانت تاريخياً مقصورة على role='admin' الكامل بس (زي إدارة المستخدمين) من مستخدم
// legacy بدور 'staff' — استخدم requireUsersManage تحت لو محتاج تحافظ على التفرقة دي.
export function requirePermission(permission: Permission) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: 'unauthorized' })
      return
    }
    const allowed = await userHasPermission(req.user, permission)
    if (!allowed) {
      res.status(403).json({ error: 'forbidden' })
      return
    }
    next()
  }
}

// بوابة إدارة المستخدمين/الأدوار تحديداً — بتحافظ على نفس سلوك requireRole('admin') القديم
// بالظبط لحسابات legacy (roleId=null: لازم يكون role='admin' الكامل، مش 'staff')، وفي
// نفس الوقت بتسمح لأي دور RBAC دقيق (roleId موجود) عنده صلاحية users.manage صراحة —
// بدون الاعتماد على LEGACY_ADMIN_PERMISSIONS fallback اللي بتفتح كل الصلاحيات لأي
// legacy isAdmin=true بغض النظر عن role التشغيلي/الكامل (راجع الملاحظة فوق).
export function requireUsersManage(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    res.status(401).json({ error: 'unauthorized' })
    return
  }
  if (req.user.roleId) {
    userHasPermission(req.user, 'users.manage').then(allowed => {
      if (!allowed) { res.status(403).json({ error: 'forbidden' }); return }
      next()
    })
    return
  }
  if (req.user.role !== 'admin') {
    res.status(403).json({ error: 'forbidden' })
    return
  }
  next()
}
