import { Router } from 'express'
import crypto from 'node:crypto'
import { pool } from '../db.js'
import { requireAdmin } from '../auth.js'

export const adminRidersRouter = Router()
adminRidersRouter.use(requireAdmin)

interface RiderRow {
  id: string
  name: string
  phone: string
  active: number
  createdAt: string
}

const SELECT_RIDER = `
  SELECT id, name, phone, active, created_at as "createdAt"
  FROM riders
`

function serialize(row: RiderRow) {
  return { ...row, active: !!row.active }
}

adminRidersRouter.get('/', async (_req, res) => {
  const { rows } = await pool.query<RiderRow>(`${SELECT_RIDER} ORDER BY created_at DESC`)
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

  const { rows } = await pool.query<RiderRow>(`${SELECT_RIDER} WHERE id = $1`, [id])
  res.status(201).json({ rider: serialize(rows[0]) })
})

adminRidersRouter.patch('/:id', async (req, res) => {
  const { rows: existingRows } = await pool.query<RiderRow>(`${SELECT_RIDER} WHERE id = $1`, [req.params.id])
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

  const { rows } = await pool.query<RiderRow>(`${SELECT_RIDER} WHERE id = $1`, [req.params.id])
  res.json({ rider: serialize(rows[0]) })
})
