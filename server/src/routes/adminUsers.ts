import { Router } from 'express'
import { db } from '../db.js'
import { requireAdmin } from '../auth.js'

export const adminUsersRouter = Router()
adminUsersRouter.use(requireAdmin)

interface UserRow {
  id: string
  email: string
  fullName: string
  createdAt: string
  isAdmin: number
}

const SELECT_USER = `
  SELECT id, email, full_name as fullName, created_at as createdAt, is_admin as isAdmin
  FROM users
`

adminUsersRouter.get('/', (_req, res) => {
  const rows = db.prepare(`${SELECT_USER} ORDER BY created_at DESC`).all() as UserRow[]
  res.json({ users: rows.map(r => ({ ...r, isAdmin: !!r.isAdmin })) })
})

adminUsersRouter.patch('/:id/admin', (req, res) => {
  const { isAdmin } = req.body ?? {}
  if (typeof isAdmin !== 'boolean') {
    res.status(400).json({ error: 'missing_fields' })
    return
  }

  if (req.params.id === req.user!.id && !isAdmin) {
    res.status(400).json({ error: 'cannot_demote_self' })
    return
  }

  const result = db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(isAdmin ? 1 : 0, req.params.id)
  if (result.changes === 0) {
    res.status(404).json({ error: 'user_not_found' })
    return
  }

  const row = db.prepare(`${SELECT_USER} WHERE id = ?`).get(req.params.id) as UserRow
  res.json({ user: { ...row, isAdmin: !!row.isAdmin } })
})
