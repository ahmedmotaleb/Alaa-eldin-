import { Router } from 'express'
import crypto from 'node:crypto'
import { pool } from '../db.js'
import { requireAdmin } from '../auth.js'
import { recordAuditLog } from '../services/auditLogService.js'

export const adminRidersRouter = Router()
adminRidersRouter.use(requireAdmin)

interface RiderRow {
  id: string
  name: string
  phone: string
  active: number
  createdAt: string
  userId: string | null
  userEmail: string | null
}

const SELECT_RIDER = `
  SELECT r.id, r.name, r.phone, r.active, r.created_at as "createdAt", r.user_id as "userId", u.email as "userEmail"
  FROM riders r
  LEFT JOIN users u ON u.id = r.user_id
`

function serialize(row: RiderRow) {
  return { ...row, active: !!row.active }
}

adminRidersRouter.get('/', async (_req, res) => {
  const { rows } = await pool.query<RiderRow>(`${SELECT_RIDER} ORDER BY r.created_at DESC`)
  res.json({ riders: rows.map(serialize) })
})

adminRidersRouter.post('/', async (req, res) => {
  const { name, phone } = req.body ?? {}
  if (typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'missing_fields' })
    return
  }

  const id = crypto.randomUUID()
  await pool.query(
    'INSERT INTO riders (id, name, phone, active, created_at) VALUES ($1, $2, $3, 1, $4)',
    [id, name.trim(), typeof phone === 'string' ? phone.trim() : '', new Date().toISOString()]
  )

  const { rows } = await pool.query<RiderRow>(`${SELECT_RIDER} WHERE r.id = $1`, [id])
  res.status(201).json({ rider: serialize(rows[0]) })
})

adminRidersRouter.patch('/:id', async (req, res) => {
  const { rows: existingRows } = await pool.query<RiderRow>(`${SELECT_RIDER} WHERE r.id = $1`, [req.params.id])
  const existingRow = existingRows[0]
  if (!existingRow) {
    res.status(404).json({ error: 'rider_not_found' })
    return
  }

  const b = { ...serialize(existingRow), ...(req.body ?? {}) } as Record<string, unknown>
  if (typeof b.name !== 'string' || !b.name.trim() || typeof b.active !== 'boolean') {
    res.status(400).json({ error: 'missing_fields' })
    return
  }

  await pool.query(
    'UPDATE riders SET name = $1, phone = $2, active = $3 WHERE id = $4',
    [b.name.trim(), typeof b.phone === 'string' ? b.phone.trim() : '', b.active ? 1 : 0, req.params.id]
  )

  const { rows } = await pool.query<RiderRow>(`${SELECT_RIDER} WHERE r.id = $1`, [req.params.id])
  res.json({ rider: serialize(rows[0]) })
})

// ربط مندوب بحساب دخول فعلي (عن طريق بريده الإلكتروني) — بيمنحه تلقائياً دور "مندوب توصيل"
// الدقيق (role-rider) وصلاحية الدخول للوحة التحكم، عشان يقدر يشوف "طلباتي" على الموبايل.
// مش بيغيّر أي حساب admin/manager موجود بالغلط — لو المستخدم already مدير كامل بنرفض الربط.
adminRidersRouter.post('/:id/link-user', async (req, res) => {
  const email = req.body?.email
  if (typeof email !== 'string' || !email.trim()) {
    res.status(400).json({ error: 'missing_email' })
    return
  }

  const { rows: riderRows } = await pool.query<RiderRow>(`${SELECT_RIDER} WHERE r.id = $1`, [req.params.id])
  if (!riderRows[0]) { res.status(404).json({ error: 'rider_not_found' }); return }

  const { rows: userRows } = await pool.query<{ id: string; roleId: string | null; isAdmin: number }>(
    'SELECT id, role_id as "roleId", is_admin as "isAdmin" FROM users WHERE email = $1',
    [email.trim()]
  )
  const user = userRows[0]
  if (!user) { res.status(404).json({ error: 'user_not_found' }); return }
  if (user.roleId === 'role-manager' || (user.roleId === null && user.isAdmin === 1)) {
    res.status(409).json({ error: 'cannot_link_full_admin' })
    return
  }

  try {
    await pool.query('UPDATE riders SET user_id = $1 WHERE id = $2', [user.id, req.params.id])
  } catch (err) {
    if (err instanceof Error && 'code' in err && (err as { code: string }).code === '23505') {
      res.status(409).json({ error: 'user_already_linked_to_another_rider' })
      return
    }
    throw err
  }
  await pool.query(`UPDATE users SET role_id = 'role-rider', is_admin = 1 WHERE id = $1`, [user.id])

  await recordAuditLog({
    adminUserId: req.user!.id,
    action: 'rider_user_linked',
    entityType: 'rider',
    entityId: req.params.id,
    newValues: { userId: user.id, email: email.trim() }
  })

  const { rows } = await pool.query<RiderRow>(`${SELECT_RIDER} WHERE r.id = $1`, [req.params.id])
  res.json({ rider: serialize(rows[0]) })
})

adminRidersRouter.delete('/:id/link-user', async (req, res) => {
  const { rows: riderRows } = await pool.query<RiderRow>(`${SELECT_RIDER} WHERE r.id = $1`, [req.params.id])
  if (!riderRows[0]) { res.status(404).json({ error: 'rider_not_found' }); return }

  await pool.query('UPDATE riders SET user_id = NULL WHERE id = $1', [req.params.id])
  await recordAuditLog({
    adminUserId: req.user!.id,
    action: 'rider_user_unlinked',
    entityType: 'rider',
    entityId: req.params.id
  })

  const { rows } = await pool.query<RiderRow>(`${SELECT_RIDER} WHERE r.id = $1`, [req.params.id])
  res.json({ rider: serialize(rows[0]) })
})
