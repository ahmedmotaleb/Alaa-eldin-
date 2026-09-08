import { Router } from 'express'
import crypto from 'node:crypto'
import { db } from '../db.js'
import { hashPassword, verifyPassword, createSession, destroySession, SESSION_COOKIE } from '../auth.js'

export const authRouter = Router()

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function setSessionCookie(res: import('express').Response, token: string, expires: Date) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    expires,
    path: '/'
  })
}

authRouter.post('/register', (req, res) => {
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

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase())
  if (existing) {
    res.status(409).json({ error: 'email_taken' })
    return
  }

  const id = crypto.randomUUID()
  const createdAt = new Date().toISOString()
  db.prepare('INSERT INTO users (id, email, password_hash, full_name, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, email.toLowerCase(), hashPassword(password), fullName.trim(), createdAt)

  const { token, expires } = createSession(id)
  setSessionCookie(res, token, expires)
  res.status(201).json({ user: { id, email: email.toLowerCase(), fullName: fullName.trim(), createdAt, isAdmin: false } })
})

authRouter.post('/login', (req, res) => {
  const { email, password } = req.body ?? {}
  if (typeof email !== 'string' || typeof password !== 'string') {
    res.status(400).json({ error: 'missing_fields' })
    return
  }

  const row = db.prepare('SELECT id, email, password_hash as passwordHash, full_name as fullName, created_at as createdAt, is_admin as isAdmin FROM users WHERE email = ?')
    .get(email.toLowerCase()) as { id: string, email: string, passwordHash: string, fullName: string, createdAt: string, isAdmin: number } | undefined

  if (!row || !verifyPassword(password, row.passwordHash)) {
    res.status(401).json({ error: 'invalid_credentials' })
    return
  }

  const { token, expires } = createSession(row.id)
  setSessionCookie(res, token, expires)
  res.json({ user: { id: row.id, email: row.email, fullName: row.fullName, createdAt: row.createdAt, isAdmin: !!row.isAdmin } })
})

authRouter.post('/logout', (req, res) => {
  const token = req.cookies?.[SESSION_COOKIE]
  if (token) destroySession(token)
  res.clearCookie(SESSION_COOKIE, { path: '/' })
  res.status(204).end()
})

authRouter.get('/me', (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: 'unauthorized' })
    return
  }
  res.json({ user: req.user })
})
