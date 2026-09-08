import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import type { Request, Response, NextFunction } from 'express'
import { pool } from './db.js'

export const SESSION_COOKIE = 'session_token'
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

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

export interface AuthedUser {
  id: string
  email: string
  fullName: string
  createdAt: string
  isAdmin: boolean
}

async function getUserBySession(token: string): Promise<AuthedUser | null> {
  const { rows } = await pool.query<Omit<AuthedUser, 'isAdmin'> & { isAdmin: number }>(`
    SELECT u.id as id, u.email as email, u.full_name as "fullName", u.created_at as "createdAt", u.is_admin as "isAdmin"
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = $1 AND s.expires_at > $2
  `, [token, new Date().toISOString()])
  const row = rows[0]
  return row ? { ...row, isAdmin: !!row.isAdmin } : null
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthedUser
    }
  }
}

export async function attachUser(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE]
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
