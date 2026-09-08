import { Router } from 'express'
import { pool } from '../db.js'
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
  SELECT id, email, full_name as "fullName", created_at as "createdAt", is_admin as "isAdmin"
  FROM users
`

adminUsersRouter.get('/', async (_req, res) => {
  const { rows } = await pool.query<UserRow>(`${SELECT_USER} ORDER BY created_at DESC`)
  res.json({ users: rows.map(r => ({ ...r, isAdmin: !!r.isAdmin })) })
})

adminUsersRouter.patch('/:id/admin', async (req, res) => {
  const { isAdmin } = req.body ?? {}
  if (typeof isAdmin !== 'boolean') {
    res.status(400).json({ error: 'missing_fields' })
    return
  }

  if (req.params.id === req.user!.id && !isAdmin) {
    res.status(400).json({ error: 'cannot_demote_self' })
    return
  }

  const result = await pool.query('UPDATE users SET is_admin = $1 WHERE id = $2', [isAdmin ? 1 : 0, req.params.id])
  if (result.rowCount === 0) {
    res.status(404).json({ error: 'user_not_found' })
    return
  }

  const { rows } = await pool.query<UserRow>(`${SELECT_USER} WHERE id = $1`, [req.params.id])
  const row = rows[0]
  res.json({ user: { ...row, isAdmin: !!row.isAdmin } })
})
