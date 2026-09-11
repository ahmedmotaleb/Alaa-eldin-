import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import crypto from 'node:crypto'
import { pool } from '../db.js'
import { hashPassword, verifyPassword, createSession, destroySession, extractSessionToken, createPasswordResetToken, consumePasswordResetToken, requireAuth, SESSION_COOKIE } from '../auth.js'
import { sendPasswordResetEmail } from '../email.js'
import { isValidEgyptianMobile } from '../phone.js'
import { publicOrigin } from '../publicUrl.js'
import { logEvent, logWarn } from '../logger.js'

export const authRouter = Router()

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PUBLIC_APP_URL = publicOrigin()

// تسجيل الدخول: 10 محاولات كل 15 دقيقة لكل IP، ومحاولة ناجحة ما بتتحسبش من الحد ده —
// عميل حقيقي عادي (حتى لو غلط كلمة السر مرة أو اتنين) ما بيتأثرش، والحماية موجّهة لمحاولات
// التخمين الآلي (brute force). الرد نفسه فاضل عام زي ما هو (لا يكشف وجود الإيميل من عدمه)
// — الـ rate limit طبقة إضافية قبل الـ route نفسه، مش بديل عنه.
const loginRateLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false, skipSuccessfulRequests: true })
const forgotPasswordRateLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false })
const resetPasswordRateLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false })

function setSessionCookie(res: import('express').Response, token: string, expires: Date) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    expires,
    path: '/'
  })
}

authRouter.post('/register', async (req, res) => {
  const { email, password, fullName } = req.body ?? {}

  if (typeof email !== 'string' || typeof password !== 'string' || typeof fullName !== 'string' || !fullName.trim()) {
    res.status(400).json({ error: 'missing_fields' })
    return
  }
  if (!EMAIL_RE.test(email)) {
    res.status(400).json({ error: 'invalid_email' })
    return
  }
  if (password.length < 6) {
    res.status(400).json({ error: 'weak_password' })
    return
  }

  const { rows: existingRows } = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()])
  if (existingRows[0]) {
    res.status(409).json({ error: 'email_taken' })
    return
  }

  const id = crypto.randomUUID()
  const createdAt = new Date().toISOString()
  await pool.query(
    'INSERT INTO users (id, email, password_hash, full_name, created_at) VALUES ($1, $2, $3, $4, $5)',
    [id, email.toLowerCase(), hashPassword(password), fullName.trim(), createdAt]
  )

  const { token, expires } = await createSession(id)
  setSessionCookie(res, token, expires)
  res.status(201).json({
    user: { id, email: email.toLowerCase(), fullName: fullName.trim(), mobile: undefined, createdAt, isAdmin: false, role: 'staff' as const }
  })
})

authRouter.post('/login', loginRateLimit, async (req, res) => {
  const { email, password } = req.body ?? {}
  if (typeof email !== 'string' || typeof password !== 'string') {
    res.status(400).json({ error: 'missing_fields' })
    return
  }

  const { rows } = await pool.query<{ id: string, email: string, passwordHash: string, fullName: string, mobile: string | null, createdAt: string, isAdmin: number, role: 'staff' | 'admin' }>(
    'SELECT id, email, password_hash as "passwordHash", full_name as "fullName", mobile, created_at as "createdAt", is_admin as "isAdmin", role as "role" FROM users WHERE email = $1',
    [email.toLowerCase()]
  )
  const row = rows[0]

  if (!row || !verifyPassword(password, row.passwordHash)) {
    logWarn('login_failed', { email: email.toLowerCase() })
    res.status(401).json({ error: 'invalid_credentials' })
    return
  }

  const { token, expires } = await createSession(row.id)
  setSessionCookie(res, token, expires)
  logEvent('login_success', { userId: row.id })
  res.json({
    user: { id: row.id, email: row.email, fullName: row.fullName, mobile: row.mobile ?? undefined, createdAt: row.createdAt, isAdmin: !!row.isAdmin, role: row.role }
  })
})

// نفس الرد بالظبط سواء كان الإيميل مسجّل أو لأ، عشان محدش يقدر يكتشف إيميلات عملاء حقيقيين
// عن طريق تجربة إيميلات عشوائية على الـ endpoint ده (user enumeration).
authRouter.post('/forgot-password', forgotPasswordRateLimit, async (req, res) => {
  const { email } = req.body ?? {}
  if (typeof email !== 'string' || !EMAIL_RE.test(email)) {
    res.status(400).json({ error: 'invalid_email' })
    return
  }

  const { rows } = await pool.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [email.toLowerCase()])
  const user = rows[0]
  if (user) {
    const token = await createPasswordResetToken(user.id)
    const resetUrl = `${PUBLIC_APP_URL}/reset-password?token=${token}`
    await sendPasswordResetEmail(email.toLowerCase(), resetUrl)
  }
  res.status(204).end()
})

authRouter.post('/reset-password', resetPasswordRateLimit, async (req, res) => {
  const { token, password } = req.body ?? {}
  if (typeof token !== 'string' || typeof password !== 'string') {
    res.status(400).json({ error: 'missing_fields' })
    return
  }
  if (password.length < 6) {
    res.status(400).json({ error: 'weak_password' })
    return
  }

  const userId = await consumePasswordResetToken(token)
  if (!userId) {
    res.status(400).json({ error: 'invalid_or_expired_token' })
    return
  }

  await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hashPassword(password), userId])
  // إبطال كل الجلسات القديمة بعد تغيير كلمة المرور — لو الحساب كان مخترق، الجلسة القديمة تتقفل فورًا
  await pool.query('DELETE FROM sessions WHERE user_id = $1', [userId])
  res.status(204).end()
})

authRouter.post('/logout', async (req, res) => {
  const token = extractSessionToken(req)
  if (token) await destroySession(token)
  res.clearCookie(SESSION_COOKIE, { path: '/' })
  if (req.user) logEvent('logout', { userId: req.user.id })
  res.status(204).end()
})

authRouter.get('/me', (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: 'unauthorized' })
    return
  }
  res.json({ user: req.user })
})

// تعديل بيانات الحساب — الاسم والموبايل بس (نفس قاعدة الموبايل المصري الصارمة). تغيير
// الإيميل نفسه (هوية الدخول) غير مدعوم هنا عن قصد.
authRouter.patch('/me', requireAuth, async (req, res) => {
  const b = req.body as Record<string, unknown>
  if (
    typeof b?.fullName !== 'string' || b.fullName.trim().length < 2 || b.fullName.trim().length > 100 ||
    typeof b?.mobile !== 'string' || (b.mobile.trim() && !isValidEgyptianMobile(b.mobile.trim()))
  ) {
    res.status(400).json({ error: 'invalid_profile_fields' })
    return
  }

  const fullName = b.fullName.trim()
  const mobile = b.mobile.trim() || null
  await pool.query('UPDATE users SET full_name = $1, mobile = $2 WHERE id = $3', [fullName, mobile, req.user!.id])
  logEvent('profile_updated', { userId: req.user!.id })
  res.json({ user: { ...req.user, fullName, mobile: mobile ?? undefined } })
})
